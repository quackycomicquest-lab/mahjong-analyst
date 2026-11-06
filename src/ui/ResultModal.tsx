/**
 * 局の結果・対局の結果
 *
 * 和了の局は、点数を見せる前に点数計算テスト（点数表のマスを選ぶ）を出す（設定でオフにできる）。
 * 答えた後に役・翻・符・符の内訳を見せ、最後に点数の移動を表示する。
 */
import { useMemo, useState } from 'react'
import {
  actualCellId,
  allCells,
  answerLabel,
  scoreTableFor,
  SITUATIONAL_YAKU,
  type ScoreCell,
  type ScoreTable,
} from '../engine/coach/scoreQuiz'
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
        <div className="result-card result-card--quiz">
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
  const v = win.value
  const table = useMemo(() => scoreTableFor(v, tsumo), [v, tsumo])
  const answer = answerLabel(v, tsumo)
  const actualId = actualCellId(v)
  const [chosen, setChosen] = useState<ScoreCell | null>(null)
  const situational = v.yaku.filter((y) => SITUATIONAL_YAKU.has(y.id)).map((y) => y.name)
  const dealer = win.seat === round.dealer
  const correct = chosen !== null && chosen.label === answer

  const pick = (c: ScoreCell) => {
    if (chosen || !c.valid) return
    setChosen(c)
    onAnswered({
      roundIndex,
      seat: win.seat,
      correct: c.label === answer,
      answer: c.label,
      expected: answer,
      han: v.han,
      fu: v.fu,
      yakuman: v.yakumanMultiplier > 0,
    })
  }

  const actualName =
    v.yakumanMultiplier > 0
      ? (allCells(table).find((c) => c.id === actualId)?.limit ?? '役満')
      : `${v.han}翻${v.fu}符${LIMIT_NAMES[v.level] ? `（${LIMIT_NAMES[v.level]}）` : ''}`

  return (
    <div className="quiz">
      <div className="quiz__main">
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
        {!chosen ? (
          <p className="quiz__question">
            この和了は何点？ 点数表のマスを選んでください。
            <span className="muted">（本場・供託は含めない）</span>
          </p>
        ) : (
          <div className="quiz__reveal">
            <div className={`quiz__verdict ${correct ? 'is-correct' : 'is-wrong'}`}>
              {correct
                ? chosen.id === actualId || (chosen.limit && chosen.limit === LIMIT_NAMES[v.level])
                  ? `◯ 正解（${answer}）`
                  : `◯ 正解（同じ点数のマス。この和了は ${actualName}）`
                : `✕ 不正解（正解は ${answer}：${actualName}）`}
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
      <ScoreTablePicker
        table={table}
        dealer={dealer}
        tsumo={tsumo}
        chosenId={chosen?.id ?? null}
        answer={chosen ? answer : null}
        actualId={chosen ? actualId : null}
        onPick={pick}
      />
    </div>
  )
}

/** 点数表（符×翻のマスと、満貫以上の欄）。答えた後は正解のマスを示す */
function ScoreTablePicker({
  table,
  dealer,
  tsumo,
  chosenId,
  answer,
  actualId,
  onPick,
}: {
  table: ScoreTable
  dealer: boolean
  tsumo: boolean
  chosenId: string | null
  /** 答えた後だけ渡す */
  answer: string | null
  actualId: string | null
  onPick: (c: ScoreCell) => void
}) {
  const answered = answer !== null
  const cellButton = (c: ScoreCell, withName: boolean) => {
    const state = !answered
      ? ''
      : [
          c.label === answer ? 'is-correct' : '',
          c.id === chosenId && c.label !== answer ? 'is-wrong' : '',
          c.id === chosenId ? 'is-chosen' : '',
          c.id === actualId ? 'is-actual' : '',
        ].join(' ')
    // 親のツモは「○オール」を表の見出しに書き、マスは数字だけにする
    const text = c.label.replace('オール', '')
    const name = c.yakuman ? c.limit : `${c.han}翻${c.fu}符`
    return (
      <button
        type="button"
        className={`score-cell ${c.limit ? 'is-limit' : ''} ${state}`}
        disabled={answered || !c.valid}
        aria-label={c.valid ? `${withName ? c.limit : name} ${c.label}` : `${name}（なし）`}
        onClick={() => onPick(c)}
      >
        {withName && <span className="score-cell__name">{c.limit}</span>}
        {c.valid ? (
          !withName && c.limit ? <span className="score-cell__mangan">満貫</span> : <span className="score-cell__pts">{text}</span>
        ) : (
          '—'
        )}
      </button>
    )
  }
  return (
    <div className="score-table" role="group" aria-label="点数表">
      <div className="score-table__caption">
        {dealer ? '親' : '子'}の{tsumo ? 'ツモ' : 'ロン'}
        <span className="muted">
          {tsumo ? (dealer ? '（1人あたり・○オール）' : '（子の支払い-親の支払い）') : '（放銃者の支払い）'}
        </span>
      </div>
      <div className="score-table__body">
        <table className="score-grid">
          <thead>
            <tr>
              <th scope="col">符＼翻</th>
              {table.hanCols.map((h) => (
                <th key={h} scope="col">
                  {h}翻
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.grid.map((row, i) => (
              <tr key={table.fuRows[i]}>
                <th scope="row">{table.fuRows[i]}符</th>
                {row.map((c) => (
                  <td key={c.id}>{cellButton(c, false)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="score-limits">{table.limits.map((c) => <div key={c.id}>{cellButton(c, true)}</div>)}</div>
      </div>
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
