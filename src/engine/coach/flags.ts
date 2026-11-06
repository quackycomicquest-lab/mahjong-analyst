/**
 * 「要検証」の印をつけた判断の再評価と集計
 *
 * 評価に疑問が残る判断は、振り返り画面で「要検証」にしておき、弱点分析の画面でまとめて再評価する。
 * 再評価は試行回数を増やし、乱数を変えて数回行う。回ごとの点数のばらつきと最善手の変化を見れば、
 * 「乱数の誤差で点が低く出た」のか「評価方法そのものの問題（再評価しても同じ）」なのかを分けられる。
 */
import type { FlagReason, FlagRecord, FlagVerification } from '../../storage/db'

/** 再評価：1回あたりの試行回数と、回ごとの乱数 */
export const VERIFY_SIMULATIONS = 1200
export const VERIFY_SEEDS = [101, 202, 303]

export type VerifyVerdict =
  /** 再評価しても点数がほぼ同じ（評価方法そのものを疑う） */
  | 'stable'
  /** 回によって点数が大きく変わる、または元の点数から大きく変わった（試行回数不足・乱数の誤差） */
  | 'noisy'
  /** 最善手が回によって変わる、または元の最善手と違う */
  | 'bestChanged'

export interface VerifySummary {
  original: number
  mean: number
  min: number
  max: number
  verdict: VerifyVerdict
}

/** 点数がこれ以上ずれたら「誤差が大きい」とみなす */
export const NOISY_POINTS = 15

export function summarizeVerification(originalScore: number, originalBest: string, v: FlagVerification): VerifySummary {
  const mean = v.scores.reduce((a, b) => a + b, 0) / v.scores.length
  const min = Math.min(...v.scores)
  const max = Math.max(...v.scores)
  const bestChanged = v.bestLabels.some((b) => b !== originalBest)
  const noisy = max - min > NOISY_POINTS || Math.abs(mean - originalScore) > NOISY_POINTS
  return { original: originalScore, mean, min, max, verdict: bestChanged ? 'bestChanged' : noisy ? 'noisy' : 'stable' }
}

export const VERDICT_LABELS: Record<VerifyVerdict, string> = {
  stable: '再評価でも同じ（評価方法を見直す候補）',
  noisy: '回によって点数が変わる（誤差が大きい）',
  bestChanged: '最善手が変わる（候補の差が小さい）',
}

/** 理由ごと・判定ごとの件数 */
export function tallyFlags(flags: FlagRecord[], verdictOf: (f: FlagRecord) => VerifyVerdict | null) {
  const byReason = new Map<FlagReason, number>()
  const byVerdict = new Map<VerifyVerdict | 'unverified', number>()
  for (const f of flags) {
    for (const r of f.reasons) byReason.set(r, (byReason.get(r) ?? 0) + 1)
    const v = verdictOf(f) ?? 'unverified'
    byVerdict.set(v, (byVerdict.get(v) ?? 0) + 1)
  }
  return { byReason, byVerdict }
}
