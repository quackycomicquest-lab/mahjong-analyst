import { describe, expect, it } from 'vitest'
import { MahjongGame } from '../game/game'
import { efficiencyBot } from '../game/simpleBots'
import type { Action } from '../game/types'
import { getPlayerView, type PlayerView } from '../game/view'
import { kindName, parseHand } from '../rules/tile'
import { makeView } from '../testing/makeView'
import { evaluateDecision, furitenWaits } from './evaluate'

const discard = (view: PlayerView, notation: string, riichi = false): Action => {
  const k = parseHand(notation)[0].kind
  const a = view.legalActions.find(
    (x) => x.type === 'discard' && view.hand.find((t) => t.id === x.tileId)!.kind === k && !!x.riichi === riichi,
  )
  if (!a) throw new Error(`${notation} を切る行動がありません`)
  return a
}
const opts = { mode: 'full' as const, seed: 1 }

describe('打牌評価', () => {
  // 仕様 §3-1 の例：1萬〜6萬 2筒〜5筒 7索 8索 東 東（実際の対局と同じく立直も選べる局面）
  const spec31 = makeView({ hand: '123456m2345p78s11z', riichiAllowed: true })

  it('仕様§3-1の例：東切りは聴牌を逃すので大きく減点、最善は2筒か5筒切り立直', () => {
    const e = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    expect(e.status).toBe('ok')
    expect(['2筒（立直）', '5筒（立直）']).toContain(e.best!.label)
    expect(e.score!).toBeLessThan(60)
    expect(e.loss!).toBeGreaterThan(0)
    expect(e.improve.join()).toContain('向聴数が戻る')
  })

  it('最善手を選べば100点・損失0', () => {
    const e = evaluateDecision(spec31, discard(spec31, '2p', true), opts)
    expect(e.score).toBe(100)
    expect(e.loss).toBe(0)
    expect(e.good.join()).toContain('最善手')
  })

  it('全候補を同じ局面で評価し、期待値の高い順に並べる', () => {
    const e = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    const kinds = new Set(spec31.hand.map((t) => kindName(t.kind)))
    expect([...new Set(e.candidates.map((c) => c.label.replace('（立直）', '')))].sort()).toEqual([...kinds].sort())
    for (let i = 1; i < e.candidates.length; i++) {
      expect(e.candidates[i - 1].ev).toBeGreaterThanOrEqual(e.candidates[i].ev)
    }
    // レベル2の項目
    const best = e.best!
    expect(best.shanten).toBe(0)
    expect(best.effectiveKinds.map(kindName).sort()).toEqual(['6索', '9索'])
    expect(best.winRate).toBeGreaterThan(0.1)
  })

  it('序盤でも両面を崩す打牌は減点される', () => {
    const view = makeView({ hand: '23m456p789s1357z36s' })
    const e = evaluateDecision(view, discard(view, '2m'), opts)
    expect(e.score!).toBeLessThan(80)
    expect(e.best!.shanten).toBeLessThan(e.chosen!.shanten)
  })

  it('立直者に対して遠い手なら現物で降りるのが最善（暫定評価）', () => {
    const view = makeView({ hand: '45m79m24p68p159s136z', rivers: { 2: ['2z', '5m*'] }, dora: '9p' })
    const e = evaluateDecision(view, discard(view, '1s'), opts)
    expect(e.status).toBe('provisional')
    expect(e.best!.label).toBe('5萬')
    expect(e.best!.immediateDealIn).toBe(0)
    expect(e.analysis.stance).toBe('fold')
    expect(e.analysis.threats).toEqual([{ seat: 2, riichi: true, weight: 1 }])
    expect(e.improve.join()).toContain('危険な牌')
  })

  it('役なしの両面聴牌は立直が最善', () => {
    const view = makeView({ hand: '123m456p999m23s55s1z', riichiAllowed: true })
    const e = evaluateDecision(view, discard(view, '1z'), opts)
    expect(e.best!.label).toBe('東（立直）')
    expect(e.chosen!.riichi).toBe(false)
    expect(e.improve.join()).toContain('立直の方が期待値')
  })

  it('打牌以外は評価不能として点数を出さない', () => {
    const e = evaluateDecision(spec31, { type: 'tsumo', seat: 0 }, opts)
    expect(e.status).toBe('unavailable')
    expect(e.score).toBeNull()
  })

  it('同じ局面・同じ seed なら同じ結果', () => {
    const a = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    const b = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 })
  })

  it('軽量モードは試行回数が少なく速いが、最善手の判断は同じ', () => {
    const full = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    const light = evaluateDecision(spec31, discard(spec31, '1z'), { mode: 'light', seed: 1 })
    expect(light.simulations).toBeLessThan(full.simulations)
    expect(['2筒（立直）', '5筒（立直）']).toContain(light.best!.label)
    expect(light.confidence).toBeLessThanOrEqual(full.confidence)
  })
})

describe('対局中の評価', () => {
  it('実際の対局で席0の打牌を毎回評価できる（牌効率ボットの打牌は高評価）', { timeout: 120000 }, () => {
    const scores: number[] = []
    for (const seed of [1, 2]) {
      const game = new MahjongGame({ seed })
      let evaluated = 0
      while (game.phase.type !== 'gameEnd' && evaluated < 15) {
        if (game.phase.type === 'roundEnd') {
          game.apply({ type: 'nextRound' })
          continue
        }
        const seat = game.pendingSeats()[0]
        const view = getPlayerView(game, seat)
        const action = efficiencyBot(view)
        if (seat === 0 && action.type === 'discard') {
          // 打牌確定時点のスナップショットで評価（仕様 §3-1）
          const e = evaluateDecision(view, action, { mode: 'light' })
          expect(['ok', 'provisional']).toContain(e.status)
          expect(e.decisionId).toBe(view.decisionId)
          scores.push(e.score!)
          evaluated++
        }
        game.apply(action)
      }
    }
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    expect(scores.length).toBeGreaterThan(20)
    expect(avg).toBeGreaterThan(70)
  })
})

describe('鳴き・和了・九種九牌・立直判断の評価', () => {
  const ponOf = (tile: { kind: number }, hand: { id: number; kind: number }[]): Action[] => {
    const same = hand.filter((t) => t.kind === tile.kind)
    return [{ type: 'pon', seat: 0, tileIds: [same[0].id, same[1].id] }]
  }

  it('ロンを見逃すと大きく減点され、ロンは満点', () => {
    // 123456789m 34p 55s で 2p ロン（平和・一気通貫）
    const view = makeView({
      hand: '123456789m34p55s',
      response: { from: 3, tile: '2p', actions: () => [{ type: 'ron', seat: 0 }] },
    })
    const ron = evaluateDecision(view, { type: 'ron', seat: 0 }, opts)
    expect(ron.decision).toBe('win')
    expect(ron.score).toBe(100)
    expect(ron.good.join()).toContain('和了')
    const skip = evaluateDecision(view, { type: 'pass', seat: 0 }, opts)
    expect(skip.best!.label).toMatch(/^ロン/)
    expect(skip.score!).toBeLessThan(50)
    expect(skip.improve.join()).toContain('見逃す')
  })

  it('門前で立直を狙える一向聴なら、役のなくなるチーより鳴かない方が良い（序盤）', () => {
    // 13m 456p 789p 23s 99s 東：2萬をチーすると役なしの形式聴牌、鳴かなければ立直を狙える
    const view = makeView({
      hand: '13m456p789p23s99s1z',
      wallRemaining: 50,
      response: {
        from: 3,
        tile: '2m',
        actions: (_t, hand) => {
          const a = hand.find((t) => t.kind === 0)!
          const b = hand.find((t) => t.kind === 2)!
          return [{ type: 'chi', seat: 0, tileIds: [a.id, b.id] }]
        },
      },
    })
    const chi = view.legalActions.find((a) => a.type === 'chi')!
    const e = evaluateDecision(view, chi, opts)
    expect(e.decision).toBe('call')
    expect(e.best!.label).toBe('スキップ')
    expect(e.chosen!.label).toMatch(/^チー/)
    expect(e.score!).toBeLessThan(100)
  })

  it('役のない仕掛け（形式聴牌）は、山が残っているうちは鳴かない方が良い', () => {
    // 北家・東場で南は役牌でない。2索をポンして4索を切ると聴牌だが役がなく、ロンもツモもできない
    const view = makeView({
      hand: '789m222p22s468s22z',
      wallRemaining: 47,
      dora: '2z',
      response: {
        from: 3,
        tile: '2s',
        actions: (_t, hand) => {
          const ids = hand.filter((t) => t.kind === parseHand('2s')[0].kind).map((t) => t.id)
          return [{ type: 'pon', seat: 0, tileIds: [ids[0], ids[1]] }]
        },
      },
    })
    view.round = { ...view.round, wind: 27, dealer: 1 }
    const e = evaluateDecision(view, { type: 'pass', seat: 0 }, opts)
    expect(e.best!.label).toBe('スキップ')
    const pon = e.candidates.find((c) => c.label.startsWith('ポン'))!
    expect(pon.winRate).toBe(0)
  })

  it('立直2人に対して、4枚目の字牌（完全な安全牌）を切る判断は高く評価される', () => {
    // 南：手に1枚・河に2枚・ドラ表示牌に1枚。他の牌はどれも2人のどちらかに通っていない
    const view = makeView({
      hand: '789m222p5p22s456s8s2z',
      wallRemaining: 34,
      dora: '2z',
      rivers: { 2: ['2z', '1z', '3z', '9p*'], 3: ['2z', '4z', '1p', '9s*'] },
    })
    const e = evaluateDecision(view, discard(view, '2z'), opts)
    expect(e.chosen!.immediateDealIn).toBe(0)
    expect(e.score!).toBeGreaterThanOrEqual(80)
  })

  it('役牌の対子をポンする判断を評価できる（鳴いた後の打牌まで含めて比較）', () => {
    const view = makeView({ hand: '55z234m57p13s689s9m', response: { from: 3, tile: '5z', actions: ponOf } })
    const pon = view.legalActions.find((a) => a.type === 'pon')!
    const e = evaluateDecision(view, pon, opts)
    expect(e.status).not.toBe('unavailable')
    const labels = e.candidates.map((c) => c.label)
    expect(labels).toContain('スキップ')
    expect(labels.some((l) => /^ポン（白白＋白） → .+切り$/.test(l))).toBe(true)
  })

  it('九種九牌も評価できる', () => {
    const view = makeView({ hand: '19m19p19s1234z258m6z' })
    view.legalActions = [...view.legalActions, { type: 'kyuushu', seat: 0 }]
    const e = evaluateDecision(view, { type: 'kyuushu', seat: 0 }, opts)
    expect(e.decision).toBe('kyuushu')
    expect(e.score).not.toBeNull()
    expect(e.candidates.some((c) => c.label === '九種九牌（流局）')).toBe(true)
  })

  it('立直判断の欄：同じ牌で立直とダマを比べる', () => {
    const view = makeView({ hand: '123m456p999m23s55s1z', riichiAllowed: true })
    const e = evaluateDecision(view, discard(view, '1z', true), opts)
    expect(e.analysis.riichi).toMatchObject({ tile: '東', recommended: 'riichi', chosen: 'riichi' })
    expect(e.good.join()).toContain('立直判断は適切')
  })

  it('将来の待ちが自分の河にあると、その聴牌はロンできず和了率が大きく下がる（フリテン）', () => {
    const k = parseHand('1z')[0].kind
    const clean = makeView({ hand: '123m567p678s34s99p1z', rivers: { 0: ['9m'] } })
    const furiten = makeView({ hand: '123m567p678s34s99p1z', rivers: { 0: ['2s'] } })
    expect(furitenWaits(clean, k)).toEqual([])
    expect(furitenWaits(furiten, k).map(kindName)).toEqual(['2索'])
    const a = evaluateDecision(clean, discard(clean, '1z'), opts).candidates.find((c) => c.label === '東')!
    const b = evaluateDecision(furiten, discard(furiten, '1z'), opts).candidates.find((c) => c.label === '東')!
    expect(b.winRate).toBeLessThan(a.winRate * 0.6)
  })
})
