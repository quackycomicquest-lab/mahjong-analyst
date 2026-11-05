import { describe, expect, it } from 'vitest'
import { MahjongGame } from '../game/game'
import { efficiencyBot } from '../game/simpleBots'
import type { Action } from '../game/types'
import { getPlayerView, type PlayerView } from '../game/view'
import { kindName, parseHand } from '../rules/tile'
import { makeView } from '../testing/makeView'
import { evaluateDecision } from './evaluate'

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
  // 仕様 §3-1 の例：1萬〜6萬 2筒〜5筒 7索 8索 東 東
  const spec31 = makeView({ hand: '123456m2345p78s11z' })

  it('仕様§3-1の例：東切りは聴牌を逃すので大きく減点、最善は2筒か5筒', () => {
    const e = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    expect(e.status).toBe('ok')
    expect(['2筒', '5筒']).toContain(e.best!.label)
    expect(e.score!).toBeLessThan(60)
    expect(e.loss!).toBeGreaterThan(0)
    expect(e.improve.join()).toContain('向聴数が戻る')
  })

  it('最善手を選べば100点・損失0', () => {
    const e = evaluateDecision(spec31, discard(spec31, '2p'), opts)
    expect(e.score).toBe(100)
    expect(e.loss).toBe(0)
    expect(e.good.join()).toContain('最善手')
  })

  it('全候補を同じ局面で評価し、期待値の高い順に並べる', () => {
    const e = evaluateDecision(spec31, discard(spec31, '1z'), opts)
    const kinds = new Set(spec31.hand.map((t) => kindName(t.kind)))
    expect(e.candidates.map((c) => c.label).sort()).toEqual([...kinds].sort())
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
    expect(e.score!).toBeLessThan(70)
    expect(e.best!.shanten).toBeLessThan(e.chosen!.shanten)
  })

  it('立直者に対して遠い手なら現物で降りるのが最善（暫定評価）', () => {
    const view = makeView({ hand: '45m79m24p68p159s136z', rivers: { 2: ['2z', '5m*'] } })
    const e = evaluateDecision(view, discard(view, '1z'), opts)
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
    expect(['2筒', '5筒']).toContain(light.best!.label)
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
