/**
 * 打牌評価の結果（仕様 §3-2 表示項目、§3-4 履歴として保存する項目）
 */

import type { Action, Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import type { TileKind } from '../rules/tile'

export const EVALUATOR_VERSION = 'evaluator-0.2.0'

/** full = Mac 向け高精度、light = iPhone 向け軽量（試行回数だけが違い、ロジックは共通） */
export type EvaluationMode = 'full' | 'light'

export interface EvaluatorOptions {
  mode: EvaluationMode
  /** 候補1つあたりのシミュレーション回数（mode から既定値が決まる） */
  simulations?: number
  /** 乱数 seed（同じ局面・同じ seed なら同じ結果） */
  seed?: number
}

export const SIMULATIONS: Record<EvaluationMode, number> = { full: 400, light: 100 }

/** 評価した判断の種類 */
export type DecisionType = 'discard' | 'call' | 'win' | 'kan' | 'kyuushu'

/** 候補1つの評価（打牌・鳴き・カン・和了・スキップなど） */
export interface CandidateEvaluation {
  /** その場で選べた行動 */
  action: Action
  /** この候補で切る牌（鳴きは鳴いた後に切る牌。スキップ・和了などは null） */
  kind: TileKind | null
  riichi: boolean
  label: string
  // --- レベル2：詳細
  shanten: number
  /** 受け入れ枚数（見えている牌を除く） */
  ukeire: number
  effectiveKinds: TileKind[]
  /** この局で和了する確率（推定） */
  winRate: number
  /** 和了したときの平均点（推定） */
  winValue: number
  /** この牌での即時放銃率（推定、%ではなく 0〜1） */
  immediateDealIn: number
  /** この局で放銃する確率（推定、以後の打牌を含む） */
  dealInRate: number
  // --- 期待値
  /** この局の収支の期待値（点）。和了・放銃・流局時の聴牌料・立直棒を含む */
  ev: number
  /** ev の標準誤差 */
  evStdError: number
}

export type EvaluationStatus =
  /** 評価できた */
  | 'ok'
  /** 推定に近似（危険度の経験則など）を含むため暫定 */
  | 'provisional'
  /** 評価できない（打牌以外の行動など）。点数は出さない */
  | 'unavailable'

export interface Evaluation {
  /** 評価した局面ID（PlayerView.decisionId） */
  decisionId: number
  /** 打牌・鳴き・和了・カン・九種九牌 */
  decision: DecisionType
  seat: Seat
  engineVersion: string
  mode: EvaluationMode
  simulations: number
  elapsedMs: number
  status: EvaluationStatus
  /** status の理由 */
  statusReason: string

  // --- レベル1：簡易評価
  /** 100点満点の評価点（unavailable のときは null） */
  score: number | null
  chosen: CandidateEvaluation | null
  best: CandidateEvaluation | null
  /** 判断損失 = 最善の期待値 − 選んだ打牌の期待値（点、0以上） */
  loss: number | null
  /** 損失の標準誤差（同じ乱数列で比べた差の誤差） */
  lossStdError: number | null
  /** 0〜1。試行回数と誤差から決まる */
  confidence: number
  good: string[]
  improve: string[]

  // --- レベル3：専門分析
  analysis: {
    /** 立直・2副露以上の相手 */
    threats: { seat: Seat; riichi: boolean; weight: number }[]
    /** 押し引きの推奨（脅威がなければ null） */
    stance: 'push' | 'fold' | null
    /** 最も安全な候補（脅威がなければ null） */
    safest: CandidateEvaluation | null
    /** 順位期待値（未対応） */
    rankExpectation: null
    /** 立直判断（同じ牌で立直とダマを選べたとき） */
    riichi: { tile: string; riichiEv: number; damaEv: number; recommended: 'riichi' | 'dama'; chosen: 'riichi' | 'dama' } | null
  }

  /** 全候補の評価（期待値の高い順） */
  candidates: CandidateEvaluation[]
}

/** 保存用の記録（仕様 §3-4）。局面スナップショットと実際の打牌を含む */
export interface EvaluationRecord {
  snapshot: PlayerView
  action: Action
  evaluation: Evaluation
  createdAt: string
}
