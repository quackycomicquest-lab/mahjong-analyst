import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * オフライン対応（仕様 §10-2「オフラインでも基本的な対局機能が利用できる」）
 *
 * ビルド時に、出力される全ファイル（JS・CSS・評価 Worker・アイコン等）を事前キャッシュする
 * Service Worker（dist/sw.js）を生成する。ファイル構成が変わるとキャッシュ名も変わり、古いキャッシュは消える。
 */
function serviceWorker(): Plugin {
  let base = '/'
  return {
    name: 'mahjong-analyst-service-worker',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    generateBundle(_options, bundle) {
      const publicDir = join(__dirname, 'public')
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const p = join(dir, name)
          return statSync(p).isDirectory() ? walk(p) : [relative(publicDir, p)]
        })
      const files = [...Object.keys(bundle), ...walk(publicDir)]
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js')
        .map((f) => base + f.split('\\').join('/'))
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f)
      for (const [name, chunk] of Object.entries(bundle)) {
        if (name === 'index.html' && chunk.type === 'asset') hash.update(String(chunk.source))
      }
      for (const f of walk(publicDir)) hash.update(readFileSync(join(publicDir, f)))
      // Service Worker 自体を書き換えたときもキャッシュを作り直す
      hash.update(serviceWorkerSource('', base, []))
      const version = hash.digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, base, [base, ...files]) })
    },
  }
}

function serviceWorkerSource(version: string, base: string, precache: string[]): string {
  return `// 自動生成（vite.config.ts）。編集しないこと。
const CACHE = 'mahjong-analyst-${version}'
const BASE = ${JSON.stringify(base)}
const PRECACHE = ${JSON.stringify(precache)}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mahjong-analyst-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  // 画面（HTML）はネット優先（ブラウザの HTTP キャッシュを使わず毎回最新を確認）、つながらなければキャッシュ
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(BASE, copy))
          return res
        })
        .catch(() => caches.match(BASE, { ignoreVary: true })),
    )
    return
  }
  // JS・CSS・画像はキャッシュ優先（ファイル名にハッシュが付くので内容が変われば別ファイル）
  // crossorigin 付きの読み込みは Origin ヘッダーが付くため、Vary を無視して照合する
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
`
}

// https://vite.dev/config/
export default defineConfig({
  // 公開先のサブパス（GitHub Pages では /mahjong-analyst/）。ローカルでは '/'
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), serviceWorker()],
  worker: { format: 'es' },
})
