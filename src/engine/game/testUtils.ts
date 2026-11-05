/**
 * 対局エンジンのテスト用ヘルパー
 */

import { createTileSet, parseHand, type PhysicalTile } from '../rules/tile'
import { MahjongGame } from './game'
import type { Bot } from './simpleBots'
import { SEATS, type Seat } from './types'
import { getPlayerView } from './view'

/**
 * 指定した配牌・ツモ順・ドラ表示牌から 136枚の並びを作る（dealer=0 前提で席順に配る）。
 * 指定しなかった部分は残りの牌で埋める。
 */
export function buildWallOrder(spec: {
  hands: [string, string, string, string]
  /** 山の先頭からのツモ順（席0のツモ、席1のツモ…の順に並べる） */
  draws?: string
  dora?: string
}): PhysicalTile[] {
  const pool = createTileSet()
  const used = new Set<number>()
  const take = (notation: string): PhysicalTile[] =>
    parseHand(notation).map(({ kind, red }) => {
      const t = pool.find((x) => x.kind === kind && x.red === red && !used.has(x.id))
      if (!t) throw new Error(`牌が足りません: ${notation}`)
      used.add(t.id)
      return t
    })
  const hands = spec.hands.map((h) => {
    const tiles = take(h)
    if (tiles.length !== 13) throw new Error(`配牌は13枚: ${h}`)
    return tiles
  })
  const draws = take(spec.draws ?? '')
  const dora = take(spec.dora ?? '')
  const rest = () => {
    const t = pool.find((x) => !used.has(x.id))!
    used.add(t.id)
    return t
  }
  const dead: PhysicalTile[] = []
  for (let i = 0; i < 14; i++) dead.push(i === 4 && dora[0] ? dora[0] : rest())
  const wall = [...draws]
  while (wall.length < 70) wall.push(rest())
  return [...dead, ...hands.flat(), ...wall]
}

/** 牌の総数・一意性・点数の保存を確認する（違反があれば例外） */
export function checkInvariants(game: MahjongGame): void {
  const r = game.round
  const total = r.players.reduce((n, p) => n + p.points, 0) + r.kyoutaku * 1000
  const expected = game.state.config.startingPoints * 4
  if (total !== expected) throw new Error(`点数の合計が ${total}（期待 ${expected}）`)

  const ph = r.phase
  if (ph.type !== 'turn' && ph.type !== 'response') return
  const ids: number[] = []
  for (const p of r.players) {
    ids.push(...p.hand.map((t) => t.id))
    ids.push(...p.melds.flatMap((m) => m.tiles.map((t) => t.id)))
    ids.push(...p.river.filter((rt) => rt.calledBy === null).map((rt) => rt.tile.id))
  }
  // 王牌のうち取り出し済みの嶺上牌（先頭 rinshanUsed 枚）は手牌側で数える
  ids.push(...r.wall.map((t) => t.id), ...r.deadWall.slice(r.rinshanUsed).map((t) => t.id))
  if (ids.length !== 136 || new Set(ids).size !== 136) {
    throw new Error(`牌の数が不正: ${ids.length}枚 / 重複なし${new Set(ids).size}枚`)
  }
  for (const s of SEATS) {
    const p = r.players[s]
    const size = p.hand.length + p.melds.length * 3
    // 手番の人、または槍槓の確認中に加槓・暗槓した人は14枚
    const holding =
      (ph.type === 'turn' && ph.seat === s) || (ph.type === 'response' && ph.kind !== 'discard' && ph.actor === s)
    const want = holding ? 14 : 13
    if (size !== want) {
      throw new Error(`席${s}の手牌が${size}枚（期待${want}）phase=${ph.type}${ph.type === 'response' ? `/${ph.kind}/actor${ph.actor}` : ''}`)
    }
  }
  if (r.deadWall.length - r.rinshanUsed !== 14) throw new Error('王牌が14枚ではありません')
}

/** 対局を最後まで進める。毎手 checkInvariants を確認する */
export function playToEnd(game: MahjongGame, bots: Record<Seat, Bot>, maxSteps = 50000): void {
  let steps = 0
  while (game.phase.type !== 'gameEnd') {
    if (game.phase.type === 'roundEnd') {
      game.apply({ type: 'nextRound' })
    } else {
      const seat = game.pendingSeats()[0]
      game.apply(bots[seat](getPlayerView(game, seat)))
    }
    checkInvariants(game)
    if (++steps > maxSteps) throw new Error('対局が終わりません')
  }
}
