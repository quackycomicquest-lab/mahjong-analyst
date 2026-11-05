/**
 * 和了判定と面子分解
 */

import { KIND_COUNT, YAOCHU_KINDS, type TileKind } from './tile'

export type ConcealedSetType = 'shuntsu' | 'koutsu'

export interface ConcealedSet {
  type: ConcealedSetType
  /** 順子は先頭の牌、刻子はその牌 */
  kind: TileKind
}

/** 門前部分の分解（雀頭1つ＋面子）。副露は含まない。 */
export interface Decomposition {
  pair: TileKind
  sets: ConcealedSet[]
}

function total(counts: readonly number[]): number {
  let n = 0
  for (const c of counts) n += c
  return n
}

/**
 * 一般形の全分解を列挙する（重複なし）。
 * 例: 111222333m は「刻子×3」と「順子×3」の2通りに分解される。
 */
export function decomposeRegular(counts: readonly number[]): Decomposition[] {
  if (total(counts) % 3 !== 2) return []
  const results: Decomposition[] = []
  const c = counts.slice()

  const walk = (start: number, sets: ConcealedSet[], pair: TileKind): void => {
    let i = start
    while (i < KIND_COUNT && c[i] === 0) i++
    if (i >= KIND_COUNT) {
      results.push({ pair, sets: sets.slice() })
      return
    }
    if (c[i] >= 3) {
      c[i] -= 3
      sets.push({ type: 'koutsu', kind: i })
      walk(i, sets, pair)
      sets.pop()
      c[i] += 3
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--
      c[i + 1]--
      c[i + 2]--
      sets.push({ type: 'shuntsu', kind: i })
      walk(i, sets, pair)
      sets.pop()
      c[i]++
      c[i + 1]++
      c[i + 2]++
    }
  }

  for (let p = 0; p < KIND_COUNT; p++) {
    if (c[p] < 2) continue
    c[p] -= 2
    walk(0, [], p)
    c[p] += 2
  }
  return results
}

/** 七対子形（7種類の対子。同じ牌4枚は不可） */
export function isChiitoitsuForm(counts: readonly number[]): boolean {
  let pairs = 0
  for (const c of counts) {
    if (c === 2) pairs++
    else if (c !== 0) return false
  }
  return pairs === 7
}

/** 国士無双形 */
export function isKokushiForm(counts: readonly number[]): boolean {
  if (total(counts) !== 14) return false
  let pair = false
  for (const k of YAOCHU_KINDS) {
    if (counts[k] === 0) return false
    if (counts[k] === 2) pair = true
  }
  return pair && YAOCHU_KINDS.reduce((n, k) => n + counts[k], 0) === 14
}

/**
 * 和了形かどうか（役の有無は問わない）。
 * @param counts 門前部分（和了牌を含む）
 * @param meldCount 副露数（暗槓を含む）
 */
export function isAgari(counts: readonly number[], meldCount = 0): boolean {
  if (total(counts) !== (4 - meldCount) * 3 + 2) return false
  if (meldCount === 0 && (isChiitoitsuForm(counts) || isKokushiForm(counts))) return true
  return decomposeRegular(counts).length > 0
}

/** 3n+1 枚の手牌の待ち牌（和了形になる牌の種類。4枚使い切りの牌は除く） */
export function waitingKinds(counts: readonly number[], meldCount = 0): TileKind[] {
  const c = counts.slice()
  const waits: TileKind[] = []
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 4) continue
    c[k]++
    if (isAgari(c, meldCount)) waits.push(k)
    c[k]--
  }
  return waits
}
