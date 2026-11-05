/**
 * 判断の分類（仕様 §7-2 弱点の分類、§4-1 ④ Mahjong Coach）
 *
 * 保存した評価結果と局面スナップショットから、判断を 8 つの分類のどれかに振り分ける。
 * 振り分けは評価に残っている情報（脅威の有無・押し引きの推奨・立直判断・打点の差など）だけで行う。
 */
import type { Evaluation } from '../evaluator/types'
import type { PlayerView } from '../game/view'

export const CATEGORIES = [
  '牌効率',
  '打点構築',
  'リーチ判断',
  '押し引き',
  'ベタオリ',
  '安全牌選択',
  '鳴き判断',
  'オーラスの順位判断',
] as const

export type Category = (typeof CATEGORIES)[number] | 'その他'

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  牌効率: '脅威がない局面で、向聴数・受け入れを進める打牌',
  打点構築: '同じ速さの候補の中で、和了時の打点に差が出る打牌',
  リーチ判断: '同じ牌で立直とダマを選べた打牌',
  押し引き: '他家の立直・仕掛けに対して、押すのが正しい局面',
  ベタオリ: '他家の立直・仕掛けに対して、降りるのが正しい局面での押すか降りるか',
  安全牌選択: '降りる局面で、どの安全な牌を切るか',
  鳴き判断: 'ポン・チー・カン・スキップの判断',
  オーラスの順位判断: 'オーラス（最終局）の判断（順位期待値は未対応のため、収支の期待値で評価）',
  その他: '和了・カン・九種九牌などの判断',
}

/** オーラス（最終局。延長戦を含む）か */
export function isAllLast(view: PlayerView, length: 'tonpuu' | 'hanchan'): boolean {
  const lastWind = length === 'tonpuu' ? 27 : 28
  return view.round.wind > lastWind || (view.round.wind === lastWind && view.round.dealer === 3)
}

export function classifyDecision(ev: Evaluation, view: PlayerView, length: 'tonpuu' | 'hanchan'): Category {
  const decision = ev.decision ?? 'discard'
  if (decision === 'call') return '鳴き判断'
  if (decision !== 'discard') return 'その他'
  if (isAllLast(view, length)) return 'オーラスの順位判断'
  if (ev.analysis.riichi) return 'リーチ判断'

  const chosen = ev.chosen
  const best = ev.best
  if (!chosen || !best) return '牌効率'

  if (ev.analysis.threats.length > 0) {
    if (ev.analysis.stance !== 'fold') return '押し引き'
    // 降りるのが正しい局面：自分も安全な牌を選んでいれば「どの安全牌を切るか」、危険な牌を切っていれば「降りられたか」
    const safest = ev.analysis.safest?.immediateDealIn ?? 0
    const chosenFolds = chosen.immediateDealIn <= safest + 0.01
    return chosenFolds ? '安全牌選択' : 'ベタオリ'
  }

  // 同じ向聴数の候補の中で打点に3割以上の差があれば、打点構築の判断
  const same = ev.candidates.filter((c) => c.shanten === best.shanten && c.winValue > 0)
  if (same.length >= 2) {
    const values = same.map((c) => c.winValue)
    if (Math.max(...values) > Math.min(...values) * 1.3) return '打点構築'
  }
  return '牌効率'
}
