/**
 * 復習問題（仕様 §7-3）
 *
 * 実際の対局で 70 点未満だった判断を、その局面のまま出題する。
 * 答えをその場で評価し直し（仕様 §3-4 の再評価）、前回の自分の選択と比べる。
 * 結果から次の出題日を決めて保存する。
 */
import { useEffect, useMemo, useState } from 'react'
import { pickPractice, pickSession, schedule, type ReviewItem } from '../engine/coach/review'
import type { Evaluation } from '../engine/evaluator/types'
import type { Action, Seat } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'
import { flagKey, listFlags, saveReviews, type FlagRecord } from '../storage/db'
import type { ReviewRequest } from './AnalysisScreen'
import { Melds } from './Board'
import { EvaluationDetail } from './EvaluationPanel'
import { FlagEditor } from './FlagEditor'
import { Tile } from './Tile'
import { loadCoachData, reviewKey, type CoachData, type CoachDecision } from './coachData'
import { defaultEvaluationMode, requestEvaluation } from './evaluatorClient'
import { actionLabel, roundLabel, scoreGrade, seatWind, tileLabel } from './labels'
import type { PlayerInfo } from './useGame'

const SESSION_SIZE = 10

interface Answer {
  action: Action
  label: string
  evaluation: Evaluation | null
  error: string | null
  /** 答えた時刻 */
  at: string
}

export function ReviewScreen({ request, onExit }: { request: ReviewRequest; onExit: () => void }) {
  const [data, setData] = useState<CoachData | null>(null)
  const [queue, setQueue] = useState<ReviewItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [results, setResults] = useState<number[]>([])
  const [level, setLevel] = useState<1 | 2 | 3>(1)
  /** 要検証の印（復習問題からもつけられる） */
  const [flags, setFlags] = useState<Map<string, FlagRecord>>(new Map())

  useEffect(() => {
    listFlags().then(
      (fs) => setFlags(new Map(fs.map((f) => [flagKey(f.gameId, f.decisionId), f]))),
      () => {},
    )
  }, [])

  useEffect(() => {
    loadCoachData().then((d) => {
      setData(d)
      setQueue(
        request.mode === 'due'
          ? pickSession(d.reviews, d.loadedAt, SESSION_SIZE)
          : pickPractice(d.reviews, request.category, SESSION_SIZE),
      )
    })
  }, [request])

  const byKey = useMemo(() => {
    const m = new Map<string, CoachDecision>()
    for (const d of data?.decisions ?? []) m.set(reviewKey(d.gameId, d.record.decisionId), d)
    return m
  }, [data])

  const title = request.mode === 'due' ? '今日の復習' : `重点練習：${request.category}`
  if (!queue || !data) {
    return (
      <div className="page">
        <p className="muted">問題を準備しています…</p>
      </div>
    )
  }
  const item = queue[index]
  const decision = item ? byKey.get(reviewKey(item.gameId, item.decisionId)) : undefined

  if (!item || !decision) {
    const avg = results.length ? results.reduce((a, b) => a + b, 0) / results.length : null
    return (
      <div className="page">
        <header className="page__header">
          <h1>{title}</h1>
        </header>
        <section className="review-card">
          <div className="review-card__text">
            <h2>{queue.length === 0 ? '出題できる問題がありません' : 'おつかれさまでした'}</h2>
            {avg !== null && (
              <p>
                {results.length}問 ／ 平均 <b>{avg.toFixed(1)}点</b> ／ 正解（90点以上）{results.filter((s) => s >= 90).length}問
              </p>
            )}
            <p className="muted">間違えた問題は10分後、正解した問題は間隔を空けてまた出題されます。</p>
          </div>
          <button type="button" className="btn btn--riichi" onClick={onExit}>
            分析に戻る
          </button>
        </section>
      </div>
    )
  }

  const game = data.games.find((g) => g.id === item.gameId)
  const players: PlayerInfo[] = (game?.playerNames ?? ['あなた', '他家1', '他家2', '他家3']).map((name, seat) => ({
    seat: seat as Seat,
    name,
    profile: null,
  }))

  const submit = (action: Action) => {
    if (answer) return
    const view = decision.record.snapshot
    const a: Answer = { action, label: actionLabel(view, action), evaluation: null, error: null, at: new Date().toISOString() }
    setAnswer(a)
    requestEvaluation(view, action, defaultEvaluationMode()).then(
      (evaluation) => {
        setAnswer({ ...a, evaluation })
        const score = evaluation.score ?? 0
        setResults((r) => [...r, score])
        const updated = schedule(item, score, new Date())
        saveReviews([updated]).catch(() => {})
      },
      (err: Error) => setAnswer({ ...a, error: err.message }),
    )
  }

  const next = () => {
    setAnswer(null)
    setLevel(1)
    setIndex((i) => i + 1)
  }

  return (
    <div className="page problem">
      <header className="page__header">
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          ← やめる
        </button>
        <h1>
          {title}　{index + 1} / {queue.length}
        </h1>
        <span className="badge badge--kind">{item.category}</span>
      </header>

      <ProblemBoard view={decision.record.snapshot} players={players} />

      {!answer ? (
        <AnswerPicker view={decision.record.snapshot} onAnswer={submit} />
      ) : (
        <section className="problem__result">
          {!answer.evaluation && !answer.error && <p className="eval__pending">「{answer.label}」を評価しています…</p>}
          {answer.error && <p className="eval__error">評価できませんでした：{answer.error}</p>}
          {answer.evaluation && (
            <>
              <Comparison
                before={{ label: decision.record.label, score: decision.score }}
                after={{ label: answer.label, score: answer.evaluation.score ?? 0 }}
              />
              <FlagEditor
                key={flagKey(item.gameId, item.decisionId)}
                gameId={item.gameId}
                decisionId={item.decisionId}
                flag={flags.get(flagKey(item.gameId, item.decisionId)) ?? null}
                extra={{ answer: { action: answer.action, label: answer.label, evaluation: answer.evaluation, at: answer.at } }}
                hint="この答えの評価に納得できないときに印をつけると、弱点分析の画面の「要検証の判断」にまとまります。"
                onChange={(f) =>
                  setFlags((m) => {
                    const next = new Map(m)
                    const k = flagKey(item.gameId, item.decisionId)
                    if (f) next.set(k, f)
                    else next.delete(k)
                    return next
                  })
                }
              />
              <EvaluationDetail ev={answer.evaluation} label={answer.label} players={players} level={level} setLevel={setLevel} />
              <div className="modal__buttons">
                <button type="button" className="btn btn--riichi" autoFocus onClick={next}>
                  {index + 1 < queue.length ? '次の問題' : '結果を見る'}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function Comparison({ before, after }: { before: { label: string; score: number }; after: { label: string; score: number } }) {
  const b = scoreGrade(before.score)
  const a = scoreGrade(after.score)
  return (
    <div className="comparison">
      <div>
        <span className="muted">元の対局</span>
        <b>{before.label}</b>
        <span className={`tone--${b.tone}`}>
          {before.score}点 {b.label}
        </span>
      </div>
      <span aria-hidden>→</span>
      <div>
        <span className="muted">今回</span>
        <b>{after.label}</b>
        <span className={`tone--${a.tone}`}>
          {after.score}点 {a.label}
        </span>
      </div>
    </div>
  )
}

/** 出題する局面：局の情報・4人の河と副露・自分の手牌 */
function ProblemBoard({ view, players }: { view: PlayerView; players: PlayerInfo[] }) {
  const r = view.round
  const order = [1, 2, 3, 0].map((d) => ((view.seat + d) % 4) as Seat)
  return (
    <section className="problem__board">
      <div className="position__meta">
        {roundLabel(r.wind, r.dealer, r.honba)}・供託{r.kyoutaku}・残り{view.wallRemaining}枚・ドラ表示
        {view.doraIndicators.map((k, i) => (
          <Tile key={i} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
        ))}
      </div>
      <div className="problem__players">
        {order.map((s) => {
          const p = view.players[s]
          return (
            <div key={s} className={`problem__player ${s === view.seat ? 'is-me' : ''}`}>
              <div className="problem__name">
                <span className="seat-plate__wind">{seatWind(s, r.dealer)}</span>
                <span>{players[s].name}</span>
                <span className="muted">{p.points.toLocaleString()}</span>
                {p.riichi && <span className="seat-plate__riichi">立直</span>}
                {p.melds.length > 0 && <Melds melds={p.melds} owner={s} size="mini" />}
              </div>
              <div className="problem__river">
                {p.river.map((rt) => (
                  <Tile
                    key={rt.tile.id}
                    tile={rt.tile}
                    size="mini"
                    sideways={rt.riichi}
                    ghost={rt.calledBy !== null}
                    highlight={view.responseTo?.tile.id === rt.tile.id}
                  />
                ))}
                {p.river.length === 0 && <span className="muted small">（まだ捨て牌なし）</span>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 答える：打牌は牌をクリック、鳴き・和了などはボタン */
function AnswerPicker({ view, onAnswer }: { view: PlayerView; onAnswer: (a: Action) => void }) {
  const [riichi, setRiichi] = useState(false)
  // iPhone では対局画面と同じく、1回目のタップで選択・2回目で確定（誤操作防止）
  const [selected, setSelected] = useState<number | null>(null)
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, [])
  const acts = view.legalActions
  const discards = acts.filter((a): a is Extract<Action, { type: 'discard' }> => a.type === 'discard')
  const canRiichi = discards.some((a) => a.riichi)
  const others = acts.filter((a) => a.type !== 'discard' && a.type !== 'nextRound')
  const drawn = view.drawn
  const hand = view.hand
    .filter((t) => t.id !== drawn?.id)
    .sort((a, b) => a.kind - b.kind || Number(b.red) - Number(a.red))
  const ordered = drawn ? [...hand, drawn] : hand
  const pick = (tileId: number) => {
    const a = discards.find((d) => d.tileId === tileId && !!d.riichi === riichi)
    if (!a) return
    if (coarse && selected !== tileId) {
      setSelected(tileId)
      return
    }
    onAnswer(a)
  }
  const target = view.responseTo
  const buttonLabel = (a: Action): string => {
    if (a.type === 'pon' || a.type === 'chi') {
      const own = a.tileIds.map((id) => tileLabel(view.hand.find((t) => t.id === id)!)).join('')
      return `${a.type === 'pon' ? 'ポン' : 'チー'}（${own}）`
    }
    if (a.type === 'pass') return 'スキップ'
    return actionLabel(view, a)
  }
  return (
    <section className="problem__answer">
      <p className="problem__question">
        {target
          ? `${seatWind(target.seat, view.round.dealer)}家の「${tileLabel(target.tile)}」をどうしますか？`
          : discards.length > 0
            ? `あなたならどうしますか？（切る牌を${coarse ? 'タップ、もう一度タップで確定' : 'クリック'}）`
            : 'あなたならどうしますか？'}
      </p>
      {target && (
        <div className="problem__target">
          <Tile tile={target.tile} size="meld" highlight />
        </div>
      )}
      {(others.length > 0 || canRiichi) && (
        <div className="action-bar__buttons">
          {canRiichi && (
            <label className="toggle">
              <input type="checkbox" checked={riichi} onChange={(e) => setRiichi(e.target.checked)} />
              立直する
            </label>
          )}
          {others.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`btn ${a.type === 'pass' ? 'btn--plain' : a.type === 'ron' || a.type === 'tsumo' ? 'btn--win' : 'btn--call'}`}
              onClick={() => onAnswer(a)}
            >
              {buttonLabel(a)}
            </button>
          ))}
        </div>
      )}
      <div className="hand-row">
        <div className="hand is-active" aria-label="自分の手牌">
          {ordered.map((t) => {
            const ok = discards.some((d) => d.tileId === t.id && !!d.riichi === riichi)
            return (
              <span key={t.id} className={drawn && t.id === drawn.id ? 'hand__drawn' : undefined}>
                <Tile
                  tile={t}
                  size="hand"
                  selected={selected === t.id}
                  disabled={discards.length > 0 && !ok}
                  onClick={ok ? () => pick(t.id) : undefined}
                />
              </span>
            )
          })}
        </div>
        {view.players[view.seat].melds.length > 0 && (
          <div className="my-melds">
            <Melds melds={view.players[view.seat].melds} owner={view.seat} size="meld" />
          </div>
        )}
      </div>
    </section>
  )
}
