/**
 * 振り返り用：ある行動をとった後の手牌（牌姿）を作る
 *
 * - 打牌：その牌を抜いた手牌
 * - ポン・チー：鳴いた面子を外に出し、鳴いた後に切る牌（候補の kind）を抜いた手牌
 * - スキップ：手牌そのまま
 * - 和了・カン・九種九牌：牌姿を比べる意味が薄いので null
 */
import type { Action } from '../game/types'
import type { PlayerView } from '../game/view'
import type { PhysicalTile, TileKind } from '../rules/tile'

export interface HandAfter {
  /** 理牌した手牌 */
  tiles: PhysicalTile[]
  /** この行動で鳴いた面子（鳴いていなければ null） */
  meld: PhysicalTile[] | null
  /** 切った牌（スキップなら null） */
  discarded: PhysicalTile | null
}

const sortTiles = (ts: PhysicalTile[]) => [...ts].sort((a, b) => a.kind - b.kind || Number(b.red) - Number(a.red))

/** kind の牌を1枚抜く（赤ドラでない牌を優先） */
function removeKind(tiles: PhysicalTile[], kind: TileKind): { rest: PhysicalTile[]; removed: PhysicalTile | null } {
  const same = tiles.filter((t) => t.kind === kind)
  const pick = same.find((t) => !t.red) ?? same[0]
  if (!pick) return { rest: tiles, removed: null }
  return { rest: tiles.filter((t) => t.id !== pick.id), removed: pick }
}

/**
 * @param kind 鳴いた後に切る牌（候補の kind）。打牌では使わない
 */
export function handAfter(view: PlayerView, action: Action, kind: TileKind | null): HandAfter | null {
  const hand = view.hand
  if (action.type === 'discard') {
    const t = hand.find((x) => x.id === action.tileId)
    if (!t) return null
    return { tiles: sortTiles(hand.filter((x) => x.id !== t.id)), meld: null, discarded: t }
  }
  if (action.type === 'pass') return { tiles: sortTiles(hand), meld: null, discarded: null }
  if ((action.type === 'pon' || action.type === 'chi') && view.responseTo) {
    const used = new Set(action.tileIds)
    const meld = sortTiles([...hand.filter((t) => used.has(t.id)), view.responseTo.tile])
    const left = hand.filter((t) => !used.has(t.id))
    if (kind === null) return { tiles: sortTiles(left), meld, discarded: null }
    const { rest, removed } = removeKind(left, kind)
    return { tiles: sortTiles(rest), meld, discarded: removed }
  }
  return null
}
