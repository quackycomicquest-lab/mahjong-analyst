/**
 * 対局画面（仕様 §2-2, §8-2）
 * Mac：横長の卓＋右側に評価パネル
 * iPhone：横画面で、卓を中央・手牌を下いっぱい・操作ボタンを手牌の右上・AI評価を右上に置く（雀魂のスマートフォン版と同じ配置）。
 *         縦向きのときは横向きにするよう案内する（縦のまま使うこともできる）
 * 縦長の画面・幅の狭いウィンドウ：縦長の卓＋下部に折りたためる評価パネル
 */
import { useState } from 'react'
import { Board } from './Board'
import { Controls } from './Controls'
import { Tile } from './Tile'
import { EvaluationPanel } from './EvaluationPanel'
import { GameResultModal, RoundResultModal } from './ResultModal'
import { roundLabel } from './labels'
import { SOUND_LABELS, unlockAudio, type SoundSetting } from './sound'
import { AI_SPEED_LABELS, type GameSettings, type useGame } from './useGame'

type GameHandle = ReturnType<typeof useGame>

export function GameScreen({
  handle,
  aiSpeed,
  onSpeedChange,
  sound,
  onSoundChange,
  onQuit,
}: {
  handle: GameHandle
  aiSpeed: GameSettings['aiSpeed']
  onSpeedChange: (s: GameSettings['aiSpeed']) => void
  sound: SoundSetting
  onSoundChange: (s: SoundSetting) => void
  onQuit: () => void
}) {
  const { game, view, players, evals, act, start, saveError, quizEnabled, recordQuiz, quizLog } = handle
  // iPhone の下部パネル：開いた場面（uiKey）の間だけ開く。自分が判断する場面になったら自動で閉じて手牌を見せる
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [portraitOk, setPortraitOk] = useState(false)
  if (!game || !view) return null
  const ph = game.phase
  const activeSeat = ph.type === 'turn' ? ph.seat : ph.type === 'response' ? ph.actor : null
  const r = view.round
  // 自分が判断する場面ごとに操作部品を作り直す（AIの行動では作り直さない）
  const uiKey =
    ph.type === 'turn' && ph.seat === 0
      ? `turn-${view.roundIndex}-${view.hand.length}-${view.drawn?.id ?? 'call'}`
      : ph.type === 'response'
        ? `resp-${view.roundIndex}-${ph.tile.id}`
        : `idle-${view.roundIndex}`

  return (
    <div className="game">
      <header className="topbar">
        <span className="topbar__brand">MAHJONG ANALYST</span>
        <span className="topbar__round">{roundLabel(r.wind, r.dealer, r.honba)}</span>
        {/* iPhone では卓の中央が狭いので、局の情報をここに出す */}
        <span className="topbar__info">
          供託{r.kyoutaku}・残{view.wallRemaining}
          <span className="topbar__dora" aria-label="ドラ表示牌">
            {view.doraIndicators.map((k, i) => (
              <Tile key={i} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
            ))}
          </span>
        </span>
        <button
          type="button"
          className="btn btn--ghost topbar__sound"
          title="打牌音・発声を切り替える（効果音＋発声→効果音だけ→なし）"
          onClick={() => {
            unlockAudio()
            const i = SOUND_LABELS.findIndex(([v]) => v === sound)
            onSoundChange(SOUND_LABELS[(i + 1) % SOUND_LABELS.length][0])
          }}
        >
          <span aria-hidden>{sound === 'all' ? '🔊' : sound === 'se' ? '🔉' : '🔇'}</span>
          <span className="topbar__sound-text">{sound === 'all' ? ' 音声' : sound === 'se' ? ' 効果音' : ' 音なし'}</span>
        </button>
        <button
          type="button"
          className="btn btn--ghost topbar__speed"
          title="AIの打牌の速さを切り替える（速い→普通→遅め）"
          onClick={() => {
            const i = AI_SPEED_LABELS.findIndex(([v]) => v === aiSpeed)
            onSpeedChange(AI_SPEED_LABELS[(i + 1) % AI_SPEED_LABELS.length][0])
          }}
        >
          速さ：{AI_SPEED_LABELS.find(([v]) => v === aiSpeed)?.[1] ?? '普通'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            if (window.confirm('対局をやめてタイトルに戻りますか？')) onQuit()
          }}
        >
          終了
        </button>
      </header>

      {saveError && (
        <div className="save-error" role="status">
          {saveError}（対局は続けられます）
        </div>
      )}
      <main className="table-area">
        <Board view={view} players={players} activeSeat={activeSeat} />
        <Controls key={uiKey} view={view} players={players} activeSeat={activeSeat} onAct={act} />
      </main>

      <aside className="side">
        <EvaluationPanel
          evals={evals}
          players={players}
          collapsed={expandedKey !== uiKey}
          onToggle={() => setExpandedKey(expandedKey === uiKey ? null : uiKey)}
        />
      </aside>

      <div className={`rotate-hint ${portraitOk ? 'is-dismissed' : ''}`} role="dialog" aria-label="横向きの案内">
        <div className="rotate-hint__icon" aria-hidden />
        <p>
          iPhoneを横向きにしてください。
          <br />
          <span className="muted small">横画面で、卓と手牌を大きく表示します。</span>
        </p>
        <button type="button" className="btn btn--plain" onClick={() => setPortraitOk(true)}>
          縦のまま使う
        </button>
      </div>

      {ph.type === 'roundEnd' && (
        <RoundResultModal
          key={view.roundIndex}
          result={ph.result}
          players={players}
          willEnd={ph.next === null}
          onNext={() => act({ type: 'nextRound' })}
          round={view.round}
          roundIndex={view.roundIndex}
          doraIndicators={view.doraIndicators}
          quizEnabled={quizEnabled}
          onQuizAnswered={recordQuiz}
        />
      )}
      {ph.type === 'gameEnd' && (
        <GameResultModal
          result={ph.result}
          players={players}
          evals={evals}
          quizLog={quizLog}
          onRestart={start}
          onTitle={onQuit}
        />
      )}
    </div>
  )
}
