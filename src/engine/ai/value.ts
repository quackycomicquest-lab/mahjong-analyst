/**
 * 打点の推定（押し引き・立直判断用）
 */

import type { PlayerView } from '../game/view'
import { waitingKinds } from '../rules/agari'
import { calculateHandValue, doraFromIndicator } from '../rules/score'
import { countsOfTiles, isTerminalOrHonor, type PhysicalTile, type TileKind } from '../rules/tile'
import type { Meld } from '../rules/types'

export function seatWindOf(view: PlayerView): TileKind {
  return 27 + ((view.seat - view.round.dealer + 4) % 4)
}

export function yakuhaiKinds(view: PlayerView): Set<TileKind> {
  return new Set([31, 32, 33, seatWindOf(view), view.round.wind])
}

export function doraKinds(view: PlayerView): TileKind[] {
  return view.doraIndicators.map(doraFromIndicator)
}

/** 手牌＋副露のドラ・赤ドラの枚数 */
export function doraCount(tiles: PhysicalTile[], view: PlayerView): number {
  const doras = doraKinds(view)
  let n = 0
  for (const t of tiles) {
    if (t.red) n++
    for (const d of doras) if (t.kind === d) n++
  }
  return n
}

export interface TenpaiValue {
  /** 待ちの種類と残り枚数 */
  waits: { kind: TileKind; remaining: number }[]
  /** ロン和了時の平均点（残り枚数で加重。役なしの待ちは0点） */
  ronAverage: number
  /** 役があるか（ダマでロンできる待ちがあるか） */
  hasYaku: boolean
}

/**
 * 聴牌形（3n+1枚）の打点。riichi=true なら立直した場合の点数（裏ドラなし）。
 */
export function tenpaiValue(
  hand: PhysicalTile[],
  melds: Meld[],
  view: PlayerView,
  seen: readonly number[],
  riichi: boolean,
): TenpaiValue {
  const counts = countsOfTiles(hand)
  const kinds = waitingKinds(counts, melds.length)
  const waits: TenpaiValue['waits'] = []
  let total = 0
  let weight = 0
  let hasYaku = false
  for (const kind of kinds) {
    const remaining = Math.max(0, 4 - seen[kind])
    waits.push({ kind, remaining })
    const winTile: PhysicalTile = { id: -1, kind, red: false }
    const v = calculateHandValue({
      hand: [...hand, winTile],
      winTile,
      melds,
      isTsumo: false,
      riichi: riichi ? 'riichi' : 'none',
      seatWind: seatWindOf(view),
      roundWind: view.round.wind,
      doraIndicators: view.doraIndicators,
    })
    const points = v.ok ? v.payment.main : 0
    if (v.ok) hasYaku = true
    total += points * Math.max(remaining, 0.5)
    weight += Math.max(remaining, 0.5)
  }
  return { waits, ronAverage: weight > 0 ? total / weight : 0, hasYaku }
}

/**
 * 聴牌前の手のおおよその打点（点）。ドラ・役牌・門前（立直）・断幺九の見込みから概算する。
 */
export function roughValue(hand: PhysicalTile[], melds: Meld[], view: PlayerView): number {
  const all = [...hand, ...melds.flatMap((m) => m.tiles)]
  let han = doraCount(all, view)
  const counts = countsOfTiles(all)
  for (const k of yakuhaiKinds(view)) {
    if (counts[k] >= 3) han += 1
    else if (counts[k] === 2) han += 0.5
  }
  const menzen = melds.every((m) => m.type === 'ankan')
  if (menzen) han += 1
  if (all.filter((t) => isTerminalOrHonor(t.kind)).length <= 1) han += 0.7
  return hanToPoints(Math.max(1, han))
}

export function hanToPoints(han: number): number {
  if (han >= 6) return 12000
  if (han >= 5) return 8000
  if (han >= 4) return 7700
  if (han >= 3) return 3900
  if (han >= 2) return 2000
  return 1000
}
