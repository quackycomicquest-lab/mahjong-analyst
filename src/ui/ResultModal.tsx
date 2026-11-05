/**
 * 局の結果・対局の結果
 *
 * 和了の局は、点数を見せる前に点数計算テスト（4択）を出す（設定でオフにできる）。
 * 答えた後に役・翻・符・符の内訳を見せ、最後に点数の移動を表示する。
 */
import { useMemo, useState } from 'react'
import { makeScoreQuiz, SITUATIONAL_YAKU } from '../engine/coach/scoreQuiz'
import type { GameResult, RoundInfo, RoundResult, WinRecord } from '../engine/game/types'
import type { TileKind } from '../engine/rules/tile'
import type { QuizRecord } from '../storage/db'
import { Melds } from './Board'
import { Tile } from './Tile'
import { DRAW_REASONS, LIMIT_NAMES, seatWind, signed, WIND_NAMES } from './labels'
import type { EvalEntry, PlayerInfo } from './useGame'

interface RoundResultProps {
  result: RoundResult
  players: PlayerInfo[]
  willEnd: boolean
  onNext: () => void
  round: RoundInfo
  roundIndex: number
  doraIndicators: TileKind[]
  quizEnabled: boolean
  onQuizAnswered: (q: Omit<QuizRecord, 'id' | 'gameId' | 'at'>) => void
}

export function RoundResultModal(props: RoundResultProps) {
  const { result, players, willEnd, onNext, round, roundIndex, doraIndicators, quizEnabled } = props
  const wins = result.type === 'agari' ? result.wins : []
  // 点数計算テストを何問目まで終えたか（テストなしなら最初から全部終えた扱い）
  const [quizDone, setQuizDone] = useState(quizEnabled ? 0 : wins.length)

  if (result.type === 'agari' && quizDone < wins.length) {
    const w = wins[quizDone]
    return (
      <div className="modal modal--result" role="dialog" aria-modal="true" aria-label="点数計算テスト">
        <div className="result-card">
          <ScoreQuizCard
            key={quizDone}
            win={w}
            index={quizDone}
            total={wins.length}
            players={players}
            round={round}
            roundIndex={roundIndex}
            doraIndicators={doraIndicators}
            uraIndicators={result.uraDoraIndicators}
            onAnswered={props.onQuizAnswered}
            onNext={() => setQuizDone((n) => n + 1)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="modal modal--result" role="dialog" aria-modal="true" aria-label="局の結果">
      <div className="result-card">
        {result.type === 'agari' ? (
          wins.map((w, i) => (
            <div key={i} className="win">
              <WinHeader win={w} players={players} />
              <WinHand win={w} />
              <IndicatorRow doraIndicators={doraIndicators} uraIndicators={result.uraDoraIndicators} />
              <WinBreakdown win={w} />
            </div>
          ))
        ) : (
          <div className="draw">
            <div className="result-banner result-banner--draw">{DRAW_REASONS[result.reason]}</div>
            {result.reason === 'exhaustive' && (
              <p>
                聴牌：{players.filter((p) => result.tenpai[p.seat]).map((p) => p.name).join('、') || 'なし'}
                {result.nagashi.length > 0 && ` ／ 流し満貫：${result.nagashi.map((s) => players[s].name).join('、')}`}
              </p>
            )}
          </div>
        )}
        <div className="deltas-grid">
          {players.map((p) => {
            const d = result.deltas[p.seat]
            return (
              <div key={p.seat} className={`delta-chip ${p.seat === 0 ? 'is-me' : ''}`}>
                <span className="delta-chip__wind">{seatWind(p.seat, round.dealer)}</span>
                <span className="delta-chip__name">{p.name}</span>
                <span className={`delta-chip__value ${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}`}>{d === 0 ? '±0' : signed(d)}</span>
              </div>
            )
          })}
        </div>
        <div className="modal__buttons">
          <button type="button" className="btn btn--riichi btn--wide" autoFocus onClick={onNext}>
            {willEnd ? '最終結果へ' : '次の局へ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function WinHeader({ win, players }: { win: WinRecord; players: PlayerInfo[] }) {
  return (
    <div className="win__header">
      <span className={`result-banner ${win.from === null ? 'result-banner--tsumo' : 'result-banner--ron'}`}>
        {win.from === null ? 'ツモ' : 'ロン'}
      </span>
      <span className="win__who">
        {players[win.seat].name}
        {win.from !== null && <span className="muted">（放銃：{players[win.from].name}）</span>}
      </span>
    </div>
  )
}

function WinHand({ win }: { win: WinRecord }) {
  const sorted = win.hand.filter((t) => t.id !== win.winTile.id).sort((a, b) => a.kind - b.kind || Number(b.red) - Number(a.red))
  return (
    <div className="win__hand">
      {sorted.map((t) => (
        <Tile key={t.id} tile={t} size="meld" />
      ))}
      <span className="win__gap" />
      <Tile tile={win.winTile} size="meld" highlight />
      {win.melds.length > 0 && <Melds melds={win.melds} owner={win.seat} size="meld" />}
    </div>
  )
}

function IndicatorRow({ doraIndicators, uraIndicators }: { doraIndicators: TileKind[]; uraIndicators: TileKind[] }) {
  return (
    <div className="win__indicators">
      <span className="muted">ドラ表示</span>
      {doraIndicators.map((k, i) => (
        <Tile key={`d${i}`} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
      ))}
      {uraIndicators.length > 0 && (
        <>
          <span className="muted">裏ドラ表示</span>
          {uraIndicators.map((k, i) => (
            <Tile key={`u${i}`} tile={{ id: -100 - i, kind: k, red: false }} size="mini" />
          ))}
        </>
      )}
    </div>
  )
}

function WinBreakdown({ win }: { win: WinRecord }) {
  const v = win.value
  return (
    <>
      <ul className="yaku">
        {v.yaku.map((y) => (
          <li key={y.id}>
            <span>{y.name}</span>
            <span>{v.yakumanMultiplier > 0 ? (y.han >= 26 ? 'ダブル役満' : '役満') : `${y.han}翻`}</span>
          </li>
        ))}
      </ul>
      <div className="win__total">
        <span className="win__hanfu">{v.yakumanMultiplier > 0 ? '' : `${v.han}翻 ${v.fu}符`}</span>
        {LIMIT_NAMES[v.level] && <span className="limit-badge">{LIMIT_NAMES[v.level]}</span>}
        <span className="win__points">{v.payment.total.toLocaleString()}</span>
        <span className="muted">点</span>
      </div>
    </>
  )
}

function ScoreQuizCard({
  win,
  index,
  total,
  players,
  round,
  roundIndex,
  doraIndicators,
  uraIndicators,
  onAnswered,
  onNext,
}: {
  win: WinRecord
  index: number
  total: number
  players: PlayerInfo[]
  round: RoundInfo
  roundIndex: number
  doraIndicators: TileKind[]
  uraIndicators: TileKind[]
  onAnswered: RoundResultProps['onQuizAnswered']
  onNext: () => void
}) {
  const tsumo = win.from === null
  const quiz = useMemo(() => makeScoreQuiz(win.value, tsumo, roundIndex * 31 + win.seat + 1), [win, tsumo, roundIndex])
  const [chosen, setChosen] = useState<string | null>(null)
  const v = win.value
  const situational = v.yaku.filter((y) => SITUATIONAL_YAKU.has(y.id)).map((y) => y.name)
  const dealer = win.seat === round.dealer

  const answer = (c: string) => {
    if (chosen) return
    setChosen(c)
    onAnswered({
      roundIndex,
      seat: win.seat,
      correct: c === quiz.answer,
      answer: c,
      expected: quiz.answer,
      han: v.han,
      fu: v.fu,
      yakuman: v.yakumanMultiplier > 0,
    })
  }

  return (
    <div className="quiz">
      <div className="quiz__title">
        点数計算テスト{total > 1 ? `（${index + 1}/${total}）` : ''}
      </div>
      <WinHeader win={win} players={players} />
      <WinHand win={win} />
      <div className="quiz__facts">
        <span className="fact">{dealer ? '親' : '子'}</span>
        <span className="fact">場風 {WIND_NAMES[round.wind]}</span>
        <span className="fact">自風 {seatWind(win.seat, round.dealer)}</span>
        {situational.map((s) => (
          <span key={s} className="fact fact--accent">
            {s}
          </span>
        ))}
      </div>
      <IndicatorRow doraIndicators={doraIndicators} uraIndicators={uraIndicators} />
      <p className="quiz__question">
        この和了は何点？<span className="muted">（本場・供託は含めない。ツモは「子の支払い-親の支払い」）</span>
      </p>
      <div className="quiz__choices">
        {quiz.choices.map((c) => {
          const state = !chosen ? '' : c === quiz.answer ? 'is-correct' : c === chosen ? 'is-wrong' : 'is-dim'
          return (
            <button key={c} type="button" className={`quiz__choice ${state}`} disabled={!!chosen} onClick={() => answer(c)}>
              {c}
            </button>
          )
        })}
      </div>
      {chosen && (
        <div className="quiz__reveal">
          <div className={`quiz__verdict ${chosen === quiz.answer ? 'is-correct' : 'is-wrong'}`}>
            {chosen === quiz.answer ? '◯ 正解' : `✕ 不正解（正解は ${quiz.answer}）`}
          </div>
          <WinBreakdown win={win} />
          {v.fuDetails.length > 0 && v.yakumanMultiplier === 0 && v.fu !== 25 && (
            <details className="fu-details">
              <summary>符の内訳</summary>
              <ul>
                {v.fuDetails.map((f, i) => (
                  <li key={i}>
                    <span>{f.reason}</span>
                    <span>{f.fu}符</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">合計を10符単位に切り上げて {v.fu}符</p>
            </details>
          )}
          <div className="modal__buttons">
            <button type="button" className="btn btn--riichi btn--wide" autoFocus onClick={onNext}>
              {index + 1 < total ? '次の和了へ' : '結果へ'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function GameResultModal({
  result,
  players,
  evals,
  quizLog,
  onRestart,
  onTitle,
}: {
  result: GameResult
  players: PlayerInfo[]
  evals: EvalEntry[]
  quizLog: QuizRecord[]
  onRestart: () => void
  onTitle: () => void
}) {
  const order = [...players].sort((a, b) => result.ranks[a.seat] - result.ranks[b.seat])
  // 対局の振り返り（判断評価のまとめ）
  const scored = evals.filter((e) => e.evaluation?.score != null)
  const avg = scored.length ? scored.reduce((n, e) => n + e.evaluation!.score!, 0) / scored.length : null
  const totalLoss = scored.reduce((n, e) => n + (e.evaluation!.loss ?? 0), 0)
  const worst = [...scored].sort((a, b) => a.evaluation!.score! - b.evaluation!.score!).slice(0, 3)
  const quizCorrect = quizLog.filter((q) => q.correct).length
  return (
    <div className="modal modal--result" role="dialog" aria-modal="true" aria-label="対局結果">
      <div className="result-card">
        <div className="result-banner result-banner--final">対局終了</div>
        <ol className="ranking">
          {order.map((p) => (
            <li key={p.seat} className={`rank-${result.ranks[p.seat] + 1} ${p.seat === 0 ? 'is-me' : ''}`}>
              <span className="ranking__rank">{result.ranks[p.seat] + 1}</span>
              <span className="ranking__name">{p.name}</span>
              <span className="ranking__points">{result.finalPoints[p.seat].toLocaleString()}</span>
            </li>
          ))}
        </ol>
        {(avg !== null || quizLog.length > 0) && (
          <div className="report">
            <h3>あなたの振り返り</h3>
            {avg !== null && (
              <p>
                評価した判断 {scored.length}回 ／ 平均 <b>{avg.toFixed(1)}点</b> ／ 判断損失の合計 {totalLoss.toLocaleString()}点
                （好判断 {scored.filter((e) => e.evaluation!.score! >= 90).length}回・要復習{' '}
                {scored.filter((e) => e.evaluation!.score! < 50).length}回）
              </p>
            )}
            {quizLog.length > 0 && (
              <p>
                点数計算テスト <b>{quizCorrect} / {quizLog.length}問 正解</b>（正答率 {Math.round((quizCorrect / quizLog.length) * 100)}%）
              </p>
            )}
            {worst.length > 0 && worst[0].evaluation!.score! < 90 && (
              <ul className="report__worst">
                {worst.map((e) => (
                  <li key={e.decisionId}>
                    {e.evaluation!.decision === 'discard' || !e.evaluation!.decision ? `${e.label}切り` : e.label}：{e.evaluation!.score}点（最善は{' '}
                    {e.evaluation!.best?.label}）— {e.evaluation!.improve[0] ?? ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="modal__buttons">
          <button type="button" className="btn btn--plain" onClick={onTitle}>
            タイトルへ
          </button>
          <button type="button" className="btn btn--riichi" autoFocus onClick={onRestart}>
            もう一度
          </button>
        </div>
      </div>
    </div>
  )
}
