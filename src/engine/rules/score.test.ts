import { describe, expect, it } from 'vitest'
import { decomposeRegular, isAgari, waitingKinds } from './agari'
import { calculateHandValue, doraFromIndicator, type HandValue } from './score'
import { createTileSet, kindName, kindOf, parseCounts, parseHand, type PhysicalTile } from './tile'
import type { Meld, MeldType, WinInput } from './types'

/** 記法から個体を割り当てる小さなヘルパー（赤は "0"） */
function dealer() {
  const pool = createTileSet()
  const used = new Set<number>()
  const take = (kind: number, red: boolean): PhysicalTile => {
    const t = pool.find((x) => x.kind === kind && x.red === red && !used.has(x.id))
    if (!t) throw new Error(`牌が足りません: ${kindName(kind)}`)
    used.add(t.id)
    return t
  }
  return (notation: string) => parseHand(notation).map((h) => take(h.kind, h.red))
}

function win(
  handNotation: string,
  winNotation: string,
  opts: Partial<Omit<WinInput, 'hand' | 'winTile' | 'melds'>> & { melds?: [MeldType, string][] } = {},
) {
  const deal = dealer()
  const hand = deal(handNotation)
  const winKind = parseHand(winNotation)[0]
  const winTile = hand.find((t) => t.kind === winKind.kind && t.red === winKind.red)!
  const melds: Meld[] = (opts.melds ?? []).map(([type, n]) => ({ type, tiles: deal(n) }))
  const { melds: _ignored, ...rest } = opts
  return calculateHandValue({
    hand,
    winTile,
    melds,
    isTsumo: false,
    riichi: 'none',
    seatWind: 28,
    roundWind: 27,
    doraIndicators: [],
    ...rest,
  })
}

const ok = (r: ReturnType<typeof win>): HandValue => {
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`)
  return r
}
const ids = (r: HandValue) => r.yaku.map((y) => y.id).sort()

describe('和了判定', () => {
  it('一般形・七対子・国士', () => {
    expect(isAgari(parseCounts('123m456p789s11122z'))).toBe(true)
    expect(isAgari(parseCounts('1122m3344p5566s77z'))).toBe(true)
    expect(isAgari(parseCounts('19m19p19s12345677z'))).toBe(true)
    expect(isAgari(parseCounts('123m456p789s11123z'))).toBe(false)
  })

  it('111222333m は刻子形と順子形の2通りに分解される', () => {
    const ds = decomposeRegular(parseCounts('111222333m44455p'))
    const kinds = ds.map((d) => d.sets.map((s) => s.type).sort().join(','))
    expect(kinds).toContain('koutsu,koutsu,koutsu,koutsu')
    expect(kinds).toContain('koutsu,shuntsu,shuntsu,shuntsu')
  })

  it('待ち牌：九蓮宝燈の純正形は9面待ち', () => {
    expect(waitingKinds(parseCounts('1112345678999m'))).toHaveLength(9)
  })

  it('ドラ表示牌の巡回', () => {
    expect(doraFromIndicator(kindOf('m', 9))).toBe(kindOf('m', 1))
    expect(doraFromIndicator(kindOf('z', 4))).toBe(kindOf('z', 1)) // 北→東
    expect(doraFromIndicator(kindOf('z', 7))).toBe(kindOf('z', 5)) // 中→白
  })
})

describe('点数計算の例題', () => {
  it('子の立直・ツモ・平和・断幺九 4翻20符 = 1300/2600', () => {
    const r = ok(win('234567m234p55s678s', '8s', { isTsumo: true, riichi: 'riichi' }))
    expect(ids(r)).toEqual(['menzenTsumo', 'pinfu', 'riichi', 'tanyao'])
    expect([r.han, r.fu]).toEqual([4, 20])
    expect(r.payment).toMatchObject({ main: 2600, additional: 1300, total: 5200 })
  })

  it('平和ロンは30符：1翻30符 = 1000', () => {
    const r = ok(win('123m456p789s23455s', '2s'))
    expect(ids(r)).toEqual(['pinfu'])
    expect([r.han, r.fu, r.payment.main]).toEqual([1, 30, 1000])
  })

  it('単騎にも取れる形は、点数が高い両面（平和）の解釈を採用', () => {
    // 23444s の 4s ロン：234s+44s の両面（立直・平和 2翻30符=2000）＞ 44s 単騎（1翻40符=1300）
    const r = ok(win('123m456p789s23444s', '4s', { riichi: 'riichi' }))
    expect(r.wait).toBe('ryanmen')
    expect(ids(r)).toEqual(['pinfu', 'riichi'])
    expect(r.payment.main).toBe(2000)
  })

  it('七対子は25符：立直・七対子 3翻25符 = 3200', () => {
    const r = ok(win('1122m3344p5566s77z', '7z', { riichi: 'riichi' }))
    expect([r.han, r.fu, r.payment.main]).toEqual([3, 25, 3200])
  })

  it('親の役牌・ドラ3 満貫ロン = 12000、積み棒2本で +600', () => {
    const r = ok(win('555z234m567m888p11s', '1s', { seatWind: 27, doraIndicators: [kindOf('p', 7)], honba: 2 }))
    expect(r.level).toBe('mangan')
    expect(r.payment).toMatchObject({ main: 12000, mainBonus: 600, total: 12600 })
  })

  it('赤ドラを数える', () => {
    const r = ok(win('234067m234p55s678s', '8s', { isTsumo: true }))
    expect(r.yaku.find((y) => y.id === 'akaDora')?.han).toBe(1)
  })

  it('喰いタン（副露ありの断幺九）', () => {
    const r = ok(win('234m567p345s88s', '8s', { melds: [['chi', '678s']] }))
    expect(ids(r)).toEqual(['tanyao'])
    expect([r.han, r.fu]).toEqual([1, 30])
  })

  it('副露で役なしはエラー', () => {
    const r = win('123m567p345s88s', '8s', { melds: [['chi', '678s']], doraIndicators: [kindOf('m', 1)] })
    expect(r).toMatchObject({ ok: false, reason: 'no_yaku' })
  })

  it('大三元は役満：子のロン 32000', () => {
    const r = ok(win('555666777z123m11p', '1p', { seatWind: 28 }))
    expect(r.yakumanMultiplier).toBeGreaterThan(0)
    expect(r.payment.main).toBe(32000)
  })

  it('四暗刻単騎はダブル役満：親ツモ 32000オール', () => {
    const r = ok(win('111m222p333s444z55z', '5z', { isTsumo: true, seatWind: 27 }))
    expect(ids(r)).toEqual(['suuankouTanki'])
    expect(r.payment).toMatchObject({ main: 32000, additional: 32000, total: 96000 })
  })

  it('四暗刻のシャンポン待ちロンは三暗刻・対々和に下がる', () => {
    const r = ok(win('111m222p333s44455z', '4z', { roundWind: 28, seatWind: 29 }))
    expect(ids(r)).toEqual(['sanankou', 'toitoi'])
  })

  it('数え役満（13翻以上）', () => {
    // 立直・ツモ・清一色・平和・一盃口・断幺九 + ドラ
    const r = ok(
      win('22334455667788p', '8p', {
        isTsumo: true,
        riichi: 'riichi',
        seatWind: 28,
        doraIndicators: [kindOf('p', 1), kindOf('p', 4)],
      }),
    )
    expect(r.level).toBe('kazoeYakuman')
    expect(r.payment.main).toBe(16000)
  })
})

describe('入力チェック', () => {
  it('枚数不正・和了牌なし・不正な状況役', () => {
    const deal = dealer()
    const hand = deal('123m456p789s1122z')
    const base: WinInput = {
      hand,
      winTile: hand[0],
      melds: [],
      isTsumo: false,
      riichi: 'none',
      seatWind: 28,
      roundWind: 27,
      doraIndicators: [],
    }
    expect(calculateHandValue({ ...base, hand: hand.slice(1) })).toMatchObject({ reason: 'invalid_input' })
    expect(calculateHandValue({ ...base, winTile: createTileSet()[135] })).toMatchObject({ reason: 'invalid_input' })
    expect(calculateHandValue({ ...base, isIppatsu: true })).toMatchObject({ reason: 'invalid_input' })
    expect(calculateHandValue({ ...base, isHaitei: true })).toMatchObject({ reason: 'invalid_input' })
    expect(calculateHandValue({ ...base, isChankan: true, isTsumo: true })).toMatchObject({
      reason: 'invalid_input',
    })
  })

  it('和了形でなければ not_agari', () => {
    const r = win('123m456p789s11123z', '3z')
    expect(r).toMatchObject({ ok: false, reason: 'not_agari' })
  })
})
