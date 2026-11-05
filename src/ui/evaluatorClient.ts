/**
 * 評価 Worker の呼び出し口。Worker が使えない環境ではメインスレッドで評価する。
 */
import { evaluateDecision } from '../engine/evaluator/evaluate'
import type { Evaluation, EvaluationMode } from '../engine/evaluator/types'
import type { Action } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'

type Pending = { resolve: (e: Evaluation) => void; reject: (err: Error) => void }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('../workers/evaluator.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; evaluation?: Evaluation; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.evaluation) p.resolve(e.data.evaluation)
      else p.reject(new Error(e.data.error ?? '評価に失敗しました'))
    }
  } catch {
    worker = null
  }
  return worker
}

/** 端末に合わせた評価モード（iPhone などは軽量評価） */
export function defaultEvaluationMode(): EvaluationMode {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return /iPhone|iPad|iPod|Android/i.test(ua) ? 'light' : 'full'
}

export function requestEvaluation(view: PlayerView, action: Action, mode: EvaluationMode): Promise<Evaluation> {
  const w = getWorker()
  if (!w) return Promise.resolve(evaluateDecision(view, action, { mode }))
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, view, action, mode })
  })
}
