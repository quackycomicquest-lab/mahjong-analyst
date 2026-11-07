/**
 * 放銃危険度の推定（AIプレイヤーの守備判断と打牌評価で共通に使う）
 *
 * プレイヤー視点（PlayerView）だけを使う。牌を「現物・スジ・無スジ・字牌の見え枚数・壁」などで分類し、
 * 分類ごとの放銃率（%）を返す。放銃率は AI 同士の大量対局で実測した値（calibration.json）を使い、
 * 実測がない分類は経験則の既定値を使う。
 */

import { dangerPercent, type ThreatType } from '../calibration/calibration'
import type { Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import { isHonor, KIND_COUNT, type TileKind } from '../rules/tile'

export interface Threat {
  seat: Seat
  type: ThreatType
  /** 脅威の強さの目安（表示・局の終わりやすさ用。立直 1.0、3副露 0.5、2副露 0.25） */
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
    const type: ThreatType = p.riichi ? 'riichi' : openMelds >= 3 ? 'open3' : 'open2'
    const weight = p.riichi ? 1 : openMelds >= 3 ? 0.5 : 0.25
    threats.push({ seat: p.seat, type, weight, riichi: p.riichi, safeKinds: safe })
  }
  return threats
}

/**
 * 危険度の分類。
 * - genbutsu：現物（立直後に通った牌を含む）
 * - honor-sN：字牌（自分から N 枚見えている）。4 枚とも見えている字牌は genbutsu と同じ扱い
 * - suji-19 / suji-28 / suji-37：スジの端・2/8・3/7
 * - nakasuji / katasuji：4〜6 の両スジ・片スジ
 * - musuji-19 / musuji-28 / musuji-37 / musuji-456：無スジ
 * - 強さ3では無スジ・片スジに「+nochance（壁で両面待ちがない）」「+onechance」を付ける
 * - 強さ1は現物かどうかしか区別しない（unknown）
 */
export function dangerCategory(
  kind: TileKind,
  safeKinds: Set<TileKind>,
  seen: readonly number[],
  level: DefenseLevel,
): string {
  if (safeKinds.has(kind)) return 'genbutsu'
  if (level === 1) return 'unknown'
  // 字牌は4枚とも見えていれば（最後の1枚を自分が持っている）、国士無双以外で当たらない
  if (isHonor(kind)) return seen[kind] >= 4 ? 'genbutsu' : `honor-s${Math.min(seen[kind], 3)}`

  const rank = kind % 9 // 0〜8
  const base = kind - rank
  const safe = (r: number) => r >= 0 && r <= 8 && safeKinds.has(base + r)
  const group = rank === 0 || rank === 8 ? '19' : rank === 1 || rank === 7 ? '28' : rank === 2 || rank === 6 ? '37' : '456'
  let cat: string
  if (rank <= 2) cat = safe(rank + 3) ? `suji-${group}` : `musuji-${group}`
  else if (rank >= 6) cat = safe(rank - 3) ? `suji-${group}` : `musuji-${group}`
  else {
    const lo = safe(rank - 3)
    const hi = safe(rank + 3)
    cat = lo && hi ? 'nakasuji' : lo || hi ? 'katasuji' : 'musuji-456'
  }

  if (level >= 3 && (cat.startsWith('musuji') || cat === 'katasuji')) {
    // 壁: 隣の牌が4枚見えていれば、その側の両面待ちは無い
    const wall = (r: number) => r >= 0 && r <= 8 && seen[base + r] >= 4
    const oneChance = (r: number) => r >= 0 && r <= 8 && seen[base + r] === 3
    const loBlocked = rank < 3 || safe(rank - 3) || wall(rank - 1) || wall(rank - 2)
    const hiBlocked = rank > 5 || safe(rank + 3) || wall(rank + 1) || wall(rank + 2)
    if (loBlocked && hiBlocked) cat += '+nochance'
    else if (oneChance(rank - 1) || oneChance(rank + 1)) cat += '+onechance'
  }
  return cat
}

/** 1人の相手に対する、ある牌の危険度（放銃率 %） */
export function tileDanger(
  kind: TileKind,
  threat: Threat,
  seen: readonly number[],
  level: DefenseLevel,
): number {
  return dangerPercent(threat.type, dangerCategory(kind, threat.safeKinds, seen, level))
}

/** 全ての脅威に対する危険度の合計（%） */
export function totalDanger(kind: TileKind, threats: Threat[], seen: readonly number[], level: DefenseLevel): number {
  let d = 0
  for (const t of threats) d += tileDanger(kind, t, seen, level)
  return d
}
