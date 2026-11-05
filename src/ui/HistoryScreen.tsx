/**
 * 対局履歴と打牌の振り返り（仕様 §3-4, §7）
 */
import { useEffect, useState } from 'react'
import { listEvaluations, listGames, type GameRecord, type StoredEvaluation } from '../storage/db'
import type { Seat } from '../engine/game/types'
import { EvaluationDetail } from './EvaluationPanel'
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
                  <span className="muted">（{g.summary.evaluated}打）</span>
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

  useEffect(() => {
    listEvaluations(game.id).then(setRecords, () => setRecords([]))
  }, [game.id])

  const players: PlayerInfo[] = game.playerNames.map((name, seat) => ({ seat: seat as Seat, name, profile: null }))
  const shown = (records ?? []).filter((r) => !onlyMistakes || (r.evaluation.score ?? 100) < 70)
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
          評価した打牌 {game.summary.evaluated}回 ／ 平均{' '}
          <b>{game.summary.averageScore != null ? `${game.summary.averageScore.toFixed(1)}点` : '—'}</b> ／ 判断損失の合計{' '}
          {game.summary.totalLoss.toLocaleString()}点
        </p>
        <label className="toggle">
          <input type="checkbox" checked={onlyMistakes} onChange={(e) => setOnlyMistakes(e.target.checked)} />
          70点未満の打牌だけ表示
        </label>
      </section>

      <div className="review">
        <div className="review__list">
          {records === null && <p className="muted">読み込み中…</p>}
          {records && shown.length === 0 && <p className="muted">表示する打牌がありません。</p>}
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
              <EvaluationDetail ev={current.evaluation} label={current.label} players={players} level={level} setLevel={setLevel} />
            </>
          ) : (
            <p className="muted">打牌を選ぶと、そのときの局面と評価が表示されます。</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** 評価した局面（打牌直前の手牌）。選んだ牌と最善の牌に印を付ける */
function Position({ record }: { record: StoredEvaluation }) {
  const v = record.snapshot
  const a = record.action
  const chosenId = a.type === 'discard' ? a.tileId : -1
  const bestKind = record.evaluation.best?.kind
  const hand = [...v.hand].sort((x, y) => x.kind - y.kind || Number(y.red) - Number(x.red))
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
      </div>
      <p className="position__legend muted">黄色の枠：あなたの打牌 ／ 枠線：最善の打牌</p>
    </div>
  )
}
