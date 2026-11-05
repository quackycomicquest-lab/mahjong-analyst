/**
 * 局の結果・対局の結果
 */
import type { GameResult, RoundResult } from '../engine/game/types'
import { Melds } from './Board'
import { Tile } from './Tile'
import { DRAW_REASONS, LIMIT_NAMES, signed } from './labels'
import type { EvalEntry, PlayerInfo } from './useGame'

export function RoundResultModal({
  result,
  players,
  willEnd,
  onNext,
}: {
  result: RoundResult
  players: PlayerInfo[]
  willEnd: boolean
  onNext: () => void
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="局の結果">
      <div className="modal__card">
        {result.type === 'agari' ? (
          result.wins.map((w, i) => {
            const v = w.value
            const sorted = w.hand.filter((t) => t.id !== w.winTile.id).sort((a, b) => a.kind - b.kind)
            return (
              <div key={i} className="win">
                <h2 className="win__title">
                  {players[w.seat].name} {w.from === null ? 'ツモ' : 'ロン'}
                  {w.from !== null && <span className="muted">（放銃：{players[w.from].name}）</span>}
                </h2>
                <div className="win__hand">
                  {sorted.map((t) => (
                    <Tile key={t.id} tile={t} size="meld" />
                  ))}
                  <span className="win__gap" />
                  <Tile tile={w.winTile} size="meld" highlight />
                  <Melds melds={w.melds} owner={w.seat} size="meld" />
                </div>
                <ul className="yaku">
                  {v.yaku.map((y) => (
                    <li key={y.id}>
                      <span>{y.name}</span>
                      <span>{v.yakumanMultiplier > 0 ? (y.han >= 26 ? 'ダブル役満' : '役満') : `${y.han}翻`}</span>
                    </li>
                  ))}
                </ul>
                <p className="win__total">
                  {v.yakumanMultiplier > 0 ? '' : `${v.han}翻 ${v.fu}符 `}
                  {LIMIT_NAMES[v.level] ?? ''} <b>{v.payment.total.toLocaleString()}点</b>
                </p>
              </div>
            )
          })
        ) : (
          <div className="draw">
            <h2>{DRAW_REASONS[result.reason]}</h2>
            {result.reason === 'exhaustive' && (
              <p>
                聴牌：{players.filter((p) => result.tenpai[p.seat]).map((p) => p.name).join('、') || 'なし'}
                {result.nagashi.length > 0 && ` ／ 流し満貫：${result.nagashi.map((s) => players[s].name).join('、')}`}
              </p>
            )}
          </div>
        )}
        <table className="deltas">
          <tbody>
            {players.map((p) => (
              <tr key={p.seat}>
                <th>{p.name}</th>
                <td className={result.deltas[p.seat] > 0 ? 'plus' : result.deltas[p.seat] < 0 ? 'minus' : ''}>
                  {signed(result.deltas[p.seat])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal__buttons">
          <button type="button" className="btn btn--riichi" autoFocus onClick={onNext}>
            {willEnd ? '最終結果へ' : '次の局へ'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function GameResultModal({
  result,
  players,
  evals,
  onRestart,
  onTitle,
}: {
  result: GameResult
  players: PlayerInfo[]
  evals: EvalEntry[]
  onRestart: () => void
  onTitle: () => void
}) {
  const order = [...players].sort((a, b) => result.ranks[a.seat] - result.ranks[b.seat])
  // 対局の振り返り（打牌評価のまとめ）
  const scored = evals.filter((e) => e.evaluation?.score != null)
  const avg = scored.length ? scored.reduce((n, e) => n + e.evaluation!.score!, 0) / scored.length : null
  const totalLoss = scored.reduce((n, e) => n + (e.evaluation!.loss ?? 0), 0)
  const worst = [...scored].sort((a, b) => a.evaluation!.score! - b.evaluation!.score!).slice(0, 3)
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="対局結果">
      <div className="modal__card">
        <h2>対局終了</h2>
        <ol className="ranking">
          {order.map((p) => (
            <li key={p.seat} className={p.seat === 0 ? 'is-me' : ''}>
              <span className="ranking__rank">{result.ranks[p.seat] + 1}位</span>
              <span className="ranking__name">{p.name}</span>
              <span className="ranking__points">{result.finalPoints[p.seat].toLocaleString()}点</span>
            </li>
          ))}
        </ol>
        {avg !== null && (
          <div className="report">
            <h3>あなたの判断の振り返り</h3>
            <p>
              評価した判断 {scored.length}回 ／ 平均 <b>{avg.toFixed(1)}点</b> ／ 判断損失の合計 {totalLoss.toLocaleString()}点
              （好判断 {scored.filter((e) => e.evaluation!.score! >= 90).length}回・要復習{' '}
              {scored.filter((e) => e.evaluation!.score! < 50).length}回）
            </p>
            {worst.length > 0 && worst[0].evaluation!.score! < 90 && (
              <ul className="report__worst">
                {worst.map((e) => (
                  <li key={e.decisionId}>
                    {e.evaluation!.decision === 'discard' || !e.evaluation!.decision ? `${e.label}切り` : e.label}：{e.evaluation!.score}点（最善は {e.evaluation!.best?.label}）— {e.evaluation!.improve[0] ?? ''}
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
