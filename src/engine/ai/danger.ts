/**
 * 放銃危険度の推定（AIプレイヤーの守備判断用。Evaluator の E3 でも使う想定）
 *
 * プレイヤー視点（PlayerView）だけを使う。値は「その牌で放銃するおおよその確率（%）」の目安で、
 * 実戦統計の傾向（現物 < スジ < 無スジ、端 < 中張）を単純化したもの。厳密な確率ではない。
 */

import type { Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import { isHonor, KIND_COUNT, type TileKind } from '../rules/tile'

export interface Threat {
  seat: Seat
  /** 危険度に掛ける重み（立直 1.0、3副露 0.5、2副露 0.25） */
  weight: number
  riichi: boolean
  /** この相手に対して通る牌（現物、立直後に他家が切って通った牌） */
  safeKinds: Set<TileKind>
}

/** 守備の知識レベル（強さに対応） */
export type DefenseLevel = 1 | 2 | 3

/** 自分から見えている牌の枚数（自分の手牌を含む） */
export function seenCounts(view: PlayerView): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0)
  for (const t of view.hand) c[t.kind]++
  for (const p of view.players) {
    for (const rt of p.river) if (rt.calledBy === null) c[rt.tile.kind]++
    for (const m of p.melds) for (const t of m.tiles) c[t.kind]++
  }
  for (const k of view.doraIndicators) c[k]++
  return c
}

export function findThreats(view: PlayerView): Threat[] {
  const threats: Threat[] = []
  for (const p of view.players) {
    if (p.seat === view.seat) continue
    const openMelds = p.melds.filter((m) => m.type !== 'ankan').length
    if (!p.riichi && openMelds < 2) continue
    const safe = new Set<TileKind>(p.river.map((rt) => rt.tile.kind))
    if (p.riichi) {
      const decl = p.river.find((rt) => rt.riichi)
      const after = decl?.seq ?? Infinity
      for (const q of view.players) {
        for (const rt of q.river) if (rt.seq > after) safe.add(rt.tile.kind)
      }
    }
    // 立直 1.0、3副露 0.5、2副露 0.25（聴牌している可能性に応じた重み）
    const weight = p.riichi ? 1 : openMelds >= 3 ? 0.5 : 0.25
    threats.push({ seat: p.seat, weight, riichi: p.riichi, safeKinds: safe })
  }
  return threats
}

const NON_SUJI = [6, 9, 11, 13, 13, 13, 11, 9, 6] // 1〜9 の無スジ
const SUJI = [3, 4, 5, 0, 0, 0, 5, 4, 3] // 1〜3・7〜9 のスジ（4〜6 は別扱い）

/** 1人の相手に対する、ある牌の危険度（%の目安） */
export function tileDanger(
  kind: TileKind,
  threat: Threat,
  seen: readonly number[],
  level: DefenseLevel,
): number {
  if (threat.safeKinds.has(kind)) return 0
  if (level === 1) return 8

  if (isHonor(kind)) {
    // 見えている枚数が多いほど単騎・シャンポン待ちしか残らない
    const s = seen[kind]
    return s >= 3 ? 1 : s === 2 ? 3 : s === 1 ? 6 : 8
  }

  const rank = kind % 9 // 0〜8
  const base = kind - rank
  const safe = (r: number) => r >= 0 && r <= 8 && threat.safeKinds.has(base + r)
  let danger: number
  if (rank <= 2) danger = safe(rank + 3) ? SUJI[rank] : NON_SUJI[rank]
  else if (rank >= 6) danger = safe(rank - 3) ? SUJI[rank] : NON_SUJI[rank]
  else {
    const lo = safe(rank - 3)
    const hi = safe(rank + 3)
    danger = lo && hi ? 4 : lo || hi ? 8 : NON_SUJI[rank]
  }

  if (level >= 3) {
    // 壁: 隣の牌が4枚見えていれば、その側の両面待ちは無い
    const wall = (r: number) => r >= 0 && r <= 8 && seen[base + r] >= 4
    const oneChance = (r: number) => r >= 0 && r <= 8 && seen[base + r] === 3
    const loBlocked = rank < 3 || safe(rank - 3) || wall(rank - 1) || wall(rank - 2)
    const hiBlocked = rank > 5 || safe(rank + 3) || wall(rank + 1) || wall(rank + 2)
    if (loBlocked && hiBlocked) danger = Math.min(danger, rank === 0 || rank === 8 ? 3 : 4)
    else if (oneChance(rank - 1) || oneChance(rank + 1)) danger *= 0.7
  }
  return danger
}

/** 全ての脅威に対する危険度の合計（重み付き） */
export function totalDanger(kind: TileKind, threats: Threat[], seen: readonly number[], level: DefenseLevel): number {
  let d = 0
  for (const t of threats) d += t.weight * tileDanger(kind, t, seen, level)
  return d
}
