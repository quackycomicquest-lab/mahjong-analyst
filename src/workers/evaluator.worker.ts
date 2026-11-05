/**
 * 打牌評価を UI と別スレッドで動かす Web Worker（仕様 §4-3, §5-3）
 */
import { evaluateDecision } from '../engine/evaluator/evaluate'
import type { EvaluationMode } from '../engine/evaluator/types'
import type { Action } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'

export interface EvaluateRequest {
  id: number
  view: PlayerView
  action: Action
  mode: EvaluationMode
}

self.onmessage = (e: MessageEvent<EvaluateRequest>) => {
  const { id, view, action, mode } = e.data
  try {
    const evaluation = evaluateDecision(view, action, { mode })
    self.postMessage({ id, evaluation })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
