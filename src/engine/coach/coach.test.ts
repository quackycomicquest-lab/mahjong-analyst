import { describe, expect, it } from 'vitest'
import { evaluateDecision } from '../evaluator/evaluate'
import type { Action } from '../game/types'
import type { PlayerView } from '../game/view'
import { parseHand } from '../rules/tile'
import { makeView } from '../testing/makeView'
import { abilities, categoryStats, filterByRecentGames, weakestCategory, type ScoredDecision } from './abilities'
import { classifyDecision, isAllLast } from './classify'
import { enroll, isDue, isMastered, pickPractice, pickSession, schedule } from './review'
import { actualCellId, allCells, answerLabel, basePayment, paymentLabel, scoreTable, scoreTableFor } from './scoreQuiz'
import { summarizeVerification } from './flags'
import type { HandValue } from '../rules/score'

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

describe('点数計算テスト', () => {
  it('支払いの表示：ロン・子のツモ・親のツモ', () => {
    expect(paymentLabel(7700, 0, false, false)).toBe('7700')
    expect(paymentLabel(3900, 2000, false, true)).toBe('2000-3900')
    expect(paymentLabel(3900, 3900, true, true)).toBe('3900オール')
  })

  it('翻・符からの支払い計算は点数計算エンジンと一致する', () => {
    expect(basePayment(3, 30, false, false)).toEqual({ main: 3900, additional: 0 })
    expect(basePayment(4, 30, false, true)).toEqual({ main: 3900, additional: 2000 })
    expect(basePayment(1, 30, true, false)).toEqual({ main: 1500, additional: 0 })
    expect(basePayment(5, 30, true, true)).toEqual({ main: 4000, additional: 4000 })
    expect(basePayment(0, 0, false, false, 2)).toEqual({ main: 64000, additional: 0 })
  })

  it('点数表：子のロン・子のツモ・親のツモのマス', () => {
    const cell = (t: ReturnType<typeof scoreTable>, id: string) => allCells(t).find((c) => c.id === id)!
    const ron = scoreTable(false, false)
    expect(cell(ron, '30-4').label).toBe('7700')
    expect(cell(ron, '60-3').label).toBe('7700')
    expect(cell(ron, '40-4')).toMatchObject({ label: '8000', limit: '満貫' })
    expect(cell(ron, '30-4').limit).toBeNull()
    expect(cell(ron, 'limit-6').label).toBe('12000')
    expect(cell(ron, 'yakuman-2').label).toBe('64000')
    // ロンの20符、1翻の25符はありえない
    expect(cell(ron, '20-2').valid).toBe(false)
    expect(cell(ron, '25-1').valid).toBe(false)
    expect(cell(ron, '25-2')).toMatchObject({ valid: true, label: '1600' })
    const tsumo = scoreTable(false, true)
    expect(cell(tsumo, '20-2')).toMatchObject({ valid: true, label: '400-700' })
    expect(cell(tsumo, '20-1').valid).toBe(false)
    expect(cell(tsumo, '25-2').valid).toBe(false)
    expect(cell(scoreTable(true, true), '30-3').label).toBe('2000オール')
  })

  it('実際の和了のマスが正解の点数になる', () => {
    const value = {
      han: 3,
      fu: 30,
      isDealer: false,
      yakumanMultiplier: 0,
      payment: { main: 3900, additional: 0 },
    } as unknown as HandValue
    const t = scoreTableFor(value, false)
    expect(actualCellId(value)).toBe('30-3')
    expect(allCells(t).find((c) => c.id === actualCellId(value))!.label).toBe(answerLabel(value, false))
    // 110符を超える和了は行を足す
    expect(scoreTable(false, false, 130).fuRows.at(-1)).toBe(130)
  })
})

describe('要検証の再評価', () => {
  const v = (scores: number[], bestLabels: string[]) => ({
    at: '',
    engineVersion: 'x',
    simulations: 1200,
    scores,
    bestLabels,
    losses: scores.map(() => 0),
  })
  it('再評価しても点数と最善手が同じなら stable', () => {
    expect(summarizeVerification(50, '1索', v([48, 52, 55], ['1索', '1索', '1索']))).toMatchObject({ verdict: 'stable', min: 48, max: 55 })
  })
  it('回ごとの点数のばらつきや元の点数とのずれが大きければ noisy', () => {
    expect(summarizeVerification(50, '1索', v([60, 90, 75], ['1索', '1索', '1索'])).verdict).toBe('noisy')
    expect(summarizeVerification(40, '1索', v([80, 82, 85], ['1索', '1索', '1索'])).verdict).toBe('noisy')
  })
  it('最善手が変われば bestChanged', () => {
    expect(summarizeVerification(50, '1索', v([50, 50, 50], ['1索', '2筒', '1索'])).verdict).toBe('bestChanged')
  })
})
