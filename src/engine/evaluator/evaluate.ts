/**
 * 判断評価エンジン（仕様 §3, §4-1 ③ Mahjong Evaluator）
 *
 * 判断直前の局面スナップショット（PlayerView）と実際の行動を受け取り、
 * その場で選べた全ての行動を同じ局面・同じ乱数列で比較して評価する。
 *
 * 評価できる判断
 * - 打牌（立直・ダマの選択を含む）
 * - 鳴き：ポン・チー・大明槓・スキップ（鳴いた場合は、鳴いた後の打牌まで含めて最善のものを比べる）
 * - 和了：ロン・ツモ（見逃して続けた場合と比べる）
 * - カン：暗槓・加槓（カンしない打牌と比べる）
 * - 九種九牌（流局させない打牌と比べる）
 *
 * - 評価点（100点満点）は「最善候補との期待値差（判断損失）」から相対的に変換する。誤差の範囲の差は減点しない。
 * - 判断損失は評価点とは別に保持する。
 * - 危険度など推定に近似を含む局面は「暫定」とする。
 */

import { findThreats, seenCounts, tileDanger } from '../ai/danger'
import { dealInLoss as dealInLossFor, futureDealIn, otherEndHazard, riichiAppearRate } from '../calibration/calibration'
import { chiForbidden } from '../game/game'
import type { Action, CalledMeld, Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import { ukeire as calcUkeire } from '../rules/efficiency'
import { calculateHandValue } from '../rules/score'
import { waitingKinds } from '../rules/agari'
import { calculateShanten } from '../rules/shanten'
import { countsOfTiles, kindName, KIND_COUNT, type PhysicalTile, type TileKind } from '../rules/tile'
import type { Meld } from '../rules/types'
import { simulateCandidate, type SimCandidate, type SimSetup } from './simulate'
import {
  EVALUATOR_VERSION,
  SIMULATIONS,
  type CandidateEvaluation,
  type DecisionType,
  type Evaluation,
  type EvaluatorOptions,
} from './types'

/**
 * 判断損失（点）を評価点に変換する尺度の範囲。
 * 打牌：最善候補と候補全体の中央値との期待値差（この局面で判断がどれだけ点数を左右するか）。
 * 鳴き・和了など候補が少ない判断：最善の期待値の大きさも考慮する。
 * 損失が尺度と同じとき約37点、尺度の半分で約61点。
 */
const SCALE_MIN = 500
const SCALE_MAX = 1000
/** 鳴いた後の打牌は、向聴数・受け入れの上位この数だけシミュレーションする */
const CALL_DISCARD_VARIANTS = 3
/**
 * 期待値の上位この数の候補と、選んだ候補は、試行を足して比べ直す（v0.4.0）。
 * 最善手と評価点を決めるのはこれらの差なので、ここに試行を集めると少ない計算でぶれが減る
 * （軽量評価の 100 試行では、同じ局面でも評価点が 20〜40 点ぶれていた）。
 */
const REFINE_TOP = 4
/** 足す試行の数（最初の試行回数の何倍か） */
const REFINE_FACTOR = 2

type Group = 'discard' | 'pass' | 'call' | 'win' | 'kan' | 'kyuushu'

interface Variant {
  sim: SimCandidate
  /** 受け入れ計算用：この候補の後の手牌（3n+1枚）と副露数 */
  counts: number[]
  meldCount: number
  kind: TileKind | null
  label: string
}

interface CandSpec {
  key: string
  group: Group
  action: Action
  riichi: boolean
  /** 確定している収支（和了・九種九牌） */
  fixed?: { ev: number; label: string; winValue: number }
  variants?: Variant[]
}

interface Result {
  key: string
  group: Group
  ev: CandidateEvaluation
  outcomes: Float64Array
  mean: number
  /** 試行を足すときに使う（固定の収支なら fixed） */
  spec: CandSpec
  variant: Variant | null
}

export function evaluateDecision(
  view: PlayerView,
  action: Action,
  options: EvaluatorOptions = { mode: 'full' },
): Evaluation {
  const t0 = now()
  const mode = options.mode
  const simulations = options.simulations ?? SIMULATIONS[mode]
  const decision = decisionTypeOf(action)
  const base: Omit<Evaluation, 'elapsedMs'> = {
    decisionId: view.decisionId,
    decision: decision ?? 'discard',
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
    analysis: { threats: [], stance: null, safest: null, rankExpectation: null, riichi: null },
    candidates: [],
  }
  if (!decision) return { ...base, statusReason: 'この行動は評価対象外です', elapsedMs: now() - t0 }

  const setup = buildSetup(view)
  const seen = seenCounts(view)
  const seed = options.seed ?? view.decisionId * 2654435761
  const specs = view.responseTo ? responseCandidates(view, setup) : turnCandidates(view, setup)
  const results = specs.map((s) => runSpec(s, setup, seen, simulations, seed))
  results.sort((a, b) => b.mean - a.mean)

  const chosenKey = actionKey(view, action)
  const chosen0 = results.find((r) => r.key === chosenKey)
  if (!chosen0) {
    return { ...base, statusReason: '選んだ行動が合法手の中に見つかりません', elapsedMs: now() - t0 }
  }
  // 上位の候補と選んだ候補に試行を足す（同じ乱数列の続きを使うので、候補どうしの比較はそのまま対になる）
  const refine = new Set([...results.slice(0, REFINE_TOP), chosen0])
  if (results.length > 1) {
    for (const r of refine) refineResult(r, setup, simulations * REFINE_FACTOR, seed + simulations * 7919)
    results.sort((a, b) => b.mean - a.mean)
  }
  const chosen = chosen0

  // 最善候補：期待値が最も高い候補と「誤差の範囲で同等」な候補のうち、
  // 打牌同士なら向聴数が小さく受け入れが多いもの（シミュレーションのばらつきで形の悪い手を最善と示さない）
  const top = results[0]
  const nearTop = results.filter((r) => top.mean - r.mean <= pairedStdError(top.outcomes, r.outcomes))
  const best =
    top.group === 'discard'
      ? nearTop
          .filter((r) => r.group === 'discard')
          .reduce((a, b) =>
            b.ev.shanten < a.ev.shanten || (b.ev.shanten === a.ev.shanten && b.ev.ukeire > a.ev.ukeire) ? b : a,
          )
      : top
  const diffSE = pairedStdError(best.outcomes, chosen.outcomes)
  const loss = Math.max(0, best.mean - chosen.mean)
  const adjusted = Math.max(0, loss - diffSE)
  const evs = results.map((r) => r.mean).sort((x, y) => x - y)
  const median = evs[Math.floor(evs.length / 2)]
  const stake = decision === 'discard' ? best.mean - median : Math.max(best.mean - median, Math.abs(best.mean) * 0.5, 300)
  const scale = clamp(stake, SCALE_MIN, SCALE_MAX)
  const score = chosen === best ? 100 : Math.round(100 * Math.exp(-adjusted / scale))
  const confidence = clamp(1 - diffSE / (300 + loss), 0.1, 0.99) * (mode === 'light' ? 0.9 : 1)

  const threats = findThreats(view)
  const withTile = results.filter((r) => r.ev.kind !== null)
  const safest =
    threats.length && withTile.length
      ? withTile.reduce((a, b) => (b.ev.immediateDealIn < a.ev.immediateDealIn ? b : a)).ev
      : null
  const minShanten = Math.min(...results.map((r) => r.ev.shanten))
  const stance =
    threats.length === 0 || !safest
      ? null
      : best.ev.immediateDealIn <= safest.immediateDealIn + 1e-9 && best.ev.shanten > minShanten
        ? 'fold'
        : 'push'

  let status: Evaluation['status'] = 'ok'
  let statusReason = '牌効率と和了期待値のシミュレーションによる評価です'
  if (threats.length > 0) {
    status = 'provisional'
    statusReason = '放銃リスクは牌の分類ごとの実測放銃率による推定のため暫定評価です'
  } else if (decision === 'kan') {
    status = 'provisional'
    statusReason = 'カンで増える新ドラはまだ考慮していないため暫定評価です'
  } else if (diffSE > 300) {
    status = 'provisional'
    statusReason = `試行回数が少なく誤差が大きいため暫定評価です（誤差 ±${Math.round(diffSE)}点）`
  }

  const riichi = riichiAnalysis(chosen, results)
  const { good, improve } =
    decision === 'discard'
      ? comment(chosen.ev, best.ev, results.map((r) => r.ev), safest, loss, diffSE, (k) => furitenWaits(view, k))
      : commentOther(chosen, best, loss, diffSE)
  if (riichi && riichi.recommended === riichi.chosen && riichi.riichiEv !== riichi.damaEv) {
    good.push(
      `立直判断は適切です（${riichi.tile}切りで 立直 ${riichi.riichiEv}点／ダマ ${riichi.damaEv}点）`,
    )
  }

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
      riichi,
    },
    candidates: results.map((r) => r.ev),
    elapsedMs: Math.round(now() - t0),
  }
}

function decisionTypeOf(a: Action): DecisionType | null {
  switch (a.type) {
    case 'discard':
      return 'discard'
    case 'pass':
    case 'pon':
    case 'chi':
    case 'daiminkan':
      return 'call'
    case 'ron':
    case 'tsumo':
      return 'win'
    case 'ankan':
    case 'kakan':
      return 'kan'
    case 'kyuushu':
      return 'kyuushu'
    default:
      return null
  }
}

/** 同じ意味の行動を同じキーにする（打牌は種類・赤・立直有無でまとめる） */
function actionKey(view: PlayerView, a: Action): string {
  switch (a.type) {
    case 'discard': {
      const t = view.hand.find((h) => h.id === a.tileId)!
      return `d:${t.kind}:${t.red ? 'r' : ''}:${a.riichi ? 'R' : ''}`
    }
    case 'pon':
    case 'chi': {
      const tiles = a.tileIds.map((id) => view.hand.find((h) => h.id === id)!)
      return `${a.type}:${tiles.map((t) => `${t.kind}${t.red ? 'r' : ''}`).sort().join(',')}`
    }
    case 'ankan':
      return `ankan:${a.kind}`
    case 'kakan':
      return `kakan:${view.hand.find((h) => h.id === a.tileId)!.kind}`
    default:
      return a.type
  }
}

// ---------------------------------------------------------------------------
// 候補の列挙

function turnCandidates(view: PlayerView, setup: SimSetup): CandSpec[] {
  const me = view.players[view.seat]
  const counts14 = countsOfTiles(view.hand)
  const reds = (exclude: number[]) => view.hand.filter((h) => h.red && !exclude.includes(h.id)).map((h) => h.kind)
  const specs: CandSpec[] = []
  const seenKeys = new Set<string>()

  for (const a of view.legalActions) {
    const key = actionKey(view, a)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    if (a.type === 'discard') {
      const t = view.hand.find((h) => h.id === a.tileId)!
      const counts = counts14.slice()
      counts[t.kind]--
      const riichi = !!a.riichi || me.riichi
      specs.push({
        key,
        group: 'discard',
        action: a,
        riichi: !!a.riichi,
        variants: [
          {
            sim: { kind: t.kind, riichi, counts, redKinds: reds([t.id]) },
            counts,
            meldCount: setup.melds.length,
            kind: t.kind,
            label: `${t.red ? '赤' : ''}${kindName(t.kind)}${a.riichi ? '（立直）' : ''}`,
          },
        ],
      })
    } else if (a.type === 'tsumo' && view.drawn) {
      const v = winPoints(view, [...view.hand], view.drawn, setup.melds, true)
      specs.push({ key, group: 'win', action: a, riichi: false, fixed: { ev: v, label: `ツモ（${v}点）`, winValue: v } })
    } else if (a.type === 'kyuushu') {
      specs.push({ key, group: 'kyuushu', action: a, riichi: false, fixed: { ev: 0, label: '九種九牌（流局）', winValue: 0 } })
    } else if (a.type === 'ankan' || a.type === 'kakan') {
      const kind = a.type === 'ankan' ? a.kind : view.hand.find((h) => h.id === a.tileId)!.kind
      const used = view.hand.filter((h) => h.kind === kind).slice(0, a.type === 'ankan' ? 4 : 1)
      const counts = counts14.slice()
      counts[kind] -= used.length
      const melds: Meld[] =
        a.type === 'ankan'
          ? [...setup.melds, { type: 'ankan', tiles: used }]
          : setup.melds.map((m) =>
              m.type === 'pon' && m.tiles[0].kind === kind ? { ...m, type: 'kakan' as const, tiles: [...m.tiles, used[0]] } : m,
            )
      specs.push({
        key,
        group: 'kan',
        action: a,
        riichi: false,
        variants: [
          {
            sim: {
              kind: null,
              riichi: me.riichi,
              counts,
              redKinds: reds(used.map((u) => u.id)),
              melds,
              drawFirst: true,
            },
            counts,
            meldCount: melds.length,
            kind: null,
            label: `${a.type === 'ankan' ? '暗槓' : '加槓'}（${kindName(kind)}）`,
          },
        ],
      })
    }
  }
  return specs
}

function responseCandidates(view: PlayerView, setup: SimSetup): CandSpec[] {
  const me = view.players[view.seat]
  const tile = view.responseTo!.tile
  const from = view.responseTo!.seat
  const counts13 = countsOfTiles(view.hand)
  const canRon = view.legalActions.some((a) => a.type === 'ron')
  const reds = (exclude: number[]) => view.hand.filter((h) => h.red && !exclude.includes(h.id)).map((h) => h.kind)
  const specs: CandSpec[] = []
  const seenKeys = new Set<string>()

  for (const a of view.legalActions) {
    const key = actionKey(view, a)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    if (a.type === 'pass') {
      specs.push({
        key,
        group: 'pass',
        action: a,
        riichi: false,
        variants: [
          {
            // 見逃した当たり牌は同巡内フリテン（簡略化してこの局の間フリテンとして扱う）
            sim: { kind: null, riichi: me.riichi, counts: counts13, redKinds: reds([]), extraFuriten: canRon ? [tile.kind] : [] },
            counts: counts13,
            meldCount: setup.melds.length,
            kind: null,
            label: 'スキップ',
          },
        ],
      })
    } else if (a.type === 'ron') {
      const v = winPoints(view, [...view.hand, tile], tile, setup.melds, false)
      specs.push({ key, group: 'win', action: a, riichi: false, fixed: { ev: v, label: `ロン（${v}点）`, winValue: v } })
    } else if (a.type === 'pon' || a.type === 'chi' || a.type === 'daiminkan') {
      const own =
        a.type === 'daiminkan'
          ? view.hand.filter((h) => h.kind === tile.kind)
          : a.tileIds.map((id) => view.hand.find((h) => h.id === id)!)
      const ownIds = own.map((t) => t.id)
      const rest = view.hand.filter((h) => !ownIds.includes(h.id))
      const restCounts = countsOfTiles(rest)
      const meld: CalledMeld = {
        type: a.type === 'daiminkan' ? 'minkan' : a.type,
        tiles: [...own, tile],
        from,
        calledTile: tile,
      }
      const melds: Meld[] = [...setup.melds, meld]
      const name = `${a.type === 'pon' ? 'ポン' : a.type === 'chi' ? 'チー' : 'カン'}（${own.map(tileName).join('')}＋${tileName(tile)}）`
      const redKinds = reds(ownIds) // 鳴いた牌の赤は副露側で数える
      if (a.type === 'daiminkan') {
        specs.push({
          key,
          group: 'call',
          action: a,
          riichi: false,
          variants: [
            {
              sim: { kind: null, riichi: false, counts: restCounts, redKinds, melds, menzen: false, drawFirst: true },
              counts: restCounts,
              meldCount: melds.length,
              kind: null,
              label: name,
            },
          ],
        })
        continue
      }
      // 鳴いた後の打牌（喰い替えは不可）。向聴数・受け入れの上位だけシミュレーションする
      const forbidden = a.type === 'pon' ? [tile.kind] : chiForbidden(tile.kind, own)
      const options: { k: TileKind; sh: number; uk: number; counts: number[] }[] = []
      for (let k = 0; k < KIND_COUNT; k++) {
        if (restCounts[k] === 0 || forbidden.includes(k)) continue
        const c = restCounts.slice()
        c[k]--
        const sh = calculateShanten(c, melds.length).shanten
        options.push({ k, sh, uk: calcUkeire(c, melds.length).total, counts: c })
      }
      options.sort((x, y) => x.sh - y.sh || y.uk - x.uk)
      specs.push({
        key,
        group: 'call',
        action: a,
        riichi: false,
        variants: options.slice(0, CALL_DISCARD_VARIANTS).map((o) => ({
          sim: { kind: o.k, riichi: false, counts: o.counts, redKinds, melds, menzen: false },
          counts: o.counts,
          meldCount: melds.length,
          kind: o.k,
          label: `${name} → ${kindName(o.k)}切り`,
        })),
      })
    }
  }
  return specs
}

const tileName = (t: PhysicalTile) => (t.red ? '赤' : '') + kindName(t.kind)

/** 和了点（放銃者の支払い／ツモの合計）＋供託 */
function winPoints(view: PlayerView, hand: PhysicalTile[], winTile: PhysicalTile, melds: Meld[], tsumo: boolean): number {
  const me = view.players[view.seat]
  const v = calculateHandValue({
    hand,
    winTile,
    melds,
    isTsumo: tsumo,
    riichi: me.riichi ? 'riichi' : 'none',
    isHaitei: tsumo && view.wallRemaining === 0,
    isHoutei: !tsumo && view.wallRemaining === 0 && view.responseTo?.kind === 'discard',
    isChankan: !tsumo && view.responseTo?.kind !== 'discard',
    seatWind: 27 + ((view.seat - view.round.dealer + 4) % 4),
    roundWind: view.round.wind,
    doraIndicators: view.doraIndicators,
    honba: view.round.honba,
  })
  if (!v.ok) return 0
  const p = v.payment
  return (tsumo ? p.total : p.main + p.mainBonus) + view.round.kyoutaku * 1000
}

// ---------------------------------------------------------------------------
// 候補の評価

function runSpec(spec: CandSpec, setup: SimSetup, seen: number[], n: number, seed: number): Result {
  if (spec.fixed) {
    const outcomes = new Float64Array(n).fill(spec.fixed.ev)
    return {
      key: spec.key,
      group: spec.group,
      outcomes,
      mean: spec.fixed.ev,
      spec,
      variant: null,
      ev: {
        action: spec.action,
        kind: null,
        riichi: false,
        label: spec.fixed.label,
        shanten: spec.group === 'win' ? -1 : 0,
        ukeire: 0,
        effectiveKinds: [],
        winRate: spec.group === 'win' ? 1 : 0,
        winValue: spec.fixed.winValue,
        immediateDealIn: 0,
        dealInRate: 0,
        ev: Math.round(spec.fixed.ev),
        evStdError: 0,
      },
    }
  }
  // 複数の変種（鳴いた後の打牌など）は、期待値が最も高いものをこの候補の値とする
  let bestVariant: { v: Variant; sim: ReturnType<typeof simulateCandidate> } | null = null
  for (const v of spec.variants!) {
    const sim = simulateCandidate(setup, v.sim, n, seed)
    if (!bestVariant || sim.mean > bestVariant.sim.mean) bestVariant = { v, sim }
  }
  const { v, sim } = bestVariant!
  const visible = seen.slice()
  for (let k = 0; k < KIND_COUNT; k++) visible[k] -= v.counts[k] + (v.kind === k ? 1 : 0)
  const u = calcUkeire(v.counts, v.meldCount, visible.map((x) => Math.max(0, x)))
  return {
    key: spec.key,
    group: spec.group,
    outcomes: sim.outcomes,
    mean: sim.mean,
    spec,
    variant: v,
    ev: {
      action: spec.action,
      kind: v.kind,
      riichi: spec.riichi,
      label: v.label,
      shanten: u.shanten,
      ukeire: u.total,
      effectiveKinds: u.tiles.map((t) => t.kind),
      winRate: sim.winRate,
      winValue: Math.round(sim.winValue),
      immediateDealIn: v.kind === null ? 0 : setup.dealInProb[v.kind],
      dealInRate: sim.dealInRate,
      ev: Math.round(sim.mean),
      evStdError: Math.round(sim.stdError),
    },
  }
}

/** 候補に extra 回の試行を足し、期待値・和了率などを合算し直す（r を書き換える） */
function refineResult(r: Result, setup: SimSetup, extra: number, seed: number): void {
  const n = r.outcomes.length
  const merged = new Float64Array(n + extra)
  merged.set(r.outcomes)
  if (!r.variant) {
    merged.fill(r.mean, n)
    r.outcomes = merged
    return
  }
  const sim = simulateCandidate(setup, r.variant.sim, extra, seed)
  merged.set(sim.outcomes, n)
  const total = n + extra
  const mean = (r.mean * n + sim.mean * extra) / total
  let v = 0
  for (const o of merged) v += (o - mean) ** 2
  const wins = r.ev.winRate * n + sim.winRate * extra
  const winValue = wins > 0 ? (r.ev.winValue * r.ev.winRate * n + sim.winValue * sim.winRate * extra) / wins : 0
  r.outcomes = merged
  r.mean = mean
  r.ev = {
    ...r.ev,
    winRate: wins / total,
    winValue: Math.round(winValue),
    dealInRate: (r.ev.dealInRate * n + sim.dealInRate * extra) / total,
    ev: Math.round(mean),
    evStdError: Math.round(Math.sqrt(v / (total - 1) / total)),
  }
}

// ---------------------------------------------------------------------------
// 準備

const ALL_KINDS: TileKind[] = Array.from({ length: KIND_COUNT }, (_, k) => k)

/**
 * 打牌して聴牌に取ったとき、自分の河（と今切る牌）にある待ち。空ならフリテンではない
 * （同巡内フリテンは次の自分の打牌で解けるので、打牌の評価では見ない）
 */
export function furitenWaits(view: PlayerView, kind: TileKind): TileKind[] {
  const me = view.players[view.seat]
  const counts = countsOfTiles(view.hand)
  if (counts[kind] === 0) return []
  counts[kind]--
  const waits = waitingKinds(counts, me.melds.length)
  const river = new Set(me.river.map((r) => r.tile.kind))
  river.add(kind)
  return waits.filter((w) => river.has(w))
}

export function buildSetup(view: PlayerView): SimSetup {
  const me = view.players[view.seat]
  const seen = seenCounts(view)
  const pool: TileKind[] = []
  for (let k = 0; k < KIND_COUNT; k++) for (let j = seen[k]; j < 4; j++) pool.push(k)

  const threats = findThreats(view)
  const riichiThreats = threats.filter((t) => t.riichi).length
  const openThreats = threats.length - riichiThreats
  const dealInProb = new Float64Array(KIND_COUNT)
  const dealInLoss = new Float64Array(KIND_COUNT)
  const riichiDealInProb = new Float64Array(KIND_COUNT)
  for (const t of threats) {
    const loss = dealInLossFor(t.type, t.seat === view.round.dealer)
    for (let k = 0; k < KIND_COUNT; k++) {
      const p = tileDanger(k, t, seen, 3) / 100
      dealInLoss[k] = dealInProb[k] + p > 0 ? (dealInLoss[k] * dealInProb[k] + loss * p) / (dealInProb[k] + p) : 0
      dealInProb[k] += p
      if (t.riichi) riichiDealInProb[k] += p
    }
  }
  for (let k = 0; k < KIND_COUNT; k++) {
    dealInProb[k] = Math.min(dealInProb[k], 0.5)
    riichiDealInProb[k] = Math.min(riichiDealInProb[k], dealInProb[k])
  }

  return {
    view,
    melds: me.melds,
    menzen: me.melds.every((m) => m.type === 'ankan'),
    pool,
    ownTurns: Math.floor(view.wallRemaining / 4),
    dealInProb,
    dealInLoss,
    // 他家の打牌1回あたりに、自分以外の和了で局が終わる確率（山の残り枚数ごとの実測値）
    otherEndHazard: hazardSeq(view.wallRemaining, riichiThreats, openThreats, false),
    otherEndHazardSelfRiichi: hazardSeq(view.wallRemaining, riichiThreats, openThreats, true),
    hasThreat: threats.length > 0,
    riichiDealInProb,
    riichiVisible: riichiThreats > 0,
    riichiCount: riichiThreats,
    riichiAppear: riichiAppearSeq(view.wallRemaining),
    futureDealIn: futureDealInSeq(view.wallRemaining, threats.length > 0),
    futureDealInLoss: futureDealIn(view.wallRemaining, threats.length > 0).loss,
    // 立直後に当たり牌を見逃したフリテン（その局ずっとロンできない）は、全ての牌を河にあるものとして扱う
    riverKinds: me.riichi && view.isFuriten ? ALL_KINDS : me.river.map((r) => r.tile.kind),
    kyoutaku: view.round.kyoutaku,
    honba: view.round.honba,
  }
}

function futureDealInSeq(wall: number, threatsVisible: boolean): Float64Array {
  const turns = Math.floor(wall / 4) + 1
  const seq = new Float64Array(turns)
  // t 回目のツモ後の打牌は、山が 4(t+1) 枚ほど減った時点
  for (let t = 0; t < turns; t++) seq[t] = futureDealIn(Math.max(0, wall - 4 * (t + 1)), threatsVisible).rate
  return seq
}

function riichiAppearSeq(wall: number): Float64Array {
  const turns = Math.floor(wall / 4)
  const seq = new Float64Array(turns)
  for (let t = 0; t < turns; t++) seq[t] = riichiAppearRate(Math.max(0, wall - 4 * t))
  return seq
}

function hazardSeq(wall: number, riichiThreats: number, openThreats: number, selfRiichi: boolean): Float64Array {
  const turns = Math.floor(wall / 4) + 1
  const seq = new Float64Array(turns)
  for (let t = 0; t < turns; t++) seq[t] = otherEndHazard(Math.max(0, wall - 4 * t), riichiThreats, openThreats, selfRiichi)
  return seq
}

// ---------------------------------------------------------------------------
// 立直判断

function riichiAnalysis(chosen: Result, results: Result[]): Evaluation['analysis']['riichi'] {
  if (chosen.group !== 'discard' || chosen.ev.kind === null) return null
  const sameTile = results.filter((r) => r.group === 'discard' && r.ev.kind === chosen.ev.kind)
  const r = sameTile.find((x) => x.ev.riichi)
  const d = sameTile.find((x) => !x.ev.riichi)
  if (!r || !d) return null
  const diffSE = pairedStdError(r.outcomes, d.outcomes)
  const recommended = r.mean - d.mean > diffSE ? 'riichi' : d.mean - r.mean > diffSE ? 'dama' : r.mean >= d.mean ? 'riichi' : 'dama'
  return {
    tile: kindName(chosen.ev.kind),
    riichiEv: Math.round(r.mean),
    damaEv: Math.round(d.mean),
    recommended,
    chosen: chosen.ev.riichi ? 'riichi' : 'dama',
  }
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
  furitenOf: (kind: TileKind) => TileKind[],
): { good: string[]; improve: string[] } {
  const good: string[] = []
  const improve: string[] = []
  const nearBest = chosen === best || loss <= diffSE
  // フリテンの聴牌（待ちが自分の河にあり、ロンできない）
  const furiten = chosen.shanten === 0 && chosen.kind !== null ? furitenOf(chosen.kind) : []
  const bestFuriten = best.shanten === 0 && best.kind !== null && furitenOf(best.kind).length > 0
  if (furiten.length > 0 && !bestFuriten && chosen.kind !== best.kind) {
    improve.push(
      `フリテンの聴牌です（待ちの${furiten.map(kindName).join('・')}が自分の河にあるためロンできず、ツモ和了だけになります）`,
    )
  }
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

/** 鳴き・和了・カン・九種九牌の解説 */
function commentOther(chosen: Result, best: Result, loss: number, diffSE: number): { good: string[]; improve: string[] } {
  const good: string[] = []
  const improve: string[] = []
  const c = chosen.ev
  const b = best.ev
  const nearBest = chosen === best || loss <= diffSE
  if (chosen === best) good.push('最善の判断を選べています')
  else if (nearBest) good.push(`最善（${b.label}）との差は誤差の範囲です`)
  if (nearBest) {
    if (chosen.group === 'win') good.push('和了を逃さず取れています')
    return { good, improve }
  }

  const lossText = `期待値が${Math.round(loss)}点高い`
  if (best.group === 'win') {
    improve.push(`${b.label}できる局面でした。見逃すより${lossText}選択です`)
  } else if (best.group === 'pass' && chosen.group === 'call') {
    improve.push(`鳴かない方が${lossText}局面です（鳴いた場合 和了率${pct(c.winRate)}・平均${c.winValue}点／鳴かない場合 ${pct(b.winRate)}・${b.winValue}点）`)
  } else if (best.group === 'call' && chosen.group === 'pass') {
    improve.push(`${b.label}の方が${lossText}局面です（向聴数 ${c.shanten}→${b.shanten}、和了率 ${pct(c.winRate)}→${pct(b.winRate)}）`)
  } else if (best.group === 'call' && chosen.group === 'call') {
    improve.push(`同じ鳴くなら${b.label}の方が${lossText}選択です`)
  } else if (chosen.group === 'kan') {
    improve.push(`カンせずに${b.label}とする方が${lossText}局面です`)
  } else if (best.group === 'kan') {
    improve.push(`${b.label}をする方が${lossText}局面です`)
  } else if (chosen.group === 'kyuushu') {
    improve.push(`流局させずに続ける（${b.label}）方が${lossText}局面です`)
  } else if (best.group === 'kyuushu') {
    improve.push(`九種九牌で流局させる方が${lossText}局面です`)
  } else {
    improve.push(`${b.label}の方が${lossText}選択でした`)
  }
  return { good, improve }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

// ---------------------------------------------------------------------------

/** 対になった試行の差の標準誤差。試行回数が違う（片方だけ試行を足した）ときは、共通の分だけで比べる */
function pairedStdError(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length)
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
