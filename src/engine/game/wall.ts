/**
 * 乱数と山の生成
 */

import { createTileSet, type PhysicalTile, type RedFiveConfig } from '../rules/tile'

/** 再現可能な乱数（mulberry32）。0 以上 1 未満を返す。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 局ごとの seed（対局 seed と局番号から決める） */
export function roundSeed(gameSeed: number, roundIndex: number): number {
  return (Math.imul(gameSeed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(roundIndex + 1, 0xc2b2ae35)) >>> 0
}

export function shuffledTiles(seed: number, red: RedFiveConfig): PhysicalTile[] {
  const tiles = createTileSet(red)
  const rand = createRng(seed)
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[tiles[i], tiles[j]] = [tiles[j], tiles[i]]
  }
  return tiles
}

export interface DealtRound {
  hands: [PhysicalTile[], PhysicalTile[], PhysicalTile[], PhysicalTile[]]
  wall: PhysicalTile[]
  deadWall: PhysicalTile[]
}

/**
 * 136枚の並びから配牌する。
 * 並びの先頭14枚を王牌、続く52枚を親から順に13枚ずつ配り、残り70枚を山とする。
 * （テスト用に並びを直接指定できるよう、物理的な積み方は再現しない）
 */
export function dealFromOrder(order: PhysicalTile[], dealer: number): DealtRound {
  if (order.length !== 136) throw new Error(`山は136枚必要です（${order.length}枚）`)
  const deadWall = order.slice(0, 14)
  const hands: DealtRound['hands'] = [[], [], [], []]
  for (let i = 0; i < 4; i++) {
    const seat = (dealer + i) % 4
    hands[seat] = order.slice(14 + i * 13, 14 + (i + 1) * 13)
  }
  return { hands, wall: order.slice(66), deadWall }
}
