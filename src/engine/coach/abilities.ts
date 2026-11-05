/**
 * 分類ごとの成績と 5 つの能力値（仕様 §7-1, §7-2、追加提案の 5 能力値）
 *
 * AI との一致率ではなく、評価点（期待値の差から換算）と判断損失で測る（仕様 §7-1）。
 */
import { CATEGORIES, type Category } from './classify'

export interface ScoredDecision {
  gameId: string
  category: Category
  score: number
  /** 判断損失（点） */
  loss: number
}

export interface CategoryStat {
  category: Category
  count: number
  averageScore: number | null
  averageLoss: number | null
  /** 70点未満の判断の数 */
  mistakes: number
}

export interface Ability {
  name: string
  categories: Category[]
  count: number
  /** 0〜100。判断が少ない（5 未満）なら null */
  value: number | null
}

export const ABILITIES: { name: string; categories: Category[] }[] = [
  { name: '牌効率能力', categories: ['牌効率'] },
  { name: '攻撃判断能力', categories: ['打点構築', 'リーチ判断', '鳴き判断'] },
  { name: '守備判断能力', categories: ['ベタオリ', '安全牌選択'] },
  { name: '押し引き能力', categories: ['押し引き'] },
  { name: '順位戦略能力', categories: ['オーラスの順位判断'] },
]

export const MISTAKE_THRESHOLD = 70
const MIN_ABILITY_SAMPLES = 5

export function categoryStats(decisions: ScoredDecision[]): CategoryStat[] {
  return [...CATEGORIES, 'その他' as const].map((category) => {
    const ds = decisions.filter((d) => d.category === category)
    return {
      category,
      count: ds.length,
      averageScore: ds.length ? avg(ds.map((d) => d.score)) : null,
      averageLoss: ds.length ? avg(ds.map((d) => d.loss)) : null,
      mistakes: ds.filter((d) => d.score < MISTAKE_THRESHOLD).length,
    }
  })
}

export function abilities(decisions: ScoredDecision[]): Ability[] {
  return ABILITIES.map((a) => {
    const ds = decisions.filter((d) => a.categories.includes(d.category))
    return {
      ...a,
      count: ds.length,
      value: ds.length >= MIN_ABILITY_SAMPLES ? Math.round(avg(ds.map((d) => d.score)) * 10) / 10 : null,
    }
  })
}

/**
 * 期間で絞り込む（直近 N 半荘）。gamesNewestFirst は新しい順の対局ID。
 * n が null なら累計。
 */
export function filterByRecentGames(decisions: ScoredDecision[], gamesNewestFirst: string[], n: number | null): ScoredDecision[] {
  if (n === null) return decisions
  const ids = new Set(gamesNewestFirst.slice(0, n))
  return decisions.filter((d) => ids.has(d.gameId))
}

/** 重点課題：判断が十分にある分類のうち、平均判断損失が最も大きいもの */
export function weakestCategory(stats: CategoryStat[], minCount = 5): CategoryStat | null {
  const ok = stats.filter((s) => s.category !== 'その他' && s.count >= minCount && s.averageLoss !== null)
  if (ok.length === 0) return null
  return ok.reduce((a, b) => (b.averageLoss! > a.averageLoss! ? b : a))
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
