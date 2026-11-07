/**
 * 定石・統計との照合（npx tsx bench/strategy-check.ts [試行回数=1000] [乱数...]）
 *
 * bench/strategy-cases.ts の自作の局面を評価エンジンにかけ、定石どおりの判断になっているかを確かめる。
 * 乱数を変えて複数回評価し、全ての回で条件を満たせば ○、一部なら △、満たさなければ ×。
 */
import { evaluateDecision } from '../src/engine/evaluator/evaluate'
import { EVALUATOR_VERSION, type Evaluation } from '../src/engine/evaluator/types'
import { STRATEGY_CASES, type StrategyCase } from './strategy-cases'

const sims = Number(process.argv[2] ?? 1000)
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1, 7]

const matchLabel = (label: string, pats: string[]) =>
  pats.some((p) => (p.endsWith('*') ? label.startsWith(p.slice(0, -1)) : label === p))

function check(c: StrategyCase, e: Evaluation): string[] {
  const fails: string[] = []
  const best = e.best!
  if (c.best && !matchLabel(best.label, c.best)) fails.push(`最善が ${best.label}（期待：${c.best.join('／')}）`)
  if (c.bestCheck?.shanten !== undefined && best.shanten !== c.bestCheck.shanten)
    fails.push(`最善 ${best.label} の向聴数 ${best.shanten}（期待 ${c.bestCheck.shanten}）`)
  if (c.bestCheck?.immediateDealIn !== undefined && best.immediateDealIn > c.bestCheck.immediateDealIn + 1e-9)
    fails.push(`最善 ${best.label} の放銃率 ${(best.immediateDealIn * 100).toFixed(1)}%（現物でない）`)
  if (c.minScore !== undefined && e.score! < c.minScore) fails.push(`評価点 ${e.score}（期待 ${c.minScore}点以上）`)
  if (c.maxScore !== undefined && e.score! > c.maxScore) fails.push(`評価点 ${e.score}（期待 ${c.maxScore}点以下）`)
  return fails
}

console.log(`定石・統計との照合（${EVALUATOR_VERSION}、1候補 ${sims} 試行、乱数 ${seeds.join('・')}）\n`)
let pass = 0
for (const c of STRATEGY_CASES) {
  const runs = seeds.map((seed) => {
    const v = c.view()
    const e = evaluateDecision(v, c.action(v), { mode: 'full', simulations: sims, seed })
    return { e, fails: check(c, e) }
  })
  const ok = runs.filter((r) => r.fails.length === 0).length
  const mark = ok === runs.length ? '○' : ok > 0 ? '△' : '×'
  if (ok === runs.length) pass++
  console.log(`${mark} ${c.id} [${c.category}] ${c.claim}`)
  for (const [i, r] of runs.entries()) {
    const top = r.e.candidates
      .slice(0, 4)
      .map((x) => `${x.label} ${x.ev}`)
      .join(' / ')
    console.log(`    乱数${seeds[i]}: 評価${r.e.score}点 最善 ${r.e.best!.label}  [${top}]${r.fails.length ? '  ← ' + r.fails.join('、') : ''}`)
  }
}
console.log(`\n${pass} / ${STRATEGY_CASES.length} 件が全ての乱数で定石どおり`)
