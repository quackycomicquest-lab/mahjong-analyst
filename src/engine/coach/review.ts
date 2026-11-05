/**
 * 復習問題の出題間隔（仕様 §7-3：以前間違えた局面を一定期間後に再出題する）
 *
 * - 70点未満だった判断を復習問題にする（すぐ出題）
 * - 解いた結果で次の出題日を決める
 *   90点以上：1日 → 3日 → 前回の2.5倍…（30日以上空いたら「身についた」）
 *   70〜89点：前回の1.2倍（最低1日）
 *   70点未満：10分後にもう一度
 */
import type { Category } from './classify'

export interface ReviewItem {
  gameId: string
  decisionId: number
  category: Category
  /** 元の対局での評価点 */
  originalScore: number
  addedAt: string
  dueAt: string
  intervalDays: number
  /** 連続で正解した回数 */
  reps: number
  /** 間違えた回数 */
  lapses: number
  lastScore: number | null
  lastReviewedAt: string | null
}

export const REVIEW_THRESHOLD = 70
export const MASTERED_DAYS = 30
const DAY = 24 * 60 * 60 * 1000
const RETRY_MINUTES = 10

export function enroll(gameId: string, decisionId: number, category: Category, score: number, now: Date): ReviewItem {
  return {
    gameId,
    decisionId,
    category,
    originalScore: score,
    addedAt: now.toISOString(),
    dueAt: now.toISOString(),
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    lastScore: null,
    lastReviewedAt: null,
  }
}

export function schedule(item: ReviewItem, score: number, now: Date): ReviewItem {
  let { intervalDays, reps, lapses } = item
  let due: number
  if (score >= 90) {
    reps++
    intervalDays = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(intervalDays * 2.5)
    due = now.getTime() + intervalDays * DAY
  } else if (score >= REVIEW_THRESHOLD) {
    intervalDays = Math.max(1, Math.round(intervalDays * 1.2))
    due = now.getTime() + intervalDays * DAY
  } else {
    reps = 0
    lapses++
    intervalDays = 0
    due = now.getTime() + RETRY_MINUTES * 60 * 1000
  }
  return {
    ...item,
    intervalDays,
    reps,
    lapses,
    dueAt: new Date(due).toISOString(),
    lastScore: score,
    lastReviewedAt: now.toISOString(),
  }
}

export const isDue = (item: ReviewItem, now: Date) => new Date(item.dueAt).getTime() <= now.getTime()
export const isMastered = (item: ReviewItem) => item.intervalDays >= MASTERED_DAYS

/**
 * 今回解く問題を選ぶ。期限が来たものを古い順に。分類を指定すればその分類だけ。
 */
export function pickSession(items: ReviewItem[], now: Date, limit: number, category?: Category): ReviewItem[] {
  return items
    .filter((i) => isDue(i, now) && !isMastered(i) && (!category || i.category === category))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit)
}

/**
 * 苦手な分類の重点練習（仕様 §1「苦手な判断を重点練習」）。期限に関係なく、
 * その分類のまだ身についていない問題を、前回の点数が低い順に選ぶ。
 */
export function pickPractice(items: ReviewItem[], category: Category, limit: number): ReviewItem[] {
  return items
    .filter((i) => i.category === category && !isMastered(i))
    .sort((a, b) => (a.lastScore ?? a.originalScore) - (b.lastScore ?? b.originalScore))
    .slice(0, limit)
}
