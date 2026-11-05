/**
 * シャンテン数計算（仕様 §4-1 ① Rules Engine）
 *
 * 入力は種類ごとの枚数（長さ34）。手牌の枚数は 3n+1（打牌後）または 3n+2（ツモ後）。
 * 鳴いている場合は副露数を meldCount に渡す（手牌側は残りの牌だけを渡す）。
 *
 * 戻り値: -1 = 和了形, 0 = 聴牌, 1 = 一向聴 ...
 */

import { KIND_COUNT, YAOCHU_KINDS } from './tile'

export interface ShantenResult {
  /** 3形の最小値 */
  shanten: number
  regular: number
  /** 副露ありの場合は Infinity */
  chiitoitsu: number
  /** 副露ありの場合は Infinity */
  kokushi: number
}

function tileTotal(counts: readonly number[]): number {
  let n = 0
  for (const c of counts) n += c
  return n
}

// ---------------------------------------------------------------------------
// 一般形：色ごとの分解結果をメモ化して合成する
//
// シャンテン数 = 2N − 2m − min(t, N−m) − p
//   N: 必要な面子数（4 − 副露数）, m: 面子数, t: 搭子数, p: 雀頭(0/1)
// 面子・搭子は色をまたがないので、色（萬・筒・索・字）ごとに
// 「面子 m 個のとき取れる搭子の最大数」を求めておけば、色の合成は足し算で済む。
// 同じ m なら搭子が多いほどシャンテン数は小さいので、m ごとの最大値だけ持てば十分。

const NONE = -64
const MAX_M = 4

/**
 * 1色分の分解結果。長さ10: [0..4] = 雀頭なしで面子 m 個のときの最大搭子数,
 * [5..9] = 雀頭ありで面子 m 個のときの最大搭子数。不可能なら NONE。
 */
type SuitTable = Int8Array

const numberCache = new Map<number, SuitTable>()
const honorCache = new Map<number, SuitTable>()

function analyzeSuit(c: number[], isHonor: boolean): SuitTable {
  const out = new Int8Array(10).fill(NONE)
  const len = c.length
  const walk = (start: number, m: number, t: number, pair: number): void => {
    let i = start
    while (i < len && c[i] === 0) i++
    if (i >= len) {
      const idx = pair * 5 + m
      if (t > out[idx]) out[idx] = t
      return
    }
    if (c[i] >= 3) {
      c[i] -= 3
      walk(i, m + 1, t, pair)
      c[i] += 3
    }
    if (!isHonor && i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--
      walk(i, m + 1, t, pair)
      c[i]++; c[i + 1]++; c[i + 2]++
    }
    if (c[i] >= 2) {
      c[i] -= 2
      if (pair === 0) walk(i, m, t, 1) // 雀頭として
      walk(i, m, t + 1, pair) // 対子搭子として
      c[i] += 2
    }
    if (!isHonor && i <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--
      walk(i, m, t + 1, pair)
      c[i]++; c[i + 1]++
    }
    if (!isHonor && i <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--
      walk(i, m, t + 1, pair)
      c[i]++; c[i + 2]++
    }
    const saved = c[i]
    c[i] = 0
    walk(i + 1, m, t, pair)
    c[i] = saved
  }
  walk(0, 0, 0, 0)
  return out
}

function suitTable(counts: readonly number[], offset: number, isHonor: boolean): SuitTable {
  const len = isHonor ? 7 : 9
  let key = 0
  for (let i = len - 1; i >= 0; i--) key = key * 5 + counts[offset + i]
  const cache = isHonor ? honorCache : numberCache
  let table = cache.get(key)
  if (!table) {
    table = analyzeSuit(Array.from({ length: len }, (_, i) => counts[offset + i]), isHonor)
    cache.set(key, table)
  }
  return table
}

// 合成用の作業バッファ（呼び出しごとの確保を避ける）
let accBuf = new Int8Array(10)
let nextBuf = new Int8Array(10)

/**
 * 一般形のシャンテン数（形式聴牌の補正前）。
 * 参照実装との突き合わせテスト用に公開している。通常は regularShanten を使う。
 */
export function regularShantenUnadjusted(counts: readonly number[], meldCount = 0): number {
  const need = 4 - meldCount
  // acc[pair*5 + m] = 合成済みの色での最大搭子数
  let acc = accBuf.fill(NONE)
  let next = nextBuf
  acc[0] = 0
  for (let s = 0; s < 4; s++) {
    const tbl = suitTable(counts, s * 9, s === 3)
    next.fill(NONE)
    for (let pa = 0; pa < 2; pa++) {
      for (let ma = 0; ma <= MAX_M; ma++) {
        const ta = acc[pa * 5 + ma]
        if (ta === NONE) continue
        for (let pb = 0; pb + pa < 2; pb++) {
          for (let mb = 0; ma + mb <= MAX_M; mb++) {
            const tb = tbl[pb * 5 + mb]
            if (tb === NONE) continue
            const idx = (pa + pb) * 5 + ma + mb
            if (ta + tb > next[idx]) next[idx] = ta + tb
          }
        }
      }
    }
    const tmp = acc
    acc = next
    next = tmp
  }
  accBuf = acc
  nextBuf = next

  let best = need * 2
  for (let p = 0; p < 2; p++) {
    for (let m = 0; m <= need; m++) {
      const t = acc[p * 5 + m]
      if (t === NONE) continue
      const s = need * 2 - m * 2 - Math.min(t, need - m) - p
      if (s < best) best = s
    }
  }
  // 4面子1雀頭が揃うと 8-8-0-1 = -1（和了）になる
  return best
}

/** 一般形（4面子1雀頭）のシャンテン数 */
export function regularShanten(counts: readonly number[], meldCount = 0): number {
  const best = regularShantenUnadjusted(counts, meldCount)
  if (best === 0 && !hasRealTenpai(counts)) return 1
  return best
}

/**
 * 形の上では聴牌でも、待ち牌を自分で4枚使い切っている場合（例: 4444s の単騎）は
 * 和了できないので聴牌とみなさない。
 * - 3n+1 枚: 4枚未満の牌で和了形になるものがあるか
 * - 3n+2 枚: いずれかの打牌で上記を満たすか
 */
function hasRealTenpai(counts: readonly number[]): boolean {
  const c = counts.slice()
  const waitsExist = (): boolean => {
    for (let k = 0; k < KIND_COUNT; k++) {
      if (c[k] >= 4) continue
      c[k]++
      const ok = isRegularAgari(c)
      c[k]--
      if (ok) return true
    }
    return false
  }
  if (tileTotal(c) % 3 === 1) return waitsExist()
  for (let d = 0; d < KIND_COUNT; d++) {
    if (c[d] === 0) continue
    c[d]--
    const ok = waitsExist()
    c[d]++
    if (ok) return true
  }
  return false
}

/** 一般形の和了判定（雀頭1つ＋残りが全て面子） */
export function isRegularAgari(counts: readonly number[]): boolean {
  const n = tileTotal(counts)
  if (n % 3 !== 2) return false
  const c = counts.slice()
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] < 2) continue
    c[k] -= 2
    if (allMentsu(c)) return true
    c[k] += 2
  }
  return false
}

function allMentsu(counts: number[]): boolean {
  const c = counts.slice()
  for (let i = 0; i < KIND_COUNT; i++) {
    if (c[i] === 0) continue
    if (c[i] >= 3) c[i] -= 3
    if (c[i] === 0) continue
    // 残りは順子でしか消せない
    if (i >= 27 || i % 9 > 6) return false
    const n = c[i]
    if (c[i + 1] < n || c[i + 2] < n) return false
    c[i] -= n
    c[i + 1] -= n
    c[i + 2] -= n
  }
  return true
}

/** 七対子のシャンテン数（同じ牌4枚は2対子と数えない） */
export function chiitoitsuShanten(counts: readonly number[]): number {
  let pairs = 0
  let kinds = 0
  for (const c of counts) {
    if (c >= 1) kinds++
    if (c >= 2) pairs++
  }
  return 6 - pairs + Math.max(0, 7 - kinds)
}

/** 国士無双のシャンテン数 */
export function kokushiShanten(counts: readonly number[]): number {
  let kinds = 0
  let hasPair = false
  for (const k of YAOCHU_KINDS) {
    if (counts[k] >= 1) kinds++
    if (counts[k] >= 2) hasPair = true
  }
  return 13 - kinds - (hasPair ? 1 : 0)
}

export function calculateShanten(counts: readonly number[], meldCount = 0): ShantenResult {
  const n = tileTotal(counts)
  const expected = (4 - meldCount) * 3
  if (n !== expected + 1 && n !== expected + 2) {
    throw new Error(`手牌の枚数が不正です: ${n}枚（副露${meldCount}）`)
  }
  const regular = regularShanten(counts, meldCount)
  const closed = meldCount === 0
  const chiitoitsu = closed ? chiitoitsuShanten(counts) : Infinity
  const kokushi = closed ? kokushiShanten(counts) : Infinity
  return { shanten: Math.min(regular, chiitoitsu, kokushi), regular, chiitoitsu, kokushi }
}

export function shanten(counts: readonly number[], meldCount = 0): number {
  return calculateShanten(counts, meldCount).shanten
}
