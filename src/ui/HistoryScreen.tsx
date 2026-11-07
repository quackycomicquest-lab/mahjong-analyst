/**
 * 対局履歴と打牌の振り返り（仕様 §3-4, §7）
 */
import { useEffect, useState } from 'react'
import { flagKey, listEvaluations, listFlags, listGames, type FlagRecord, type GameRecord, type StoredEvaluation } from '../storage/db'
import type { Seat } from '../engine/game/types'
import type { CandidateEvaluation } from '../engine/evaluator/types'
import { handAfter, type HandAfter } from '../engine/coach/handAfter'
import { EvaluationDetail } from './EvaluationPanel'
import { FlagEditor } from './FlagEditor'
import { Tile } from './Tile'
import { scoreGrade } from './labels'
import type { PlayerInfo } from './useGame'

const STRENGTH = { 1: '初級', 2: '中級', 3: '上級' } as const
const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function HistoryScreen({ onBack, onResume }: { onBack: () => void; onResume: (g: GameRecord) => void }) {
  const [games, setGames] = useState<GameRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GameRecord | null>(null)

  useEffect(() => {
    listGames().then(setGames, (e: Error) => setError(e.message))
  }, [])

  if (selected) return <GameReview game={selected} onBack={() => setSelected(null)} onResume={onResume} />

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h1>対局履歴</h1>
      </header>
      {error && <p className="eval__error">履歴を読み込めませんでした：{error}</p>}
      {games && games.length === 0 && <p className="muted">まだ対局の記録がありません。</p>}
      <ul className="history-list">
        {games?.map((g) => {
          const rank = g.result ? g.result.ranks[0] + 1 : null
          const avg = g.summary.averageScore
          return (
            <li key={g.id}>
              <button type="button" className="history-item" onClick={() => setSelected(g)}>
                <span className="history-item__date">{formatDate(g.startedAt)}</span>
                <span className="history-item__kind">
                  {g.settings.length === 'tonpuu' ? '東風戦' : '東南戦'}・AI{STRENGTH[g.settings.strength]}
                </span>
                <span className="history-item__result">
                  {rank ? `${rank}位 ${g.result!.finalPoints[0].toLocaleString()}点` : `中断（${g.roundLabel}）`}
                </span>
                <span className={`history-item__score ${avg != null ? `tone--${scoreGrade(avg).tone}` : ''}`}>
                  {avg != null ? `平均 ${avg.toFixed(1)}点` : '評価なし'}
                  <span className="muted">（{g.summary.evaluated}判断）</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GameReview({
  game,
  onBack,
  onResume,
}: {
  game: GameRecord
  onBack: () => void
  onResume: (g: GameRecord) => void
}) {
  const [records, setRecords] = useState<StoredEvaluation[] | null>(null)
  const [current, setCurrent] = useState<StoredEvaluation | null>(null)
  const [level, setLevel] = useState<1 | 2 | 3>(1)
  const [onlyMistakes, setOnlyMistakes] = useState(false)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [flags, setFlags] = useState<Map<string, FlagRecord>>(new Map())

  useEffect(() => {
    listEvaluations(game.id).then(setRecords, () => setRecords([]))
    listFlags().then(
      (fs) => setFlags(new Map(fs.filter((f) => f.gameId === game.id).map((f) => [flagKey(f.gameId, f.decisionId), f]))),
      () => {},
    )
  }, [game.id])
  const flagOf = (r: StoredEvaluation) => flags.get(flagKey(r.gameId, r.decisionId)) ?? null

  const players: PlayerInfo[] = game.playerNames.map((name, seat) => ({ seat: seat as Seat, name, profile: null }))
  const shown = (records ?? []).filter(
    (r) => (!onlyMistakes || (r.evaluation.score ?? 100) < 70) && (!onlyFlagged || flagOf(r) !== null),
  )
  const rounds = [...new Set(shown.map((r) => r.roundLabel))]

  return (
    <div className="page">
      <header className="page__header">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          ← 一覧
        </button>
        <h1>{formatDate(game.startedAt)} の対局</h1>
        {game.finishedAt === null && (
          <button type="button" className="btn btn--riichi" onClick={() => onResume(game)}>
            続きから打つ
          </button>
        )}
      </header>

      <section className="review-summary">
        {game.result ? (
          <ol className="ranking ranking--compact">
            {[0, 1, 2, 3]
              .sort((a, b) => game.result!.ranks[a] - game.result!.ranks[b])
              .map((s) => (
                <li key={s} className={s === 0 ? 'is-me' : ''}>
                  <span className="ranking__rank">{game.result!.ranks[s] + 1}位</span>
                  <span className="ranking__name">{game.playerNames[s]}</span>
                  <span className="ranking__points">{game.result!.finalPoints[s].toLocaleString()}点</span>
                </li>
              ))}
          </ol>
        ) : (
          <p className="muted">中断中（{game.roundLabel}）</p>
        )}
        <p>
          評価した判断 {game.summary.evaluated}回 ／ 平均{' '}
          <b>{game.summary.averageScore != null ? `${game.summary.averageScore.toFixed(1)}点` : '—'}</b> ／ 判断損失の合計{' '}
          {game.summary.totalLoss.toLocaleString()}点
        </p>
        <label className="toggle">
          <input type="checkbox" checked={onlyMistakes} onChange={(e) => setOnlyMistakes(e.target.checked)} />
          70点未満の判断だけ表示
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          要検証（⚑）の判断だけ表示（{flags.size}件）
        </label>
      </section>

      <div className="review">
        <div className="review__list">
          {records === null && <p className="muted">読み込み中…</p>}
          {records && shown.length === 0 && <p className="muted">表示する判断がありません。</p>}
          {rounds.map((label) => (
            <section key={label} className="review__round">
              <h3>{label}</h3>
              <div className="eval__history">
                {shown
                  .filter((r) => r.roundLabel === label)
                  .map((r) => {
                    const s = r.evaluation.score
                    return (
                      <button
                        key={r.decisionId}
                        type="button"
                        className={`chip chip--${s == null ? 'none' : scoreGrade(s).tone} ${current === r ? 'is-current' : ''}`}
                        onClick={() => setCurrent(r)}
                      >
                        {flagOf(r) && <span aria-label="要検証">⚑ </span>}
                        {r.label} {s ?? '—'}
                      </button>
                    )
                  })}
              </div>
            </section>
          ))}
        </div>

        <div className="review__detail">
          {current ? (
            <>
              <Position record={current} />
              <FlagEditor
                key={flagKey(current.gameId, current.decisionId)}
                gameId={current.gameId}
                decisionId={current.decisionId}
                flag={flagOf(current)}
                onChange={(f) =>
                  setFlags((m) => {
                    const next = new Map(m)
                    const k = flagKey(current.gameId, current.decisionId)
                    if (f) next.set(k, f)
                    else next.delete(k)
                    return next
                  })
                }
              />
              <EvaluationDetail ev={current.evaluation} label={current.label} players={players} level={level} setLevel={setLevel} />
            </>
          ) : (
            <p className="muted">判断を選ぶと、そのときの局面と評価が表示されます。</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** 評価した局面（判断直前の手牌）。打牌なら選んだ牌と最善の牌に印を付ける */
function Position({ record }: { record: StoredEvaluation }) {
  const v = record.snapshot
  const a = record.action
  const chosenId = a.type === 'discard' ? a.tileId : -1
  const ev = record.evaluation
  const bestKind = ev.best?.kind
  const hand = [...v.hand].sort((x, y) => x.kind - y.kind || Number(y.red) - Number(x.red))
  // 最善を選んだ場合と、実際に選んだ場合の牌姿
  const chosenCand = ev.chosen ?? null
  const bestCand = ev.best ?? null
  const chosenAfter = handAfter(v, chosenCand?.action ?? a, chosenCand?.kind ?? null)
  const sameAsBest = !!bestCand && !!chosenCand && bestCand.label === chosenCand.label
  const bestAfter = bestCand && !sameAsBest ? handAfter(v, bestCand.action, bestCand.kind) : null
  return (
    <div className="position">
      <div className="position__meta">
        {record.roundLabel}・残り{v.wallRemaining}枚・ドラ表示
        {v.doraIndicators.map((k, i) => (
          <Tile key={i} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
        ))}
        {v.players.some((p) => p.seat !== v.seat && p.riichi) && <span className="badge">他家立直あり</span>}
      </div>
      <div className="position__hand">
        {hand.map((t) => (
          <span key={t.id} className="position__tile">
            <Tile tile={t} size="meld" selected={t.id === chosenId} highlight={t.kind === bestKind && t.id !== chosenId} />
          </span>
        ))}
        {v.responseTo && (
          <span className="position__called">
            <span className="muted">他家の打牌</span>
            <Tile tile={v.responseTo.tile} size="meld" highlight />
          </span>
        )}
      </div>
      <p className="position__legend muted">黄色の枠：あなたの打牌 ／ 枠線：最善の打牌</p>
      {(bestAfter || chosenAfter) && (
        <div className="after-hands">
          {bestAfter && bestCand && <AfterHand title="最善" cand={bestCand} after={bestAfter} tone="best" />}
          {chosenAfter && (
            <AfterHand
              title={sameAsBest ? 'あなた（最善と同じ）' : 'あなた'}
              cand={chosenCand}
              after={chosenAfter}
              tone={sameAsBest ? 'best' : 'chosen'}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** 行動した後の牌姿と、その形の向聴数・受け入れ */
function AfterHand({
  title,
  cand,
  after,
  tone,
}: {
  title: string
  cand: CandidateEvaluation | null
  after: HandAfter
  tone: 'best' | 'chosen'
}) {
  const kinds = cand?.effectiveKinds ?? []
  return (
    <div className={`after-hand after-hand--${tone}`}>
      <div className="after-hand__head">
        <b>{title}</b>
        <span>{cand?.label ?? ''}</span>
        {cand && (
          <span className="muted">
            {cand.shanten <= 0 ? '聴牌' : `${cand.shanten}向聴`}・{cand.shanten <= 0 ? '待ち' : '受け入れ'} {cand.ukeire}枚
          </span>
        )}
      </div>
      <div className="after-hand__tiles">
        {after.tiles.map((t) => (
          <Tile key={t.id} tile={t} size="meld" />
        ))}
        {after.meld && (
          <span className="after-hand__meld">
            {after.meld.map((t) => (
              <Tile key={t.id} tile={t} size="meld" />
            ))}
          </span>
        )}
        {after.discarded && (
          <span className="after-hand__cut">
            <span className="muted">切り</span>
            <Tile tile={after.discarded} size="meld" />
          </span>
        )}
      </div>
      {kinds.length > 0 && (
        <div className="after-hand__waits">
          <span className="muted">{cand!.shanten <= 0 ? '待ち' : '有効牌'}</span>
          {kinds.map((k) => (
            <Tile key={k} tile={{ id: -100 - k, kind: k, red: false }} size="mini" />
          ))}
        </div>
      )}
    </div>
  )
}
