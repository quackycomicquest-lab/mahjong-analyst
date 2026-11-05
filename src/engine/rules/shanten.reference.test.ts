/**
 * 高速版シャンテン数（色ごとのメモ化）と参照実装（全探索）の突き合わせ。
 * ランダム手牌を大量に使い、副露ありも含めて完全一致を確認する。
 */
import { describe, expect, it } from 'vitest'
import { regularShantenUnadjusted } from './shanten'
import { referenceRegularShanten } from './shanten.reference'
import { countsToNotation } from './tile'

/** 再現可能な乱数（mulberry32） */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomHand(rand: () => number, size: number, kinds: number[]): number[] {
  const c = new Array<number>(34).fill(0)
  let n = 0
  while (n < size) {
    const k = kinds[Math.floor(rand() * kinds.length)]
    if (c[k] < 4) {
      c[k]++
      n++
    }
  }
  return c
}

describe('高速版と参照実装の一致', () => {
  it('ランダム手牌 30,000件（全色・一色・字牌多め、副露0〜3）', () => {
    const rand = rng(20261105)
    const all = Array.from({ length: 34 }, (_, i) => i)
    const pools = [
      all,
      Array.from({ length: 9 }, (_, i) => i), // 萬子のみ（清一色形）
      [...Array.from({ length: 9 }, (_, i) => 9 + i), 27, 28, 29, 30, 31, 32, 33], // 筒子＋字牌
    ]
    const mismatches: string[] = []
    for (let i = 0; i < 30000; i++) {
      const melds = Math.floor(rand() * 4)
      const size = (4 - melds) * 3 + 1 + Math.floor(rand() * 2)
      const counts = randomHand(rand, size, pools[i % pools.length])
      const fast = regularShantenUnadjusted(counts, melds)
      const ref = referenceRegularShanten(counts, melds)
      if (fast !== ref) mismatches.push(`${countsToNotation(counts)} 副露${melds}: 高速${fast} 参照${ref}`)
    }
    expect(mismatches.slice(0, 10)).toEqual([])
  })
})
