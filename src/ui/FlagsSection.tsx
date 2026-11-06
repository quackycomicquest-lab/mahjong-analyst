/**
 * 弱点分析の画面の「要検証の判断」：印をつけた判断を一覧し、まとめて再評価・書き出す
 *
 * 再評価は試行回数を増やし（1回 1,200 試行）、乱数を変えて 3 回行う。
 * 書き出した JSON は bench/verify-flags.ts でさらに詳しく調べられる（局面・行動・評価をすべて含む）。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  summarizeVerification,
  tallyFlags,
  VERDICT_LABELS,
  VERIFY_SEEDS,
  VERIFY_SIMULATIONS,
  type VerifySummary,
} from '../engine/coach/flags'
import { EVALUATOR_VERSION } from '../engine/evaluator/types'
import {
  deleteFlag,
  FLAG_REASONS,
  flagKey,
  getEvaluation,
  listFlags,
  saveFlag,
  type FlagRecord,
  type GameRecord,
  type StoredEvaluation,
} from '../storage/db'
import { requestEvaluation } from './evaluatorClient'
import { scoreGrade } from './labels'

interface Item {
  flag: FlagRecord
  record: StoredEvaluation | null
}

const REASON_LABEL = new Map(FLAG_REASONS)
const formatDate = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric' })

export function FlagsSection({ games }: { games: GameRecord[] }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listFlags()
      .then((flags) =>
        Promise.all(flags.map(async (flag) => ({ flag, record: (await getEvaluation(flag.gameId, flag.decisionId)) ?? null }))),
      )
      .then(
        (xs) => alive && setItems(xs),
        (e: Error) => alive && setError(e.message),
      )
    return () => {
      alive = false
    }
  }, [])

  const gameDate = useMemo(() => new Map(games.map((g) => [g.id, g.startedAt])), [games])
  const summaryOf = (it: Item): VerifySummary | null =>
    it.flag.verification && it.record?.evaluation.score != null
      ? summarizeVerification(it.record.evaluation.score, it.record.evaluation.best?.label ?? '', it.flag.verification)
      : null

  if (error) return <p className="eval__error">要検証の判断を読み込めませんでした：{error}</p>
  if (!items) return null

  const tally = tallyFlags(items.map((i) => i.flag), (f) => {
    const it = items.find((i) => i.flag === f)
    return it ? (summaryOf(it)?.verdict ?? null) : null
  })

  /** 未検証（または古いエンジンで検証した）判断を、まとめて再評価する */
  const verifyAll = async (onlyPending: boolean) => {
    const targets = items.filter(
      (i) => i.record && (!onlyPending || i.flag.verification?.engineVersion !== EVALUATOR_VERSION),
    )
    setProgress({ done: 0, total: targets.length })
    for (const [n, it] of targets.entries()) {
      const rec = it.record!
      try {
        const runs = []
        for (const seed of VERIFY_SEEDS) {
          runs.push(await requestEvaluation(rec.snapshot, rec.action, 'full', { simulations: VERIFY_SIMULATIONS, seed }))
        }
        const flag: FlagRecord = {
          ...it.flag,
          updatedAt: new Date().toISOString(),
          verification: {
            at: new Date().toISOString(),
            engineVersion: runs[0].engineVersion,
            simulations: VERIFY_SIMULATIONS,
            scores: runs.map((r) => r.score ?? 0),
            bestLabels: runs.map((r) => r.best?.label ?? ''),
            losses: runs.map((r) => r.loss ?? 0),
          },
        }
        await saveFlag(flag)
        setItems((xs) => xs!.map((x) => (x.flag === it.flag ? { ...x, flag } : x)))
      } catch (e) {
        setError(`再評価できませんでした（${(e as Error).message}）`)
        break
      }
      setProgress({ done: n + 1, total: targets.length })
    }
    setProgress(null)
  }

  /** 局面・行動・評価・印をまとめて JSON で書き出す（bench/verify-flags.ts で読める） */
  const exportJson = () => {
    const data = {
      kind: 'mahjong-analyst/flags',
      exportedAt: new Date().toISOString(),
      engineVersion: EVALUATOR_VERSION,
      items: items.filter((i) => i.record).map((i) => ({ flag: i.flag, record: i.record })),
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mahjong-flags-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const pending = items.filter((i) => i.record && i.flag.verification?.engineVersion !== EVALUATOR_VERSION).length

  return (
    <section className="flags">
      <div className="flags__head">
        <h2>⚑ 要検証の判断</h2>
        <span className="muted">{items.length}件</span>
        <div className="flags__actions">
          <button
            type="button"
            className="btn btn--call btn--small"
            disabled={progress !== null || pending === 0}
            onClick={() => verifyAll(true)}
          >
            {progress ? `再評価中 ${progress.done}/${progress.total}` : `まとめて再評価（${pending}件）`}
          </button>
          <button type="button" className="btn btn--ghost btn--small" disabled={items.length === 0} onClick={exportJson}>
            書き出す（JSON）
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="muted">
          対局履歴の振り返りで、評価に納得できない判断に「⚑ 要検証」の印をつけると、ここにまとまります。
        </p>
      ) : (
        <>
          <p className="muted small">
            再評価は1回 {VERIFY_SIMULATIONS.toLocaleString()} 試行（高精度評価の3倍）で、乱数を変えて{VERIFY_SEEDS.length}回行います（1件あたり数秒）。
            {[...tally.byReason].map(([r, n]) => `${REASON_LABEL.get(r)} ${n}件`).join('・')}
          </p>
          {tally.byVerdict.size > 0 && (
            <ul className="flags__tally">
              {(['stable', 'noisy', 'bestChanged', 'unverified'] as const)
                .filter((v) => tally.byVerdict.get(v))
                .map((v) => (
                  <li key={v}>
                    {v === 'unverified' ? '未検証' : VERDICT_LABELS[v]}：<b>{tally.byVerdict.get(v)}件</b>
                  </li>
                ))}
            </ul>
          )}
          <ul className="flags__list">
            {items.map((it) => {
              const ev = it.record?.evaluation
              const s = summaryOf(it)
              return (
                <li key={flagKey(it.flag.gameId, it.flag.decisionId)} className="flag-item">
                  <div className="flag-item__main">
                    <span className="muted small">
                      {formatDate(gameDate.get(it.flag.gameId) ?? it.flag.createdAt)}・{it.record?.roundLabel ?? '（評価が見つかりません）'}
                    </span>
                    <span>
                      <b>{it.record?.label}</b>
                      {ev?.score != null && (
                        <span className={`tone--${scoreGrade(ev.score).tone}`}> {ev.score}点</span>
                      )}
                      {ev?.best && <span className="muted">（最善 {ev.best.label}）</span>}
                    </span>
                    {it.flag.reasons.length > 0 && (
                      <span className="flag-item__reasons">
                        {it.flag.reasons.map((r) => (
                          <span key={r} className="badge badge--kind">
                            {REASON_LABEL.get(r)}
                          </span>
                        ))}
                      </span>
                    )}
                    {it.flag.note && <span className="flag-item__note">「{it.flag.note}」</span>}
                    {s && (
                      <span className={`flag-item__verdict verdict--${s.verdict}`}>
                        再評価 {Math.round(s.mean)}点（{s.min}〜{s.max}）・最善 {[...new Set(it.flag.verification!.bestLabels)].join('／')}
                        ：{VERDICT_LABELS[s.verdict]}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => {
                      setItems((xs) => xs!.filter((x) => x !== it))
                      deleteFlag(it.flag.gameId, it.flag.decisionId).catch(() => {})
                    }}
                  >
                    外す
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
