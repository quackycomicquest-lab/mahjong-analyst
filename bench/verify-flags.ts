/**
 * 「要検証」の判断を詳しく調べる（npx tsx bench/verify-flags.ts <書き出したJSON> [試行回数=3000]）
 *
 * アプリの弱点分析の画面で「書き出す（JSON）」したファイルを読み、各判断を試行回数を増やして
 * 乱数を変えながら再評価し、候補ごとの期待値（±標準誤差）と和了率・放銃率を並べる。
 * 「乱数の誤差で点が低く出た」のか「評価方法の問題か」を、候補の期待値差と誤差の大きさで確かめる。
 */
import { readFileSync } from 'node:fs'
import { evaluateDecision } from '../src/engine/evaluator/evaluate'
import { EVALUATOR_VERSION } from '../src/engine/evaluator/types'
import { kindName } from '../src/engine/rules/tile'
import type { FlagRecord, StoredEvaluation } from '../src/storage/db'

const [file, simsArg] = process.argv.slice(2)
if (!file) {
  console.error('使い方: npx tsx bench/verify-flags.ts <mahjong-flags-YYYY-MM-DD.json> [試行回数]')
  process.exit(1)
}
const simulations = Number(simsArg ?? 3000)
const data = JSON.parse(readFileSync(file, 'utf8')) as {
  kind: string
  engineVersion: string
  items: { flag: FlagRecord; record: StoredEvaluation }[]
}
if (data.kind !== 'mahjong-analyst/flags') throw new Error('要検証の書き出しファイルではありません')

console.log(`要検証 ${data.items.length}件（書き出し時 ${data.engineVersion} → 現在 ${EVALUATOR_VERSION}、1回 ${simulations} 試行 × 3）`)
const seeds = [11, 22, 33]
for (const { flag, record } of data.items) {
  // 復習問題で印をつけたものは、そのときの答えで再評価する
  const orig = flag.answer?.evaluation ?? record.evaluation
  const action = flag.answer?.action ?? record.action
  const runs = seeds.map((seed) => evaluateDecision(record.snapshot, action, { mode: 'full', simulations, seed }))
  const hand = [...record.snapshot.hand].sort((a, b) => a.kind - b.kind).map((t) => kindName(t.kind))
  console.log(`\n■ ${record.roundLabel} ${flag.answer ? `${flag.answer.label}（復習の答え）` : record.label}（元 ${orig.score}点・最善 ${orig.best?.label}）理由 [${flag.reasons.join(',')}] ${flag.note}`)
  console.log(`  手牌 ${hand.join(' ')}  残り${record.snapshot.wallRemaining}枚`)
  console.log(`  再評価 ${runs.map((r) => `${r.score}点/最善${r.best?.label}`).join('  ')}`)
  const last = runs[runs.length - 1]
  const shown = last.candidates.slice(0, 6)
  const mine = last.candidates.find((c) => c.label === last.chosen?.label)
  if (mine && !shown.includes(mine)) shown.push(mine)
  for (const c of shown) {
    const mark = c.label === last.chosen?.label ? '←あなた' : c.label === last.best?.label ? '←最善' : ''
    console.log(
      `   ${c.label.padEnd(8, '　')} EV${String(c.ev).padStart(6)}±${String(c.evStdError).padStart(3)} 和了${(c.winRate * 100).toFixed(1).padStart(5)}% 打点${String(c.winValue).padStart(6)} 放銃${(c.dealInRate * 100).toFixed(1).padStart(5)}% ${c.shanten}向聴 受入${c.ukeire} ${mark}`,
    )
  }
  console.log(`  改善点: ${last.improve.join(' / ') || '-'}`)
}
