/**
 * テスト用：牌姿の記法から PlayerView（席0の視点）を組み立てる
 */
import type { Action, RiverTile, Seat } from '../game/types'
import type { PlayerView } from '../game/view'
import { calculateShanten } from '../rules/shanten'
import { countsOfTiles, createTileSet, parseHand, type PhysicalTile } from '../rules/tile'

function tileFactory() {
  const pool = createTileSet()
  const used = new Set<number>()
  return (notation: string): PhysicalTile[] =>
    parseHand(notation).map(({ kind, red }) => {
      const t = pool.find((x) => x.kind === kind && x.red === red && !used.has(x.id))!
      used.add(t.id)
      return t
    })
}

export interface ViewSpec {
  hand: string
  /** 席ごとの河。末尾に * を付けた牌は立直宣言牌 */
  rivers?: Partial<Record<Seat, string[]>>
  dora?: string
  /** 応答局面：直前の打牌と、選べる行動 */
  response?: { from: Seat; tile: string; actions: (tile: PhysicalTile, hand: PhysicalTile[]) => Action[] }
  riichiAllowed?: boolean
  wallRemaining?: number
}

export function makeView(spec: ViewSpec): PlayerView {
  const take = tileFactory()
  const hand = take(spec.hand)
  let seq = 0
  const players = ([0, 1, 2, 3] as Seat[]).map((s) => {
    const river: RiverTile[] = (spec.rivers?.[s] ?? []).map((n) => {
      const riichi = n.endsWith('*')
      return { tile: take(n.replace('*', ''))[0], tsumogiri: false, riichi, calledBy: null, seq: seq++ }
    })
    return { seat: s, melds: [], river, riichi: river.some((r) => r.riichi), handCount: 13, points: 25000 }
  })
  const doraIndicators = take(spec.dora ?? '1z').map((t) => t.kind)
  let legalActions: Action[]
  let lastDiscard: PlayerView['lastDiscard'] = null
  if (spec.response) {
    const tile = take(spec.response.tile)[0]
    lastDiscard = { seat: spec.response.from, tile }
    legalActions = [...spec.response.actions(tile, hand), { type: 'pass', seat: 0 }]
  } else {
    legalActions = hand.flatMap((t) => {
      const acts: Action[] = [{ type: 'discard', seat: 0, tileId: t.id }]
      if (spec.riichiAllowed) {
        const rest = countsOfTiles(hand.filter((h) => h.id !== t.id))
        if (calculateShanten(rest).shanten === 0) acts.push({ type: 'discard', seat: 0, tileId: t.id, riichi: true })
      }
      return acts
    })
  }
  return {
    seat: 0,
    decisionId: 1,
    roundIndex: 0,
    round: { wind: 27, dealer: 1, honba: 0, kyoutaku: 0 },
    doraIndicators,
    wallRemaining: spec.wallRemaining ?? 50,
    hand,
    drawn: spec.response ? null : hand[hand.length - 1],
    players,
    lastDiscard,
    isFuriten: false,
    legalActions,
  }
}

