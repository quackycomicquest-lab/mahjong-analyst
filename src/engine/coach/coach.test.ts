import { describe, expect, it } from 'vitest'
import { evaluateDecision } from '../evaluator/evaluate'
import type { Action } from '../game/types'
import type { PlayerView } from '../game/view'
import { parseHand } from '../rules/tile'
import { makeView } from '../testing/makeView'
import { abilities, categoryStats, filterByRecentGames, weakestCategory, type ScoredDecision } from './abilities'
import { classifyDecision, isAllLast } from './classify'
import { enroll, isDue, isMastered, pickPractice, pickSession, schedule } from './review'

const discard = (view: PlayerView, n: string, riichi = false): Action =>
  view.legalActions.find(
    (x) => x.type === 'discard' && view.hand.find((t) => t.id === x.tileId)!.kind === parseHand(n)[0].kind && !!x.riichi === riichi,
  )!
const opts = { mode: 'light' as const, seed: 1 }

describe('判断の分類', () => {
  it('脅威のない打牌は牌効率', () => {
    const v = makeView({ hand: '23m456p789s1357z36s' })
    expect(classifyDecision(evaluateDecision(v, discard(v, '1z'), opts), v, 'hanchan')).toBe('牌効率')
  })

  it('立直とダマを選べた打牌はリーチ判断', () => {
    const v = makeView({ hand: '123m456p999m23s55s1z', riichiAllowed: true })
    expect(classifyDecision(evaluateDecision(v, discard(v, '1z', true), opts), v, 'hanchan')).toBe('リーチ判断')
  })

  it('立直者に対して遠い手：現物を切れば安全牌選択、押せばベタオリ', () => {
    const v = makeView({ hand: '45m79m24p68p159s136z', rivers: { 2: ['2z', '5m*'] }, dora: '9p' })
    expect(classifyDecision(evaluateDecision(v, discard(v, '5m'), opts), v, 'hanchan')).toBe('安全牌選択')
    const pushed = evaluateDecision(v, discard(v, '4p'), opts)
    expect(pushed.analysis.stance).toBe('fold')
    expect(classifyDecision(pushed, v, 'hanchan')).toBe('ベタオリ')
  })

  it('鳴きの判断は鳴き判断、オーラスはオーラスの順位判断', () => {
    const call = makeView({
      hand: '55z234m57p13s689s9m',
      response: { from: 3, tile: '5z', actions: () => [] },
    })
    const ev = evaluateDecision(call, { type: 'pass', seat: 0 }, opts)
    expect(classifyDecision(ev, call, 'hanchan')).toBe('鳴き判断')

    const last = makeView({ hand: '23m456p789s1357z36s' })
    last.round = { ...last.round, wind: 28, dealer: 3 }
    expect(isAllLast(last, 'hanchan')).toBe(true)
    expect(isAllLast(last, 'tonpuu')).toBe(true) // 東風戦の南入（延長）もオーラス扱い
    expect(classifyDecision(evaluateDecision(last, discard(last, '1z'), opts), last, 'hanchan')).toBe('オーラスの順位判断')
  })
})

describe('能力値と期間', () => {
  const d = (gameId: string, category: ScoredDecision['category'], score: number, loss: number): ScoredDecision => ({
    gameId,
    category,
    score,
    loss,
  })
  const decisions = [
    ...Array.from({ length: 6 }, () => d('g1', '牌効率', 90, 50)),
    ...Array.from({ length: 6 }, () => d('g2', '牌効率', 50, 400)),
    ...Array.from({ length: 5 }, () => d('g2', 'ベタオリ', 30, 900)),
    d('g2', '押し引き', 60, 200),
  ]

  it('分類ごとの平均点・判断損失・要復習数', () => {
    const s = categoryStats(decisions).find((x) => x.category === '牌効率')!
    expect(s.count).toBe(12)
    expect(s.averageScore).toBe(70)
    expect(s.mistakes).toBe(6)
  })

  it('能力値は判断が5未満なら出さない', () => {
    const a = abilities(decisions)
    expect(a.find((x) => x.name === '牌効率能力')!.value).toBe(70)
    expect(a.find((x) => x.name === '守備判断能力')!.value).toBe(30)
    expect(a.find((x) => x.name === '押し引き能力')!.value).toBeNull()
  })

  it('直近N半荘で絞り込み、重点課題は判断損失の大きい分類', () => {
    const recent = filterByRecentGames(decisions, ['g1', 'g2'], 1)
    expect(recent.every((x) => x.gameId === 'g1')).toBe(true)
    expect(weakestCategory(categoryStats(decisions))!.category).toBe('ベタオリ')
  })
})

describe('復習の出題間隔', () => {
  const now = new Date('2026-11-06T10:00:00Z')
  const item = enroll('g', 3, '牌効率', 40, now)

  it('登録した問題はすぐ出題される', () => {
    expect(isDue(item, now)).toBe(true)
    expect(pickSession([item], now, 10)).toHaveLength(1)
  })

  it('正解すると 1日 → 3日 → 8日 … と間隔が伸び、30日以上で身についた扱い', () => {
    let x = schedule(item, 95, now)
    expect(x.intervalDays).toBe(1)
    expect(isDue(x, now)).toBe(false)
    x = schedule(x, 95, now)
    expect(x.intervalDays).toBe(3)
    x = schedule(x, 95, now)
    expect(x.intervalDays).toBe(8)
    x = schedule(schedule(x, 95, now), 95, now)
    expect(isMastered(x)).toBe(true)
    expect(pickSession([x], new Date('2027-12-01'), 10)).toHaveLength(0)
  })

  it('間違えると10分後にもう一度、まずまずなら少しだけ伸びる', () => {
    const wrong = schedule(schedule(item, 95, now), 40, now)
    expect(wrong.reps).toBe(0)
    expect(wrong.lapses).toBe(1)
    expect(new Date(wrong.dueAt).getTime() - now.getTime()).toBe(10 * 60 * 1000)
    const ok = schedule(item, 80, now)
    expect(ok.intervalDays).toBe(1)
  })

  it('重点練習は期限に関係なく、その分類の苦手な問題から', () => {
    const a = { ...enroll('g', 1, 'ベタオリ', 20, now), dueAt: '2099-01-01T00:00:00Z' }
    const b = { ...enroll('g', 2, 'ベタオリ', 60, now), dueAt: '2099-01-01T00:00:00Z' }
    const c = enroll('g', 4, '牌効率', 10, now)
    expect(pickPractice([b, c, a], 'ベタオリ', 10).map((x) => x.decisionId)).toEqual([1, 2])
  })
})
