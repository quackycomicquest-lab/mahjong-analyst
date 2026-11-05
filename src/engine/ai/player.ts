/**
 * AIプレイヤー（仕様 §4-1 ② Mahjong Player AI）
 *
 * 入力はプレイヤー視点（PlayerView）だけ。他家の手牌や山は見ない。
 * 判断は「打牌候補ごとの点数」で行い、性格は点数の重みとして効かせる。
 *
 *   打牌の点数 = 牌効率（シャンテン数・受け入れ） − 打点の損失 − 危険度 × 押し引きの重み
 */

import type { Action, ResponseAction, TurnAction } from '../game/types'
import type { PlayerView } from '../game/view'
import { ukeire } from '../rules/efficiency'
import { calculateShanten } from '../rules/shanten'
import {
  countsOfTiles,
  isHonor,
  isTerminalOrHonor,
  YAOCHU_KINDS,
  type PhysicalTile,
  type TileKind,
} from '../rules/tile'
import type { Meld } from '../rules/types'
import { findThreats, seenCounts, totalDanger, type Threat } from './danger'
import type { AiProfile } from './profile'
import { doraKinds, roughValue, tenpaiValue, yakuhaiKinds } from './value'

export interface Decision {
  action: Action
  /** 判断理由（デバッグ・解説用） */
  reason: string
}

interface Ctx {
  view: PlayerView
  profile: AiProfile
  rand: () => number
  seen: number[]
  threats: Threat[]
  melds: Meld[]
}

export function decide(view: PlayerView, profile: AiProfile, rand: () => number): Decision {
  const acts = view.legalActions
  if (acts.length === 0) throw new Error('行動できる局面ではありません')
  if (acts[0].type === 'nextRound') return { action: acts[0], reason: '次局へ' }

  const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron')
  if (win) return { action: win, reason: '和了' }

  const ctx: Ctx = {
    view,
    profile,
    rand,
    seen: seenCounts(view),
    threats: findThreats(view),
    melds: view.players[view.seat].melds,
  }
  if (acts.some((a) => a.type === 'pass')) return decideResponse(ctx, acts as ResponseAction[])
  return decideTurn(ctx, acts as TurnAction[])
}

// ===========================================================================
// 手番

function decideTurn(ctx: Ctx, acts: TurnAction[]): Decision {
  const { view, profile } = ctx

  const kyuushu = acts.find((a) => a.type === 'kyuushu')
  if (kyuushu) {
    const kinds = new Set(view.hand.map((t) => t.kind).filter((k) => YAOCHU_KINDS.includes(k))).size
    const goKokushi = kinds >= 11 || (kinds >= 10 && profile.personality.valueFocus >= 0.7)
    if (!goKokushi) return { action: kyuushu, reason: `九種九牌（么九牌${kinds}種）` }
  }

  const discards = acts.filter((a) => a.type === 'discard') as Extract<TurnAction, { type: 'discard' }>[]
  // 立直中はツモ切りのみ（暗槓できるなら暗槓）
  if (view.players[view.seat].riichi) {
    const ankan = acts.find((a) => a.type === 'ankan')
    if (ankan) return { action: ankan, reason: '立直中の暗槓' }
    return { action: discards[0], reason: 'ツモ切り' }
  }

  const kan = chooseKan(ctx, acts)
  if (kan) return kan

  const scored = scoreDiscards(ctx, discards)
  const best = pick(scored, temperature(profile), ctx.rand)

  // 立直判断
  const riichiActs = discards.filter((a) => a.riichi)
  if (riichiActs.length > 0) {
    const r = decideRiichi(ctx, riichiActs, scored)
    if (r) return r
  }
  return { action: best.action, reason: best.reason }
}

interface ScoredDiscard {
  action: Extract<TurnAction, { type: 'discard' }>
  tile: PhysicalTile
  shanten: number
  ukeire: number
  danger: number
  score: number
  reason: string
}

function scoreDiscards(ctx: Ctx, discards: Extract<TurnAction, { type: 'discard' }>[]): ScoredDiscard[] {
  const { view, profile, seen, threats, melds } = ctx
  const level = profile.strength
  const counts = countsOfTiles(view.hand)
  const doras = new Set(doraKinds(view))
  const yakuhai = yakuhaiKinds(view)
  const vf = profile.personality.valueFocus

  // 同じ種類の牌は1つにまとめる（赤5は残す方を優先）
  const byKind = new Map<TileKind, Extract<TurnAction, { type: 'discard' }>>()
  for (const a of discards) {
    if (a.riichi) continue
    const t = view.hand.find((h) => h.id === a.tileId)!
    const prev = byKind.get(t.kind)
    const prevTile = prev && view.hand.find((h) => h.id === prev.tileId)!
    if (!prev || (prevTile!.red && !t.red)) byKind.set(t.kind, a)
  }

  // 染め手の見込み（打点型）
  const suitCounts = [0, 0, 0]
  let honors = 0
  for (const t of [...view.hand, ...melds.flatMap((m) => m.tiles)]) {
    if (isHonor(t.kind)) honors++
    else suitCounts[Math.floor(t.kind / 9)]++
  }
  const mainSuit = suitCounts.indexOf(Math.max(...suitCounts))
  const flushAim = vf >= 0.7 && suitCounts[mainSuit] + honors >= 10

  const visible = level >= 2 ? seen.map((n, k) => n - counts[k]) : undefined
  const raw = [...byKind.entries()].map(([kind, action]) => {
    const tile = view.hand.find((h) => h.id === action.tileId)!
    const c = counts.slice()
    c[kind]--
    const sh = calculateShanten(c, melds.length).shanten
    const u = level >= 2 ? ukeire(c, melds.length, visible).total : 0

    // 打点の損失
    let loss = 0
    const doraHits = [...doras].filter((d) => d === kind).length
    loss += (doraHits + (tile.red ? 1 : 0)) * 12 * (0.5 + vf)
    if (yakuhai.has(kind) && counts[kind] >= 2) loss += 10 * (0.5 + vf)
    if (flushAim) loss += !isHonor(kind) && Math.floor(kind / 9) !== mainSuit ? -15 : 6
    // 序盤は孤立した字牌・端牌から切る（同点の並べ替え）
    if (isTerminalOrHonor(kind) && counts[kind] === 1) loss -= yakuhai.has(kind) ? 0.5 : 1.5

    return { action, tile, shanten: sh, ukeire: u, loss, danger: totalDanger(kind, threats, seen, level) }
  })

  const minShanten = Math.min(...raw.map((r) => r.shanten))
  const pushWeight = foldWeight(ctx, minShanten)
  return raw.map((r) => {
    const efficiency = -100 * r.shanten + r.ukeire
    const score = efficiency - r.loss - pushWeight * r.danger
    let reason = `${r.shanten}向聴・受入${r.ukeire}枚`
    if (pushWeight * r.danger > 30) reason += `・危険度${r.danger.toFixed(1)}`
    return { action: r.action, tile: r.tile, shanten: r.shanten, ukeire: r.ukeire, danger: r.danger, score, reason }
  })
}

/** 危険度に掛ける重み。遠い手・安い手・守備的な性格ほど大きい（＝降りやすい） */
function foldWeight(ctx: Ctx, shanten: number): number {
  const { threats, profile, view, melds } = ctx
  if (threats.length === 0) return 0
  const base = [1.5, 10, 22, 30][Math.min(Math.max(shanten, 0), 3)]
  const value = roughValue(view.hand, melds, view)
  const valueAdj = 1 + value / 8000
  const strengthAdj = profile.strength === 1 ? 0.3 : 1
  return (base * (1.3 - profile.personality.aggression) * strengthAdj) / valueAdj
}

function decideRiichi(
  ctx: Ctx,
  riichiActs: Extract<TurnAction, { type: 'discard' }>[],
  scored: ScoredDiscard[],
): Decision | null {
  const { view, profile, seen, melds } = ctx
  // 立直できる打牌の中で、待ちの枚数×打点が最も良いもの
  let best: { action: Extract<TurnAction, { type: 'discard' }>; waits: number; dama: number; riichiValue: number; hasYaku: boolean } | null =
    null
  for (const a of riichiActs) {
    const rest = view.hand.filter((t) => t.id !== a.tileId)
    const tv = tenpaiValue(rest, melds, view, seen, false)
    const rv = profile.strength >= 3 ? tenpaiValue(rest, melds, view, seen, true).ronAverage : 0
    const waits = tv.waits.reduce((n, w) => n + w.remaining, 0)
    const key = waits * (profile.strength >= 3 ? Math.max(rv, 1000) : 1)
    const bestKey = best ? best.waits * (profile.strength >= 3 ? Math.max(best.riichiValue, 1000) : 1) : -1
    if (key > bestKey) best = { action: a, waits, dama: tv.ronAverage, riichiValue: rv, hasYaku: tv.hasYaku }
  }
  if (!best) return null

  // 聴牌を崩してまで降りるべき状況なら立直しない
  const bestScored = scored.reduce((a, b) => (a.score >= b.score ? a : b))
  if (bestScored.shanten > 0) return null

  const p = profile.personality
  const wallLeft = view.wallRemaining
  if (!best.hasYaku) {
    return { action: best.action, reason: `立直（役なし聴牌・待ち${best.waits}枚）` }
  }
  if (best.waits === 0) return null
  // 役あり聴牌：打点が十分ならダマ、そうでなければ性格に応じて立直
  const enough = best.dama >= 7700 || (best.dama >= 5200 && p.riichiTendency < 0.8)
  if (enough) return null
  if (wallLeft < 8 && p.riichiTendency < 0.8) return null
  if (profile.strength >= 3 && best.waits <= 2 && best.dama >= 3900) return null
  // 守備的な性格は、役があって待ちが少ないなら降りられるダマを選ぶ
  if (p.aggression < 0.3 && best.waits < 4) return null
  if (p.riichiTendency >= 0.5) {
    return { action: best.action, reason: `立直（ダマ${best.dama}点・待ち${best.waits}枚）` }
  }
  return null
}

// ===========================================================================
// 槓

function chooseKan(ctx: Ctx, acts: TurnAction[]): Decision | null {
  const { view, profile, threats, melds } = ctx
  const counts = countsOfTiles(view.hand)
  const current = bestShantenAfterDiscard(counts, melds.length)
  for (const a of acts) {
    if (a.type !== 'ankan' && a.type !== 'kakan') continue
    const c = counts.slice()
    let meldCount = melds.length
    if (a.type === 'ankan') {
      c[a.kind] -= 4
      meldCount++
    } else {
      const t = view.hand.find((h) => h.id === a.tileId)!
      c[t.kind]--
    }
    // 槓の後は嶺上牌を引くので、3n+1枚のシャンテン数で比べる
    const after = calculateShanten(c, meldCount).shanten
    if (after > current) continue
    if (a.type === 'kakan' && threats.length > 0 && profile.personality.aggression < 0.5) continue
    return { action: a, reason: a.type === 'ankan' ? '暗槓（手を崩さない）' : '加槓' }
  }
  return null
}

function bestShantenAfterDiscard(counts: number[], meldCount: number): number {
  let best = Infinity
  const c = counts.slice()
  for (let k = 0; k < c.length; k++) {
    if (c[k] === 0) continue
    c[k]--
    best = Math.min(best, calculateShanten(c, meldCount).shanten)
    c[k]++
  }
  return best
}

// ===========================================================================
// 応答（鳴き）

function decideResponse(ctx: Ctx, acts: ResponseAction[]): Decision {
  const pass = acts.find((a) => a.type === 'pass')!
  const tile = ctx.view.lastDiscard?.tile
  if (!tile) return { action: pass, reason: '見送り' }

  let best: { action: ResponseAction; shanten: number; reason: string } | null = null
  for (const a of acts) {
    if (a.type !== 'pon' && a.type !== 'chi' && a.type !== 'daiminkan') continue
    const judged = judgeCall(ctx, a, tile)
    if (judged && (!best || judged.shanten < best.shanten)) best = { action: a, ...judged }
  }
  return best ? { action: best.action, reason: best.reason } : { action: pass, reason: '鳴かない' }
}

function judgeCall(
  ctx: Ctx,
  a: Extract<ResponseAction, { type: 'pon' | 'chi' | 'daiminkan' }>,
  tile: PhysicalTile,
): { shanten: number; reason: string } | null {
  const { view, profile, threats, melds } = ctx
  const p = profile.personality
  const counts = countsOfTiles(view.hand)
  const now = calculateShanten(counts, melds.length).shanten

  const used =
    a.type === 'daiminkan'
      ? view.hand.filter((t) => t.kind === tile.kind)
      : view.hand.filter((t) => (a as { tileIds: number[] }).tileIds.includes(t.id))
  const rest = view.hand.filter((t) => !used.includes(t))
  const restCounts = countsOfTiles(rest)
  const meldCount = melds.length + 1
  const after =
    a.type === 'daiminkan'
      ? calculateShanten(restCounts, meldCount).shanten
      : bestShantenAfterDiscard(restCounts, meldCount)

  if (a.type === 'daiminkan') {
    if (threats.length > 0 || after > now || p.callTendency < 0.6) return null
    return { shanten: after, reason: '大明槓' }
  }

  const yakuhai = yakuhaiKinds(view)
  const isYakuhaiPon = a.type === 'pon' && yakuhai.has(tile.kind)
  // 基本は向聴数が進む鳴きだけ。役牌の対子ポンは向聴数が変わらなくても役が確定するので鳴く
  if (after > now || (after === now && !(isYakuhaiPon && p.callTendency >= 0.4))) return null
  // 他家の立直があるときは、聴牌（攻撃的なら一向聴）になる鳴きだけ
  if (threats.length > 0 && after > (p.aggression >= 0.6 ? 1 : 0)) return null
  const meldTiles: PhysicalTile[] = [...used, tile]
  const yaku = profile.strength >= 2 ? openYakuPlan(ctx, rest, meldTiles, a.type) : 'あり（判断しない）'
  if (!yaku) return null

  // 性格による鳴きの許容範囲
  const limit = p.callTendency >= 0.7 ? 3 : p.callTendency >= 0.4 ? 2 : 1
  const valueOk = p.valueFocus < 0.7 || yaku !== '断幺九' || after <= 1
  if (!valueOk) return null
  if (after > limit && !(isYakuhaiPon && after <= limit + 1)) return null
  return { shanten: after, reason: `${a.type === 'pon' ? 'ポン' : 'チー'}（${yaku}・${after}向聴へ）` }
}

/**
 * 鳴いた後に役を作れる見込み。作れるなら役名、無ければ null。
 */
function openYakuPlan(ctx: Ctx, rest: PhysicalTile[], meldTiles: PhysicalTile[], type: 'pon' | 'chi'): string | null {
  const { view, melds } = ctx
  const yakuhai = yakuhaiKinds(view)
  const allMelds = [...melds.map((m) => m.tiles), meldTiles]
  // 役牌の刻子（鳴いた牌・既存の副露・手の中の暗刻）
  if (allMelds.some((m) => m.length >= 3 && m[0].kind === m[1].kind && yakuhai.has(m[0].kind))) return '役牌'
  const restCounts = countsOfTiles(rest)
  if ([...yakuhai].some((k) => restCounts[k] >= 3)) return '役牌'
  if ([...yakuhai].some((k) => restCounts[k] === 2) && ctx.profile.personality.callTendency >= 0.6) {
    return '役牌（対子）'
  }
  const all = [...rest, ...allMelds.flat()]
  // 断幺九：么九牌が手に1枚以下（切れば済む）で、副露に么九牌が無い
  const meldYaochu = allMelds.flat().some((t) => isTerminalOrHonor(t.kind))
  if (!meldYaochu && rest.filter((t) => isTerminalOrHonor(t.kind)).length <= 1) return '断幺九'
  // 染め手：数牌が1色＋字牌で、他の色が2枚以下
  const suits = [0, 0, 0]
  for (const t of all) if (!isHonor(t.kind)) suits[Math.floor(t.kind / 9)]++
  const main = suits.indexOf(Math.max(...suits))
  const off = suits.reduce((n, s, i) => (i === main ? n : n + s), 0)
  const meldsInMain = allMelds.every((m) => isHonor(m[0].kind) || Math.floor(m[0].kind / 9) === main)
  if (meldsInMain && off <= 2) return '混一色'
  // 対々和：ポンのみで、手の中に対子・暗刻が多い
  if (type === 'pon' && allMelds.every((m) => m[0].kind === m[1].kind)) {
    const pairs = restCounts.filter((n) => n >= 2).length
    if (pairs >= 4 - allMelds.length + 1) return '対々和'
  }
  return null
}

// ===========================================================================
// 選択のばらつき

function temperature(profile: AiProfile): number {
  return profile.strength === 1 ? 25 : profile.strength === 2 ? 1.5 : 0
}

function pick<T extends { score: number }>(items: T[], temp: number, rand: () => number): T {
  const max = Math.max(...items.map((i) => i.score))
  if (temp <= 0) return items.find((i) => i.score === max)!
  const weights = items.map((i) => Math.exp((i.score - max) / temp))
  const sum = weights.reduce((a, b) => a + b, 0)
  let x = rand() * sum
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]
    if (x <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** 対局エンジンのボット形式（PlayerView → Action）にする */
export function createAiBot(profile: AiProfile, rand: () => number): (view: PlayerView) => Action {
  return (view) => decide(view, profile, rand).action
}
