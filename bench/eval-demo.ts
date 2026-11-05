/**
 * 打牌評価のデモ（npm run eval-demo）：代表的な局面で評価結果と処理時間を表示する
 */
import { evaluateDecision } from '../src/engine/evaluator/evaluate'
import type { EvaluationMode } from '../src/engine/evaluator/types'
import type { Action } from '../src/engine/game/types'
import { parseHand } from '../src/engine/rules/tile'
import { makeView, type ViewSpec } from '../src/engine/testing/makeView'

function show(title: string, spec: ViewSpec, choose: string, opts: { riichi?: boolean; mode?: EvaluationMode } = {}) {
  const view = makeView(spec)
  const k = parseHand(choose)[0].kind
  const action = view.legalActions.find(
    (a) => a.type === 'discard' && view.hand.find((t) => t.id === a.tileId)!.kind === k && !!a.riichi === !!opts.riichi,
  ) as Action
  const e = evaluateDecision(view, action, { mode: opts.mode ?? 'full', seed: 1 })
  console.log(`\n■ ${title}  手牌 ${spec.hand}  選択 ${e.chosen?.label}  [${e.mode} ${e.elapsedMs}ms]`)
  console.log(`  評価 ${e.score}点  損失 ${e.loss}±${e.lossStdError}  最善 ${e.best?.label}  信頼度 ${e.confidence}  ${e.status}`)
  console.log(`  良い点: ${e.good.join(' / ') || '-'}`)
  console.log(`  改善点: ${e.improve.join(' / ') || '-'}`)
  for (const c of e.candidates.slice(0, 6)) {
    console.log(
      `   ${c.label.padEnd(8, '　')} EV${String(c.ev).padStart(6)}±${String(c.evStdError).padStart(3)} 和了${(c.winRate * 100).toFixed(0).padStart(3)}% 打点${String(c.winValue).padStart(6)} 放銃${(c.dealInRate * 100).toFixed(0).padStart(3)}% ${c.shanten}向聴 受入${c.ukeire}`,
    )
  }
}

show('仕様§3-1の例', { hand: '123456m2345p78s11z' }, '1z')
show('仕様§3-1の例（最善）', { hand: '123456m2345p78s11z' }, '2p')
show('両面を崩す', { hand: '23m456p789s1357z36s' }, '2m')
show('立直者に対して遠い手', { hand: '45m79m24p68p159s136z', rivers: { 2: ['2z', '5m*'] } }, '1z')
show('役なし聴牌：立直', { hand: '123m456p789s24s99m1z', riichiAllowed: true }, '1z', { riichi: true })
show('役なし聴牌：ダマ', { hand: '123m456p789s24s99m1z', riichiAllowed: true }, '1z')
show('軽量モード（iPhone想定）', { hand: '123456m2345p78s11z' }, '1z', { mode: 'light' })
show('役なし両面聴牌：立直', { hand: '123m456p999m23s55s1z', riichiAllowed: true }, '1z', { riichi: true })
show('ドラ1・役なし両面：立直', { hand: '123m456p999m23s55s1z', riichiAllowed: true, dora: '4s' }, '1z', { riichi: true })
