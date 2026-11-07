/**
 * プレイヤー視点の局面（仕様 §3-1, §4-1）
 *
 * AI評価（Evaluator）とAIプレイヤーには、この視点だけを渡す。
 * 他家の手牌・山の並び・裏ドラは含まない。
 */

import type { PhysicalTile, TileKind } from '../rules/tile'
import type { MahjongGame } from './game'
import type { Action, CalledMeld, RiverTile, RoundInfo, Seat } from './types'

export interface OpponentView {
  seat: Seat
  melds: CalledMeld[]
  river: RiverTile[]
  riichi: boolean
  /** 手牌の枚数（中身は見えない） */
  handCount: number
  points: number
}

export interface PlayerView {
  seat: Seat
  /** 局面ID（仕様 §5-3：評価結果と局面の対応付けに使う） */
  decisionId: number
  roundIndex: number
  round: RoundInfo
  doraIndicators: TileKind[]
  /** 山の残り枚数 */
  wallRemaining: number
  hand: PhysicalTile[]
  /** 自分の手番でツモった牌 */
  drawn: PhysicalTile | null
  /** 自分を含む全員の公開情報（席順） */
  players: OpponentView[]
  /** 直前の打牌（応答待ちのとき） */
  lastDiscard: { seat: Seat; tile: PhysicalTile } | null
  /** 応答を求められている牌（打牌・加槓・暗槓。槍槓の判断にも使う） */
  responseTo: { seat: Seat; tile: PhysicalTile; kind: 'discard' | 'chankan' | 'ankanChankan' } | null
  isFuriten: boolean
  legalActions: Action[]
}

export function getPlayerView(game: MahjongGame, seat: Seat): PlayerView {
  const r = game.round
  const ph = r.phase
  const me = r.players[seat]
  const view: PlayerView = {
    seat,
    decisionId: game.state.decisionId,
    roundIndex: game.state.roundIndex,
    round: { wind: r.wind, dealer: r.dealer, honba: r.honba, kyoutaku: r.kyoutaku },
    doraIndicators: game.doraIndicators(),
    wallRemaining: r.wall.length,
    hand: me.hand.map((t) => ({ ...t })),
    drawn: ph.type === 'turn' && ph.seat === seat && ph.drawn ? { ...ph.drawn } : null,
    players: r.players.map((p, s) => ({
      seat: s as Seat,
      melds: structuredClone(p.melds),
      river: structuredClone(p.river),
      riichi: !!p.riichi,
      handCount: p.hand.length,
      points: p.points,
    })),
    lastDiscard: ph.type === 'response' && ph.kind === 'discard' ? { seat: ph.actor, tile: { ...ph.tile } } : null,
    responseTo: ph.type === 'response' ? { seat: ph.actor, tile: { ...ph.tile }, kind: ph.kind } : null,
    isFuriten: game.isFuriten(seat),
    legalActions: game.legalActions(seat),
  }
  return view
}

/** 立直中で、選べる行動がツモ切りだけなら、その打牌を返す */
export function autoDiscardAction(view: PlayerView): Action | null {
  if (!view.players[view.seat].riichi) return null
  const acts = view.legalActions
  return acts.length === 1 && acts[0].type === 'discard' ? acts[0] : null
}
