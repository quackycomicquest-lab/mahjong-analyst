/**
 * 打牌評価エンジン（仕様 §3, §4-1 ③ Mahjong Evaluator）
 *
 * 打牌確定時点の局面スナップショット（PlayerView）と実際の打牌を受け取り、
 * 全候補を同じ局面・同じ乱数列で比較して評価する。
 *
 * - 評価点（100点満点）は「最善候補との期待値差（判断損失）」から相対的に変換する。
 *   誤差の範囲内の差は減点しない。
 * - 判断損失は評価点とは別に保持する。
 * - 危険度は経験則による推定なので、脅威がある局面の評価は「暫定」とする。
 */

import { findThreats, seenCounts, tileDanger } from '../ai/danger'
import type { Action, Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import { ukeire as calcUkeire } from '../rules/efficiency'
import { countsOfTiles, kindName, KIND_COUNT, type TileKind } from '../rules/tile'
import { simulateCandidate, type SimCandidate, type SimOutcome, type SimSetup } from './simulate'
import {
  EVALUATOR_VERSION,
  SIMULATIONS,
  type CandidateEvaluation,
  type Evaluation,
  type EvaluatorOptions,
} from './types'

/**
 * 判断損失（点）を評価点に変換する尺度の範囲。
 * 尺度 = 最善候補と候補全体の中央値との期待値差（この局面で判断がどれだけ点数を左右するか）。
 * 損失が尺度と同じとき約37点、尺度の半分で約61点。
 */
const SCALE_MIN = 120
const SCALE_MAX = 1000

type DiscardAction = Extract<Action, { type: 'discard' }>

export function evaluateDecision(
  view: PlayerView,
  action: Action,
  options: EvaluatorOptions = { mode: 'full' },
): Evaluation {
  const t0 = now()
  const mode = options.mode
  const simulations = options.simulations ?? SIMULATIONS[mode]
  const base: Omit<Evaluation, 'elapsedMs'> = {
    decisionId: view.decisionId,
    seat: view.seat,
    engineVersion: EVALUATOR_VERSION,
    mode,
    simulations,
    status: 'unavailable',
    statusReason: '',
    score: null,
    chosen: null,
    best: null,
    loss: null,
    lossStdError: null,
    confidence: 0,
    good: [],
    improve: [],
    analysis: { threats: [], stance: null, safest: null, rankExpectation: null },
    candidates: [],
  }
  if (action.type !== 'discard') {
    return { ...base, statusReason: '打牌以外の行動は評価対象外です', elapsedMs: now() - t0 }
  }

  const setup = buildSetup(view)
  const discards = view.legalActions.filter((a): a is DiscardAction => a.type === 'discard')
  const cands = uniqueCandidates(view, discards)
  const seen = seenCounts(view)
  const counts14 = countsOfTiles(view.hand)
  const meldCount = setup.melds.length
  const seed = options.seed ?? view.decisionId * 2654435761

  const results: { ev: CandidateEvaluation; sim: SimOutcome; key: string }[] = cands.map((c) => {
    const counts = counts14.slice()
    counts[c.kind]--
    const visible = seen.map((n, k) => n - counts14[k])
    const u = calcUkeire(counts, meldCount, visible)
    const sim = simulateCandidate(setup, { ...c.sim, counts }, simulations, seed)
    return {
      key: c.key,
      sim,
      ev: {
        action: c.action,
        kind: c.kind,
        riichi: c.riichi,
        label: c.label,
        shanten: u.shanten,
        ukeire: u.total,
        effectiveKinds: u.tiles.map((t) => t.kind),
        winRate: sim.winRate,
        winValue: Math.round(sim.winValue),
        immediateDealIn: setup.dealInProb[c.kind],
        dealInRate: sim.dealInRate,
        ev: Math.round(sim.mean),
        evStdError: Math.round(sim.stdError),
      },
    }
  })
  results.sort((a, b) => b.ev.ev - a.ev.ev)

  const chosenKey = candidateKey(view, action)
  const chosen = results.find((r) => r.key === chosenKey)
  if (!chosen) {
    return { ...base, statusReason: '選んだ打牌が合法手の中に見つかりません', elapsedMs: now() - t0 }
  }
  // 最善候補：期待値が最も高い候補と「誤差の範囲で同等」な候補の中から、
  // 向聴数が小さく受け入れが多いものを選ぶ（シミュレーションのばらつきで形の悪い手を最善と示さない）
  const top = results[0]
  const nearTop = results.filter((r) => top.sim.mean - r.sim.mean <= pairedStdError(top.sim.outcomes, r.sim.outcomes))
  const best = nearTop.reduce((a, b) =>
    b.ev.shanten < a.ev.shanten || (b.ev.shanten === a.ev.shanten && b.ev.ukeire > a.ev.ukeire) ? b : a,
  )
  const diffSE = pairedStdError(best.sim.outcomes, chosen.sim.outcomes)
  const loss = Math.max(0, best.sim.mean - chosen.sim.mean)
  const adjusted = Math.max(0, loss - diffSE)
  const evs = results.map((r) => r.sim.mean).sort((x, y) => x - y)
  const median = evs[Math.floor(evs.length / 2)]
  const scale = clamp(best.sim.mean - median, SCALE_MIN, SCALE_MAX)
  const score = chosen === best ? 100 : Math.round(100 * Math.exp(-adjusted / scale))
  const confidence = clamp(1 - diffSE / (300 + loss), 0.1, 0.99) * (mode === 'light' ? 0.9 : 1)

  const threats = findThreats(view)
  const safest = threats.length
    ? results.reduce((a, b) => (b.ev.immediateDealIn < a.ev.immediateDealIn ? b : a)).ev
    : null
  const minShanten = Math.min(...results.map((r) => r.ev.shanten))
  const stance =
    threats.length === 0 ? null : best.ev.immediateDealIn <= safest!.immediateDealIn + 1e-9 && best.ev.shanten > minShanten ? 'fold' : 'push'

  let status: Evaluation['status'] = 'ok'
  let statusReason = '牌効率と和了期待値のシミュレーションによる評価です'
  if (threats.length > 0) {
    status = 'provisional'
    statusReason = '放銃リスクは経験則（現物・スジ・壁など）による推定のため暫定評価です'
  } else if (diffSE > 300) {
    status = 'provisional'
    statusReason = `試行回数が少なく誤差が大きいため暫定評価です（誤差 ±${Math.round(diffSE)}点）`
  }

  const { good, improve } = comment(chosen.ev, best.ev, results.map((r) => r.ev), safest, loss, diffSE)
  return {
    ...base,
    status,
    statusReason,
    score,
    chosen: chosen.ev,
    best: best.ev,
    loss: Math.round(loss),
    lossStdError: Math.round(diffSE),
    confidence: Math.round(confidence * 100) / 100,
    good,
    improve,
    analysis: {
      threats: threats.map((t) => ({ seat: t.seat as Seat, riichi: t.riichi, weight: t.weight })),
      stance,
      safest,
      rankExpectation: null,
    },
    candidates: results.map((r) => r.ev),
    elapsedMs: Math.round(now() - t0),
  }
}

// ---------------------------------------------------------------------------
// 準備

export function buildSetup(view: PlayerView): SimSetup {
  const me = view.players[view.seat]
  const seen = seenCounts(view)
  const pool: TileKind[] = []
  for (let k = 0; k < KIND_COUNT; k++) for (let j = seen[k]; j < 4; j++) pool.push(k)

  const threats = findThreats(view)
  const dealInProb = new Float64Array(KIND_COUNT)
  const dealInLoss = new Float64Array(KIND_COUNT)
  // 他家の打牌1回あたりに、他家同士の和了で局が終わる確率（流局率が実戦並みになる値）
  let hazard = 0.03
  for (const t of threats) {
    const dealer = t.seat === view.round.dealer
    const loss = t.riichi ? (dealer ? 9600 : 6400) : dealer ? 5800 : 3900
    hazard += t.riichi ? 0.025 : 0.024 * t.weight
    for (let k = 0; k < KIND_COUNT; k++) {
      const p = (t.weight * tileDanger(k, t, seen, 3)) / 100
      dealInLoss[k] = dealInProb[k] + p > 0 ? (dealInLoss[k] * dealInProb[k] + loss * p) / (dealInProb[k] + p) : 0
      dealInProb[k] += p
    }
  }
  for (let k = 0; k < KIND_COUNT; k++) dealInProb[k] = Math.min(dealInProb[k], 0.5)

  return {
    view,
    melds: me.melds,
    menzen: me.melds.every((m) => m.type === 'ankan'),
    pool,
    ownTurns: Math.floor(view.wallRemaining / 4),
    dealInProb,
    dealInLoss,
    otherEndHazard: hazard,
    hasThreat: threats.length > 0,
    riverKinds: me.river.map((r) => r.tile.kind),
    kyoutaku: view.round.kyoutaku,
    honba: view.round.honba,
  }
}

interface Cand {
  key: string
  action: DiscardAction
  kind: TileKind
  riichi: boolean
  label: string
  sim: Omit<SimCandidate, 'counts'>
}

function candidateKey(view: PlayerView, a: Action): string {
  if (a.type !== 'discard') return ''
  const t = view.hand.find((h) => h.id === a.tileId)!
  return `${t.kind}:${t.red ? 'r' : ''}:${a.riichi ? 'R' : ''}`
}

/** 同じ種類・同じ赤・同じ立直有無の打牌は1候補にまとめる */
function uniqueCandidates(view: PlayerView, discards: DiscardAction[]): Cand[] {
  const out = new Map<string, Cand>()
  for (const a of discards) {
    const key = candidateKey(view, a)
    if (out.has(key)) continue
    const t = view.hand.find((h) => h.id === a.tileId)!
    const redKinds = view.hand.filter((h) => h.red && h.id !== t.id).map((h) => h.kind)
    out.set(key, {
      key,
      action: a,
      kind: t.kind,
      riichi: !!a.riichi,
      label: `${t.red ? '赤' : ''}${kindName(t.kind)}${a.riichi ? '（立直）' : ''}`,
      sim: { kind: t.kind, riichi: !!a.riichi, redKinds },
    })
  }
  return [...out.values()]
}

// ---------------------------------------------------------------------------
// 解説（仕様 §3-2 レベル1「良かった点・改善点」）

function comment(
  chosen: CandidateEvaluation,
  best: CandidateEvaluation,
  all: CandidateEvaluation[],
  safest: CandidateEvaluation | null,
  loss: number,
  diffSE: number,
): { good: string[]; improve: string[] } {
  const good: string[] = []
  const improve: string[] = []
  const nearBest = chosen === best || loss <= diffSE
  if (chosen === best) good.push('最善手を選べています')
  else if (nearBest) good.push(`最善手（${best.label}）との差は誤差の範囲です`)

  if (chosen.shanten > best.shanten) {
    improve.push(`向聴数が戻る選択です（${best.label}なら${best.shanten}向聴、${chosen.label}は${chosen.shanten}向聴）`)
  } else {
    const maxUkeire = Math.max(...all.filter((c) => c.shanten === chosen.shanten).map((c) => c.ukeire))
    if (chosen.ukeire >= maxUkeire) good.push(`受け入れ枚数が最大です（${chosen.ukeire}枚）`)
    else if (!nearBest && best.shanten === chosen.shanten && best.ukeire - chosen.ukeire >= 2) {
      improve.push(`受け入れが${best.ukeire - chosen.ukeire}枚少ない選択です（${chosen.ukeire}枚／${best.label}は${best.ukeire}枚）`)
    }
  }
  if (safest) {
    if (chosen.immediateDealIn === 0) good.push('他家の脅威に対して安全な牌を選べています')
    else if (chosen.immediateDealIn - safest.immediateDealIn >= 0.03 && !nearBest) {
      improve.push(
        `他家の立直・仕掛けに対して危険な牌です（推定放銃率${(chosen.immediateDealIn * 100).toFixed(0)}%、${safest.label}なら${(safest.immediateDealIn * 100).toFixed(0)}%）`,
      )
    }
  }
  if (!nearBest && chosen.kind === best.kind && chosen.riichi !== best.riichi) {
    improve.push(`${best.riichi ? '立直' : 'ダマ'}の方が期待値が${Math.round(loss)}点高い局面です`)
  }
  if (!nearBest && chosen.shanten === best.shanten && chosen.winValue > 0 && chosen.winValue < best.winValue * 0.8) {
    improve.push(`和了時の打点が下がります（平均${chosen.winValue}点／${best.label}は${best.winValue}点）`)
  }
  if (!nearBest && improve.length === 0) {
    improve.push(`${best.label}の方が期待値が${Math.round(loss)}点高い選択でした`)
  }
  return { good, improve }
}

// ---------------------------------------------------------------------------

function pairedStdError(a: Float64Array, b: Float64Array): number {
  const n = a.length
  if (n < 2) return 0
  let mean = 0
  for (let i = 0; i < n; i++) mean += a[i] - b[i]
  mean /= n
  let v = 0
  for (let i = 0; i < n; i++) v += (a[i] - b[i] - mean) ** 2
  return Math.sqrt(v / (n - 1) / n)
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
