/**
 * 点数計算テスト：和了の点数を4択で当てる問題を作る
 *
 * 正解は点数計算エンジン（Python mahjong と 10,000 件で照合済み）の結果。
 * 誤答の選択肢は、翻・符を少しずらした「間違えやすい」点数から選ぶ。
 * 点数は本場を含めない基本の支払い（ロン：放銃者の支払い、ツモ：子の支払い-親の支払い／親はオール）。
 */
import { createRng } from '../game/wall'
import type { HandValue } from '../rules/score'

export interface ScoreQuiz {
  answer: string
  /** 4つの選択肢（正解を含む、並びは乱数） */
  choices: string[]
}

/** 支払いの表示（ロン 7700／子のツモ 2000-3900／親のツモ 3900オール） */
export function paymentLabel(main: number, additional: number, dealer: boolean, tsumo: boolean): string {
  if (!tsumo) return `${main}`
  return dealer ? `${additional}オール` : `${additional}-${main}`
}

/** 翻・符（役満は倍数）から基本の支払いを計算する（切り上げ満貫なし・数え役満あり） */
export function basePayment(
  han: number,
  fu: number,
  dealer: boolean,
  tsumo: boolean,
  yakumanMultiplier = 0,
): { main: number; additional: number } {
  let base: number
  if (yakumanMultiplier > 0) base = 8000 * yakumanMultiplier
  else if (han >= 13) base = 8000
  else if (han >= 11) base = 6000
  else if (han >= 8) base = 4000
  else if (han >= 6) base = 3000
  else if (han >= 5) base = 2000
  else base = Math.min(2000, fu * 2 ** (han + 2))
  const up = (x: number) => Math.ceil(x / 100) * 100
  if (!tsumo) return { main: up(base * (dealer ? 6 : 4)), additional: 0 }
  const main = up(base * 2)
  return { main, additional: dealer ? main : up(base) }
}

export function makeScoreQuiz(value: HandValue, tsumo: boolean, seed: number): ScoreQuiz {
  const dealer = value.isDealer
  const label = (han: number, fu: number, mult = 0) => {
    const p = basePayment(han, fu, dealer, tsumo, mult)
    return paymentLabel(p.main, p.additional, dealer, tsumo)
  }
  const answer = paymentLabel(value.payment.main, value.payment.additional, dealer, tsumo)

  const variants: string[] = []
  if (value.yakumanMultiplier > 0) {
    const m = value.yakumanMultiplier
    variants.push(label(0, 0, m + 1), label(0, 0, Math.max(1, m - 1)), label(11, 0), label(8, 0), label(0, 0, m + 2))
  } else {
    const { han, fu } = value
    // 七対子は25符固定なので翻だけずらす
    const fus = fu === 25 ? [25] : [fu, fu - 10, fu + 10, fu + 20].filter((f) => f >= 20)
    for (const h of [han, han - 1, han + 1, han - 2, han + 2]) {
      if (h < 1) continue
      for (const f of fus) variants.push(label(h, f))
    }
    variants.push(label(han, fu === 25 ? 50 : fu * 2))
  }

  const rand = createRng(seed)
  const wrong = [...new Set(variants)].filter((v) => v !== answer)
  shuffle(wrong, rand)
  const choices = [answer, ...wrong.slice(0, 3)]
  shuffle(choices, rand)
  return { answer, choices }
}

function shuffle<T>(xs: T[], rand: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
}

/** 点数計算テストに出す「状況」の役（手牌からは分からないもの） */
export const SITUATIONAL_YAKU = new Set([
  'riichi',
  'doubleRiichi',
  'ippatsu',
  'haitei',
  'houtei',
  'rinshan',
  'chankan',
  'tenhou',
  'chiihou',
])
