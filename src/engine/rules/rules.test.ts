import { describe, expect, it } from 'vitest'
import { discardOptions, ukeire } from './efficiency'
import { calculateShanten, isRegularAgari, shanten } from './shanten'
import {
  countsToNotation,
  createTileSet,
  kindName,
  kindOf,
  parseCounts,
  parseHand,
} from './tile'

describe('牌モデル', () => {
  it('136枚・IDは一意・赤は各色1枚', () => {
    const set = createTileSet()
    expect(set).toHaveLength(136)
    expect(new Set(set.map((t) => t.id)).size).toBe(136)
    const reds = set.filter((t) => t.red)
    expect(reds.map((t) => kindName(t.kind))).toEqual(['5萬', '5筒', '5索'])
  })

  it('同じ種類でも個体IDが異なる', () => {
    const fives = createTileSet().filter((t) => t.kind === kindOf('m', 5))
    expect(fives).toHaveLength(4)
    expect(new Set(fives.map((t) => t.id)).size).toBe(4)
    expect(fives.filter((t) => t.red)).toHaveLength(1)
  })

  it('赤なし設定', () => {
    expect(createTileSet({ m: 0, p: 0, s: 0 }).some((t) => t.red)).toBe(false)
  })

  it('牌姿記法のパースと往復', () => {
    const h = parseHand('406m1z')
    expect(h).toEqual([
      { kind: kindOf('m', 4), red: false },
      { kind: kindOf('m', 5), red: true },
      { kind: kindOf('m', 6), red: false },
      { kind: kindOf('z', 1), red: false },
    ])
    expect(countsToNotation(parseCounts('3m21p9s77z1m'))).toBe('13m12p9s77z')
  })

  it('不正な記法はエラー', () => {
    expect(() => parseHand('8z')).toThrow()
    expect(() => parseHand('0z')).toThrow()
    expect(() => parseHand('123')).toThrow()
    expect(() => parseHand('12x')).toThrow()
  })
})

describe('シャンテン数', () => {
  const s = (n: string) => shanten(parseCounts(n))

  it('和了形は -1', () => {
    expect(s('123m456p789s123s11z')).toBe(-1)
    expect(s('1122m3344p5566s77z')).toBe(-1) // 七対子
    expect(s('19m19p19s12345677z')).toBe(-1)
    expect(isRegularAgari(parseCounts('111222333m44455p'))).toBe(true)
  })

  it('聴牌は 0', () => {
    expect(s('123m456p789s123s1z')).toBe(0) // 単騎
    expect(s('19m19p19s1234567z')).toBe(0) // 国士13面
    expect(s('1122m3344p5566s7z')).toBe(0) // 七対子
    expect(s('23m456p789s11122z')).toBe(0) // 両面
  })

  it('自分で4枚持っている牌の単騎は聴牌ではない', () => {
    expect(shanten(parseCounts('4444s'), 3)).toBe(1)
    expect(shanten(parseCounts('44445s'), 3)).toBe(0) // 4s切りで5s単騎
  })

  it('七対子：同じ牌4枚は2対子と数えない', () => {
    const r = calculateShanten(parseCounts('1111m2222p3333s4z'))
    expect(r.chiitoitsu).toBe(6)
  })

  it('副露ありは七対子・国士を考えない', () => {
    const r = calculateShanten(parseCounts('123m456p789s7z'), 1)
    expect(r.regular).toBe(0)
    expect(r.chiitoitsu).toBe(Infinity)
    expect(r.kokushi).toBe(Infinity)
  })

  it('枚数が不正ならエラー', () => {
    expect(() => shanten(parseCounts('123m'))).toThrow()
  })
})

describe('牌効率', () => {
  it('両面待ちの受け入れ', () => {
    const u = ukeire(parseCounts('23m456p789s11122z'))
    expect(u.shanten).toBe(0)
    expect(u.tiles.map((t) => kindName(t.kind))).toEqual(['1萬', '4萬'])
    expect(u.total).toBe(8)
  })

  it('見えている牌は残り枚数から引く', () => {
    const visible = parseCounts('1m1m4m')
    const u = ukeire(parseCounts('23m456p789s11122z'), 0, visible)
    expect(u.tiles).toEqual([
      { kind: kindOf('m', 1), remaining: 2 },
      { kind: kindOf('m', 4), remaining: 3 },
    ])
    expect(u.total).toBe(5)
  })

  it('仕様書 §3-1 の例：東切りは一向聴に戻る', () => {
    // 1萬〜6萬 2筒〜5筒 7索 8索 東 東
    const opts = discardOptions(parseCounts('123456m2345p78s11z'))
    const best = opts[0]
    expect(best.shanten).toBe(0)
    expect(['2筒', '5筒']).toContain(kindName(best.discard))
    const east = opts.find((o) => o.discard === kindOf('z', 1))!
    expect(east.shanten).toBe(1)
  })
})
