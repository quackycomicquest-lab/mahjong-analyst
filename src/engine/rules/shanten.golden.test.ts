/**
 * Python `mahjong`（MIT, 天鳳牌譜で検証済み）との照合テスト。
 * データ再生成: npm run golden:shanten
 */
import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/shanten-golden.json'
import { calculateShanten } from './shanten'
import { countsToNotation } from './tile'

interface GoldenCase {
  counts: number[]
  melds: number
  shanten: number
  regular: number
  chiitoitsu: number | null
  kokushi: number | null
}

const cases = (golden as { cases: GoldenCase[] }).cases

describe(`シャンテン数ゴールデン照合（${cases.length}件）`, () => {
  it('全形の値が Python mahjong と一致する', () => {
    const mismatches: string[] = []
    for (const g of cases) {
      const r = calculateShanten(g.counts, g.melds)
      const ok =
        r.shanten === g.shanten &&
        r.regular === g.regular &&
        (g.chiitoitsu === null || r.chiitoitsu === g.chiitoitsu) &&
        (g.kokushi === null || r.kokushi === g.kokushi)
      if (!ok) {
        mismatches.push(
          `${countsToNotation(g.counts)} 副露${g.melds}: ` +
            `期待 ${JSON.stringify({ s: g.shanten, r: g.regular, c: g.chiitoitsu, k: g.kokushi })} ` +
            `実際 ${JSON.stringify({ s: r.shanten, r: r.regular, c: r.chiitoitsu, k: r.kokushi })}`,
        )
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([])
  })
})
