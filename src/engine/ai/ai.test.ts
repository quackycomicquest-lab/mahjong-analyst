import { describe, expect, it } from 'vitest'
import { MahjongGame } from '../game/game'
import { efficiencyBot } from '../game/simpleBots'
import { playToEnd } from '../game/testUtils'
import type { Action } from '../game/types'
import type { PlayerView } from '../game/view'
import { createRng } from '../game/wall'
import { kindName, kindOf, parseHand, type PhysicalTile } from '../rules/tile'
import { makeView } from '../testing/makeView'
import { findThreats, seenCounts, tileDanger } from './danger'
import { createAiBot, decide } from './player'
import { DEFAULT_OPPONENTS, makeProfile } from './profile'

const discardedKind = (view: PlayerView, a: Action) =>
  a.type === 'discard' ? kindName(view.hand.find((t) => t.id === a.tileId)!.kind) : a.type

const rand = createRng(1)
const speed = makeProfile('speed', 2)
const defense = makeProfile('defense', 2)
const value = makeProfile('value', 2)

// ---------------------------------------------------------------------------

describe('危険度の推定', () => {
  const view = makeView({ hand: '123m456p789s1122z', rivers: { 2: ['1z', '4m', '6p*'] } })
  const seen = seenCounts(view)
  const [threat] = findThreats(view)

  it('立直者を脅威として検出し、現物は0', () => {
    expect(threat.seat).toBe(2)
    expect(tileDanger(kindOf('m', 4), threat, seen, 2)).toBe(0)
  })

  it('スジは無スジより安全、中張の無スジが最も危険', () => {
    const d = (n: string) => tileDanger(parseHand(n)[0].kind, threat, seen, 2)
    expect(d('1m')).toBeLessThan(d('2m')) // 1m は 4m のスジ
    expect(d('7m')).toBeLessThan(d('5s'))
    expect(d('3p')).toBeLessThan(d('5s')) // 3p は 6p のスジ
    expect(d('5s')).toBeGreaterThan(5) // 中張の無スジは高い
  })

  it('初級は現物しか区別しない', () => {
    const lv1 = (n: string) => tileDanger(parseHand(n)[0].kind, threat, seen, 1)
    expect(lv1('1m')).toBe(lv1('5s'))
    expect(lv1('4m')).toBe(0)
  })
})

describe('押し引き', () => {
  // 搭子4つ＋孤立牌6枚の4向聴。5m は立直者の現物（切ると5向聴に戻る）
  const hand = '45m79m24p68p159s136z'

  it('脅威がなければ孤立牌から切る', () => {
    const view = makeView({ hand })
    const d = decide(view, defense, rand)
    expect(['1索', '5索', '9索', '東', '西', '發']).toContain(discardedKind(view, d.action))
  })

  it('他家の立直に対して、遠い手なら現物を切って降りる', () => {
    // ドラ表示牌を東以外にして、字牌も1枚しか見えていない（危険度が十分ある）状態にする
    const view = makeView({ hand, rivers: { 2: ['2z', '5m*'] }, dora: '9p' })
    const d = decide(view, defense, rand)
    expect(discardedKind(view, d.action)).toBe('5萬')
  })

  it('聴牌していれば無スジでも押す（聴牌を崩さない）', () => {
    // 123456789m 346p 55s → 3p か 6p を切れば聴牌維持
    const view = makeView({ hand: '123456789m3455s6p', rivers: { 2: ['2z', '1z*'] } })
    for (const profile of [speed, value]) {
      const d = decide(view, profile, rand)
      expect(['3筒', '6筒']).toContain(discardedKind(view, d.action))
    }
  })
})

describe('立直判断', () => {
  it('役なし聴牌は立直する', () => {
    // 123m 456p 789s 24s 99m + 1z → 1z切りで3s嵌張（役なし）
    const view = makeView({ hand: '123m456p789s24s99m1z', riichiAllowed: true })
    const d = decide(view, defense, rand)
    expect(d.action).toMatchObject({ type: 'discard', riichi: true })
    expect(discardedKind(view, d.action)).toBe('東')
  })

  it('役ありで満貫以上ならダマ', () => {
    // 白暗刻・赤5p・ドラ2m・ドラ7s → ダマで満貫
    const view = makeView({ hand: '555z234m067p78s99s1z', riichiAllowed: true, dora: '1m6s' })
    const d = decide(view, makeProfile('value', 3), rand)
    expect(d.action).toMatchObject({ type: 'discard' })
    expect((d.action as { riichi?: boolean }).riichi).toBeFalsy()
    expect(discardedKind(view, d.action)).toBe('東')
  })
})

describe('鳴き判断', () => {
  const ponOf = (tile: PhysicalTile, hand: PhysicalTile[]): Action[] => {
    const same = hand.filter((t) => t.kind === tile.kind)
    return [{ type: 'pon', seat: 0, tileIds: [same[0].id, same[1].id] }]
  }

  it('速攻型は役牌をポンする', () => {
    const view = makeView({ hand: '66z234m57p13s689s9m', response: { from: 3, tile: '6z', actions: ponOf } })
    expect(decide(view, speed, rand).action.type).toBe('pon')
  })

  it('役が無くなるチーはしない（中級以上）', () => {
    // 么九牌が多く、断幺九・役牌・染め手のどれにもならない
    const view = makeView({
      hand: '13m79p19s123z45s67s',
      response: {
        from: 3,
        tile: '2m',
        actions: (_tile, hand) => {
          const a = hand.find((t) => t.kind === kindOf('m', 1))!
          const b = hand.find((t) => t.kind === kindOf('m', 3))!
          return [{ type: 'chi', seat: 0, tileIds: [a.id, b.id] }]
        },
      },
    })
    expect(decide(view, speed, rand).action.type).toBe('pass')
  })
})

describe('AI同士の対局', () => {
  it('既定の3人＋牌効率ボットで東南戦3局を最後まで打てる（合法手のみ）', { timeout: 120000 }, () => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = createRng(seed)
      const [a, b, c] = DEFAULT_OPPONENTS
      const game = new MahjongGame({ seed })
      playToEnd(game, { 0: efficiencyBot, 1: createAiBot(a, r), 2: createAiBot(b, r), 3: createAiBot(c, r) })
      expect(game.phase.type).toBe('gameEnd')
    }
  })

  it('強さ1〜3のすべてで最後まで打てる', { timeout: 120000 }, () => {
    const r = createRng(9)
    const game = new MahjongGame({ seed: 9, config: { length: 'tonpuu' } })
    playToEnd(game, {
      0: createAiBot(makeProfile('speed', 1), r),
      1: createAiBot(makeProfile('defense', 2), r),
      2: createAiBot(makeProfile('value', 3), r),
      3: createAiBot(makeProfile('speed', 3), r),
    })
    expect(game.phase.type).toBe('gameEnd')
  })
})
