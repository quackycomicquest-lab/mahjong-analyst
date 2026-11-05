/**
 * 牌効率（受け入れ枚数・打牌候補ごとの比較）
 *
 * Evaluator（仕様 §4-1 ③）の段階 E1 の基礎計算。
 * 「見えている牌」は自分の視点で見える牌（河・副露・ドラ表示牌など）だけを渡す。
 * 相手の隠し手牌は渡さない（仕様 §4-1）。
 */

import { calculateShanten } from './shanten'
import { COPIES_PER_KIND, KIND_COUNT, type TileKind } from './tile'

export interface EffectiveTile {
  kind: TileKind
  /** 自分から見て残っている枚数（4 − 自分の手牌 − 見えている牌） */
  remaining: number
}

export interface UkeireResult {
  shanten: number
  /** シャンテン数を進める牌の一覧（kind 昇順） */
  tiles: EffectiveTile[]
  /** 残り枚数の合計 */
  total: number
}

export interface DiscardOption {
  discard: TileKind
  shanten: number
  ukeire: UkeireResult
}

const EMPTY_VISIBLE: readonly number[] = new Array<number>(KIND_COUNT).fill(0)

/**
 * 3n+1 枚の手牌の受け入れ。
 * @param visible 手牌以外で自分に見えている牌の種類別枚数
 */
export function ukeire(
  counts: readonly number[],
  meldCount = 0,
  visible: readonly number[] = EMPTY_VISIBLE,
): UkeireResult {
  const base = calculateShanten(counts, meldCount).shanten
  const c = counts.slice()
  const tiles: EffectiveTile[] = []
  let total = 0
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= COPIES_PER_KIND) continue
    c[k]++
    const after = calculateShanten(c, meldCount).shanten
    c[k]--
    if (after < base) {
      const remaining = Math.max(0, COPIES_PER_KIND - counts[k] - visible[k])
      tiles.push({ kind: k, remaining })
      total += remaining
    }
  }
  return { shanten: base, tiles, total }
}

/**
 * 3n+2 枚の手牌について、打牌候補（種類ごと）を比較する。
 * 並び順: シャンテン数が小さい順 → 受け入れ枚数が多い順 → kind 昇順。
 */
export function discardOptions(
  counts: readonly number[],
  meldCount = 0,
  visible: readonly number[] = EMPTY_VISIBLE,
): DiscardOption[] {
  const c = counts.slice()
  const options: DiscardOption[] = []
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] === 0) continue
    c[k]--
    const u = ukeire(c, meldCount, visible)
    c[k]++
    options.push({ discard: k, shanten: u.shanten, ukeire: u })
  }
  options.sort(
    (a, b) => a.shanten - b.shanten || b.ukeire.total - a.ukeire.total || a.discard - b.discard,
  )
  return options
}
