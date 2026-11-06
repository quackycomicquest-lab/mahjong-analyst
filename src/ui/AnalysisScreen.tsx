/**
 * 弱点分析（仕様 §7-1, §7-2、5つの能力値）
 *
 * 直近10半荘・直近30半荘・累計で、分類ごとの成績と能力値を比べる。
 * AI との一致率ではなく、評価点と判断損失（期待値の差）で測る。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  abilities,
  categoryStats,
  filterByRecentGames,
  MISTAKE_THRESHOLD,
  weakestCategory,
} from '../engine/coach/abilities'
import { CATEGORY_DESCRIPTIONS, type Category } from '../engine/coach/classify'
import { isDue, isMastered, type ReviewItem } from '../engine/coach/review'
import { loadCoachData, type CoachData } from './coachData'
import { FlagsSection } from './FlagsSection'
import { scoreGrade } from './labels'

const PERIODS = [
  { label: '直近10半荘', n: 10 },
  { label: '直近30半荘', n: 30 },
  { label: '累計', n: null },
] as const

export type ReviewRequest = { mode: 'due' } | { mode: 'practice'; category: Category }

export function AnalysisScreen({ onBack, onReview }: { onBack: () => void; onReview: (r: ReviewRequest) => void }) {
  const [data, setData] = useState<CoachData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState(0)

  useEffect(() => {
    loadCoachData().then(setData, (e: Error) => setError(e.message))
  }, [])

  const view = useMemo(() => {
    if (!data) return null
    const ids = data.games.map((g) => g.id)
    const ds = filterByRecentGames(data.decisions, ids, PERIODS[period].n)
    const stats = categoryStats(ds)
    const n = PERIODS[period].n
    const gameIds = new Set(n === null ? ids : ids.slice(0, n))
    const quizzes = data.quizzes.filter((q) => gameIds.has(q.gameId))
    return { ds, stats, abilities: abilities(ds), weakest: weakestCategory(stats), quizzes }
  }, [data, period])

  const due = data?.reviews.filter((r) => isDue(r, data.loadedAt) && !isMastered(r)).length ?? 0
  const mastered = data?.reviews.filter(isMastered).length ?? 0

  return (
    <div className="page page--analysis">
      <header className="page__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h1>弱点分析・復習</h1>
      </header>
      {error && <p className="eval__error">読み込めませんでした：{error}</p>}
      {!data && !error && <p className="muted">集計しています…</p>}

      {data && (
        <section className="review-card">
          <div className="review-card__text">
            <h2>復習問題</h2>
            <p>
              今日の出題 <b>{due}問</b> ／ 登録 {data.reviews.length}問 ／ 身についた {mastered}問
            </p>
            <p className="muted">
              {MISTAKE_THRESHOLD}点未満だった判断が自動で問題になります。正解すると出題間隔が 1日→3日→約1週間…と伸び、間違えると10分後にもう一度出ます。
            </p>
          </div>
          <button type="button" className="btn btn--riichi" disabled={due === 0} onClick={() => onReview({ mode: 'due' })}>
            {due > 0 ? `復習を始める（${Math.min(due, 10)}問）` : '今日の復習はありません'}
          </button>
        </section>
      )}

      {data && <FlagsSection games={data.games} />}

      {view && data && (
        <>
          <div className="segmented segmented--inline" role="radiogroup" aria-label="期間">
            {PERIODS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={period === i}
                className="segmented__item"
                onClick={() => setPeriod(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="muted">
            対象：{PERIODS[period].n === null ? data.games.length : Math.min(PERIODS[period].n!, data.games.length)}半荘・
            {view.ds.length}判断
          </p>

          {view.ds.length === 0 ? (
            <p className="muted">まだ評価した判断がありません。対局すると、ここに分析が表示されます。</p>
          ) : (
            <>
              <section className="abilities" aria-label="5つの能力値">
                <h2>能力値</h2>
                {view.abilities.map((a) => (
                  <div key={a.name} className="ability">
                    <span className="ability__name">{a.name}</span>
                    <span className="ability__bar" aria-hidden>
                      <span
                        className={`ability__fill ${a.value != null ? `fill--${scoreGrade(a.value).tone}` : ''}`}
                        style={{ width: `${a.value ?? 0}%` }}
                      />
                    </span>
                    <span className="ability__value">
                      {a.value != null ? `${a.value.toFixed(1)}` : 'データ不足'}
                      <span className="ability__count muted">{a.count}判断</span>
                    </span>
                  </div>
                ))}
                <p className="muted small">
                  能力値は各分類の判断の平均評価点（100点満点）。5判断未満の能力は表示しません。順位戦略は、順位期待値が未対応のため収支の期待値で評価しています。
                </p>
              </section>

              <section className="review-card">
                <div className="review-card__text">
                  <h2>点数計算テスト</h2>
                  {view.quizzes.length === 0 ? (
                    <p className="muted">和了のあとに出る点数計算テストの結果がここに表示されます。</p>
                  ) : (
                    <p>
                      正答率 <b>{Math.round((view.quizzes.filter((q) => q.correct).length / view.quizzes.length) * 100)}%</b>（
                      {view.quizzes.filter((q) => q.correct).length} / {view.quizzes.length}問）
                      {quizWeakness(view.quizzes)}
                    </p>
                  )}
                </div>
              </section>

              {view.weakest && (
                <section className="focus">
                  <div>
                    <h2>重点課題：{view.weakest.category}</h2>
                    <p>
                      平均判断損失 <b>{Math.round(view.weakest.averageLoss!)}点</b>・平均{' '}
                      {view.weakest.averageScore!.toFixed(1)}点（{view.weakest.count}判断中、要復習 {view.weakest.mistakes}）
                    </p>
                    <p className="muted">{CATEGORY_DESCRIPTIONS[view.weakest.category]}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn--call"
                    disabled={!data.reviews.some((r) => r.category === view.weakest!.category && !isMastered(r))}
                    onClick={() => onReview({ mode: 'practice', category: view.weakest!.category })}
                  >
                    この分類を練習
                  </button>
                </section>
              )}

              <section>
                <h2>分類ごとの成績</h2>
                <table className="stats">
                  <thead>
                    <tr>
                      <th>分類</th>
                      <th>判断数</th>
                      <th>平均点</th>
                      <th>平均判断損失</th>
                      <th>要復習</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.stats
                      .filter((s) => s.count > 0)
                      .map((s) => (
                        <tr key={s.category} title={CATEGORY_DESCRIPTIONS[s.category]}>
                          <th>{s.category}</th>
                          <td>{s.count}</td>
                          <td className={s.averageScore != null ? `tone--${scoreGrade(s.averageScore).tone}` : ''}>
                            {s.averageScore?.toFixed(1)}
                          </td>
                          <td>{Math.round(s.averageLoss ?? 0)}点</td>
                          <td>{s.mistakes}</td>
                          <td>
                            {hasPractice(data.reviews, s.category) && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--small"
                                onClick={() => onReview({ mode: 'practice', category: s.category })}
                              >
                                練習
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** 点数計算テストで間違えやすい帯（満貫未満・満貫以上） */
function quizWeakness(qs: { correct: boolean; han: number; yakuman: boolean }[]): string {
  const low = qs.filter((q) => !q.yakuman && q.han < 5)
  const high = qs.filter((q) => q.yakuman || q.han >= 5)
  const rate = (xs: typeof qs) => (xs.length ? Math.round((xs.filter((q) => q.correct).length / xs.length) * 100) : null)
  const parts: string[] = []
  if (rate(low) !== null) parts.push(`満貫未満 ${rate(low)}%`)
  if (rate(high) !== null) parts.push(`満貫以上 ${rate(high)}%`)
  return parts.length ? `　内訳：${parts.join('・')}` : ''
}

function hasPractice(reviews: ReviewItem[], category: Category): boolean {
  return reviews.some((r) => r.category === category && !isMastered(r))
}
