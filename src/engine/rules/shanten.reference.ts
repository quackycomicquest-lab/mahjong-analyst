/**
 * 一般形シャンテン数の参照実装（全探索・低速）。
 * 高速版 regularShanten との突き合わせテスト専用。アプリ本体からは使わない。
 */

import { KIND_COUNT } from './tile'

/** 一般形のシャンテン数（形式聴牌の補正前） */
export function referenceRegularShanten(counts: readonly number[], meldCount = 0): number {
  const c = counts.slice()
  const needMentsu = 4 - meldCount
  let best = needMentsu * 2

  // 探索：i 以降の牌から面子・搭子を抜き出す
  const search = (start: number, mentsu: number, taatsu: number, pair: number): void => {
    let i = start
    while (i < KIND_COUNT && c[i] === 0) i++

    if (i >= KIND_COUNT) {
      // 面子+搭子は needMentsu まで（雀頭は別枠）
      const t = Math.min(taatsu, needMentsu - mentsu)
      const s = needMentsu * 2 - mentsu * 2 - t - pair
      if (s < best) best = s
      return
    }

    const isNum = i < 27
    const pos = i % 9

    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3
      search(i, mentsu + 1, taatsu, pair)
      c[i] += 3
    }
    // 順子
    if (isNum && pos <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--
      search(i, mentsu + 1, taatsu, pair)
      c[i]++; c[i + 1]++; c[i + 2]++
    }
    // 対子（搭子として）
    if (c[i] >= 2) {
      c[i] -= 2
      search(i, mentsu, taatsu + 1, pair)
      c[i] += 2
    }
    // 両面・辺張
    if (isNum && pos <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--
      search(i, mentsu, taatsu + 1, pair)
      c[i]++; c[i + 1]++
    }
    // 嵌張
    if (isNum && pos <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--
      search(i, mentsu, taatsu + 1, pair)
      c[i]++; c[i + 2]++
    }
    // この種類の残りを孤立牌として捨てる
    const saved = c[i]
    c[i] = 0
    search(i + 1, mentsu, taatsu, pair)
    c[i] = saved
  }

  // 雀頭なし
  search(0, 0, 0, 0)
  // 雀頭を1つ固定
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 2) {
      c[k] -= 2
      search(0, 0, 0, 1)
      c[k] += 2
    }
  }

  return best
}
