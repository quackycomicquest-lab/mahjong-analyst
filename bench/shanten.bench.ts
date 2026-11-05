/**
 * シャンテン数・牌効率の速度計測（npm run bench）
 * ゴールデンデータの手牌を使って 1手あたりの平均時間を出す。
 */
import golden from '../src/engine/rules/__fixtures__/shanten-golden.json'
import { discardOptions } from '../src/engine/rules/efficiency'
import { calculateShanten } from '../src/engine/rules/shanten'

interface C { counts: number[]; melds: number }
const cases = (golden as { cases: C[] }).cases
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

function time(label: string, n: number, fn: () => void) {
  fn() // ウォームアップ
  const t = performance.now()
  fn()
  const ms = performance.now() - t
  console.log(`${label}: ${((ms / n) * 1000).toFixed(2)}µs/回（${n}回）`)
}

{
  // キャッシュが空の状態（初回）。以降の計測はキャッシュが温まった状態になる。
  const t = performance.now()
  for (const c of cases) calculateShanten(c.counts, c.melds)
  const ms = performance.now() - t
  console.log(`calculateShanten（初回・キャッシュなし）: ${((ms / cases.length) * 1000).toFixed(2)}µs/回`)
}
time('calculateShanten', cases.length, () => {
  for (const c of cases) calculateShanten(c.counts, c.melds)
})
const fourteen = cases.filter((c) => c.melds === 0 && sum(c.counts) === 14).slice(0, 500)
time('discardOptions（14枚・全打牌候補）', fourteen.length, () => {
  for (const c of fourteen) discardOptions(c.counts)
})
