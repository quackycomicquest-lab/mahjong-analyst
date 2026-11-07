/**
 * 要検証の受け取り口（docs/flags-workflow.md）
 *
 *   npx tsx bench/flags-inbox.ts [--dir <フォルダ>] [--all]   … 新しく届いた判断を local-data/flags-inbox/pending.json にまとめる
 *   npx tsx bench/flags-inbox.ts --mark [<JSON>]              … その JSON の判断を「分析済み」として記録する（既定は pending.json）
 *
 * アプリの「Mac へ送る」で iCloud Drive の MahjongAnalyst フォルダに保存されたファイルのうち、最も新しいものを読む
 * （見つからなければ ~/Downloads）。分析済みの記録（local-data/flags-ledger.json）にない判断と、
 * 分析した後に理由・メモを書き換えた判断だけを取り出す。--all なら全件。
 * 個人の対局データなので local-data/ は git に入れない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVALUATOR_VERSION } from '../src/engine/evaluator/types'
import type { FlagRecord, StoredEvaluation } from '../src/storage/db'

interface Export {
  kind: string
  exportedAt: string
  engineVersion: string
  items: { flag: FlagRecord; record: StoredEvaluation }[]
}
interface Ledger {
  /** `${gameId}:${decisionId}` → 分析した時点の印の中身（理由・メモ・復習の答え）・エンジン・日時 */
  done: Record<string, { sig: string; engineVersion: string; at: string }>
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOCAL = join(ROOT, 'local-data')
const LEDGER = join(LOCAL, 'flags-ledger.json')
const INBOX = join(LOCAL, 'flags-inbox')
const PENDING = join(INBOX, 'pending.json')
const DEFAULT_DIRS = [
  join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/MahjongAnalyst'),
  join(homedir(), 'Downloads'),
]

const args = process.argv.slice(2)
const key = (f: FlagRecord) => `${f.gameId}:${f.decisionId}`
/** 印の中身。アプリの「まとめて再評価」でも updatedAt は変わるので、利用者が書いた部分だけで比べる */
const sig = (f: FlagRecord) => JSON.stringify([[...f.reasons].sort(), f.note.trim(), f.answer?.label ?? null])
const loadLedger = (): Ledger => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { done: {} })
const read = (file: string): Export => {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Export
  if (data.kind !== 'mahjong-analyst/flags') throw new Error(`${file} は要検証の書き出しファイルではありません`)
  return data
}
mkdirSync(INBOX, { recursive: true })

if (args[0] === '--mark') {
  const file = args[1] ?? PENDING
  const ledger = loadLedger()
  const data = read(file)
  const at = new Date().toISOString()
  for (const { flag } of data.items) ledger.done[key(flag)] = { sig: sig(flag), engineVersion: EVALUATOR_VERSION, at }
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n')
  console.log(`${data.items.length}件を分析済みとして記録しました（合計 ${Object.keys(ledger.done).length}件、${LEDGER}）`)
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const dirs = dirArg >= 0 ? [args[dirArg + 1]] : DEFAULT_DIRS
const candidates = dirs.flatMap((d) => {
  try {
    return readdirSync(d)
      .filter((n) => /^mahjong-flags-.*\.json$/.test(n))
      .map((n) => join(d, n))
  } catch {
    return []
  }
})
if (candidates.length === 0) {
  console.error(`要検証のファイル（mahjong-flags-*.json）が見つかりません：${dirs.join('、')}`)
  console.error('アプリの弱点分析の画面で「Mac へ送る」→「"ファイル"に保存」→ iCloud Drive の MahjongAnalyst を選んでください。')
  process.exit(1)
}
// 最新の書き出し（中身の exportedAt で比べ、同じならファイルの更新日時）
const newest = candidates
  .map((file) => ({ file, data: read(file), mtime: statSync(file).mtimeMs }))
  .sort((a, b) => b.data.exportedAt.localeCompare(a.data.exportedAt) || b.mtime - a.mtime)[0]

const ledger = loadLedger()
const all = args.includes('--all')
const fresh = newest.data.items.filter(({ flag }) => {
  if (all) return true
  const d = ledger.done[key(flag)]
  return !d || d.sig !== sig(flag)
})
writeFileSync(PENDING, JSON.stringify({ ...newest.data, items: fresh }))

console.log(`最新の書き出し：${newest.file}`)
console.log(`  書き出し ${newest.data.exportedAt}（アプリのエンジン ${newest.data.engineVersion} → 今 ${EVALUATOR_VERSION}）・全 ${newest.data.items.length}件`)
console.log(`  分析済み ${newest.data.items.length - fresh.length}件 ／ 新しい・書き換えた判断 ${fresh.length}件 → ${PENDING}`)
for (const { flag, record } of fresh) {
  const ev = flag.answer?.evaluation ?? record.evaluation
  const label = flag.answer ? `${flag.answer.label}（復習の答え）` : record.label
  const reasons = flag.reasons.length ? ` [${flag.reasons.join(',')}]` : ''
  const note = flag.note ? ` 「${flag.note}」` : ''
  console.log(`  - ${record.roundLabel} ${label} ${ev.score ?? '—'}点（最善 ${ev.best?.label ?? '—'}・${ev.mode}）${reasons}${note}`)
}
