/**
 * 弱点分析・復習のためのデータ読み込み
 *
 * 保存済みの対局と判断の評価を読み、判断を分類する。
 * 70点未満で、まだ復習問題になっていない判断は、ここで復習問題として登録する。
 */
import { type ScoredDecision } from '../engine/coach/abilities'
import { classifyDecision } from '../engine/coach/classify'
import { enroll, REVIEW_THRESHOLD, type ReviewItem } from '../engine/coach/review'
import {
  listAllEvaluations,
  listGames,
  listReviews,
  saveReviews,
  type GameRecord,
  type StoredEvaluation,
} from '../storage/db'

export interface CoachDecision extends ScoredDecision {
  record: StoredEvaluation
}

export interface CoachData {
  /** 新しい順 */
  games: GameRecord[]
  decisions: CoachDecision[]
  reviews: ReviewItem[]
  /** 読み込んだ時刻（出題の期限判定に使う） */
  loadedAt: Date
}

export const reviewKey = (gameId: string, decisionId: number) => `${gameId}:${decisionId}`

export async function loadCoachData(now = new Date()): Promise<CoachData> {
  const [games, evals, reviews] = await Promise.all([listGames(), listAllEvaluations(), listReviews()])
  const lengthOf = new Map(games.map((g) => [g.id, g.settings.length]))
  const decisions: CoachDecision[] = []
  for (const r of evals) {
    const ev = r.evaluation
    if (ev.status === 'unavailable' || ev.score == null) continue
    decisions.push({
      gameId: r.gameId,
      category: classifyDecision(ev, r.snapshot, lengthOf.get(r.gameId) ?? 'hanchan'),
      score: ev.score,
      loss: ev.loss ?? 0,
      record: r,
    })
  }
  const existing = new Set(reviews.map((i) => reviewKey(i.gameId, i.decisionId)))
  const added = decisions
    .filter((d) => d.score < REVIEW_THRESHOLD && !existing.has(reviewKey(d.gameId, d.record.decisionId)))
    .map((d) => enroll(d.gameId, d.record.decisionId, d.category, d.score, now))
  await saveReviews(added)
  return { games, decisions, reviews: [...reviews, ...added], loadedAt: now }
}
