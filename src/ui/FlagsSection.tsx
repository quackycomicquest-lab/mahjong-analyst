/**
 * 弱点分析の画面の「要検証の判断」：印をつけた判断を一覧し、まとめて再評価・書き出す
 * 項目を押すと、その局面（切った後の牌姿つき）と評価の中身を開いて確かめられる。
 * 復習問題で印をつけた判断は、そのときの答えとその評価を対象にする。
 *
 * 再評価は試行回数を増やし（1回 1,200 試行）、乱数を変えて 3 回行う。
 * 書き出した JSON は bench/verify-flags.ts でさらに詳しく調べられる（局面・行動・評価をすべて含む）。
 * 「Mac へ送る」は共有シート（iPhone）で iCloud Drive の MahjongAnalyst フォルダに保存してもらう。
 * Mac ではそのフォルダの最新のファイルを bench/flags-inbox.ts が読み、新しく印をつけた判断だけを分析する（docs/flags-workflow.md）。
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
import type { Seat } from '../engine/game/types'
import { EvaluationDetail } from './EvaluationPanel'
import { FlagEditor } from './FlagEditor'
import { Position } from './Position'
import { requestEvaluation } from './evaluatorClient'
import { scoreGrade } from './labels'
import type { PlayerInfo } from './useGame'

interface Item {
  flag: FlagRecord
  record: StoredEvaluation | null
}

/** 検証の対象：復習問題で印をつけたならそのときの答え、そうでなければ対局での判断 */
function target(it: Item): Pick<StoredEvaluation, 'action' | 'label' | 'evaluation'> | null {
  if (it.flag.answer) return it.flag.answer
  return it.record
}

const REASON_LABEL = new Map(FLAG_REASONS)
/** ファイル名用の日時（例：2026-11-07-1530） */
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
const formatDate = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric' })

export function FlagsSection({ games }: { games: GameRecord[] }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [level, setLevel] = useState<1 | 2 | 3>(1)

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
  const gameNames = useMemo(() => new Map(games.map((g) => [g.id, g.playerNames])), [games])
  const summaryOf = (it: Item): VerifySummary | null => {
    const t = target(it)
    return it.flag.verification && t?.evaluation.score != null
      ? summarizeVerification(t.evaluation.score, t.evaluation.best?.label ?? '', it.flag.verification)
      : null
  }

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
          const action = it.flag.answer?.action ?? rec.action
          runs.push(await requestEvaluation(rec.snapshot, action, 'full', { simulations: VERIFY_SIMULATIONS, seed }))
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

  /**
   * 局面・行動・評価・印をまとめた JSON（bench/verify-flags.ts・bench/flags-inbox.ts で読める）を、
   * 共有シートで送る（iPhone：「"ファイル"に保存」で iCloud Drive へ）。共有できないブラウザ（Mac など）はダウンロードする
   */
  const sendJson = async () => {
    const data = {
      kind: 'mahjong-analyst/flags',
      exportedAt: new Date().toISOString(),
      engineVersion: EVALUATOR_VERSION,
      items: items.filter((i) => i.record).map((i) => ({ flag: i.flag, record: i.record })),
    }
    const json = JSON.stringify(data)
    const name = `mahjong-flags-${stamp(new Date())}.json`
    const file = new File([json], name, { type: 'application/json' })
    setSent(null)
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        // title を付けると、iOS の「"ファイル"に保存」で題名だけのテキストファイルも一緒に保存されるので付けない
        await navigator.share({ files: [file] })
        setSent(`${name} を送りました`)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSent(`送れませんでした（${(e as Error).message}）`)
      }
      return
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setSent(`${name} をダウンロードしました`)
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
          <button type="button" className="btn btn--ghost btn--small" disabled={items.length === 0} onClick={sendJson}>
            Mac へ送る（JSON）
          </button>
        </div>
      </div>
      {items.length > 0 && (
        <p className="muted small flags__send-hint">
          「Mac へ送る」→「"ファイル"に保存」→ iCloud Drive の <b>MahjongAnalyst</b> フォルダに保存すると、Mac で「要検証を反映して」と頼むだけで分析・反映できます。
          {sent && <span className="flags__sent">　{sent}</span>}
        </p>
      )}
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
              const t = target(it)
              const ev = t?.evaluation
              const s = summaryOf(it)
              const key = flagKey(it.flag.gameId, it.flag.decisionId)
              const open = openKey === key
              const names = gameNames.get(it.flag.gameId) ?? ['あなた', '他家1', '他家2', '他家3']
              const players: PlayerInfo[] = names.map((name, seat) => ({ seat: seat as Seat, name, profile: null }))
              return (
                <li key={key} className={`flag-item ${open ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="flag-item__main"
                    aria-expanded={open}
                    disabled={!it.record}
                    onClick={() => {
                      setOpenKey(open ? null : key)
                      setLevel(1)
                    }}
                  >
                    <span className="muted small">
                      {formatDate(gameDate.get(it.flag.gameId) ?? it.flag.createdAt)}・{it.record?.roundLabel ?? '（評価が見つかりません）'}
                      {it.flag.answer && <span className="badge badge--kind flag-item__source">復習の答え</span>}
                    </span>
                    <span>
                      <b>{t?.label}</b>
                      {ev?.score != null && <span className={`tone--${scoreGrade(ev.score).tone}`}> {ev.score}点</span>}
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
                    {it.record && <span className="flag-item__toggle muted small">{open ? '▲ 閉じる' : '▼ 局面と評価を見る'}</span>}
                  </button>
                  {open && it.record && t && (
                    <div className="flag-item__detail">
                      {it.flag.answer && (
                        <p className="muted small">
                          対局では「{it.record.label}」（{it.record.evaluation.score ?? '—'}点）、復習問題では「{it.flag.answer.label}」と答えた判断です。
                        </p>
                      )}
                      <Position record={{ ...it.record, action: t.action, evaluation: t.evaluation }} />
                      <FlagEditor
                        key={key}
                        gameId={it.flag.gameId}
                        decisionId={it.flag.decisionId}
                        flag={it.flag}
                        onChange={(f) => {
                          if (f) setItems((xs) => xs!.map((x) => (x === it ? { ...x, flag: f } : x)))
                          else {
                            setItems((xs) => xs!.filter((x) => x !== it))
                            setOpenKey(null)
                          }
                        }}
                      />
                      <EvaluationDetail ev={t.evaluation} label={t.label} players={players} level={level} setLevel={setLevel} />
                    </div>
                  )}
                  {!open && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small flag-item__remove"
                      onClick={() => {
                        setItems((xs) => xs!.filter((x) => x !== it))
                        deleteFlag(it.flag.gameId, it.flag.decisionId).catch(() => {})
                      }}
                    >
                      外す
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
