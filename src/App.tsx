import { useEffect, useState } from 'react'
import { DEFAULT_OPPONENTS } from './engine/ai/profile'
import { latestUnfinishedGame, listEvaluations, type GameRecord } from './storage/db'
import { AnalysisScreen, type ReviewRequest } from './ui/AnalysisScreen'
import { GameScreen } from './ui/GameScreen'
import { HistoryScreen } from './ui/HistoryScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { useGame, type GameSettings } from './ui/useGame'

const STORAGE_KEY = 'mahjong-analyst:settings'

function loadSettings(): GameSettings {
  const fallback: GameSettings = { length: 'hanchan', strength: 2, evalMode: 'auto', aiSpeed: 'normal' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export default function App() {
  const [settings, setSettings] = useState<GameSettings>(loadSettings)
  const [screen, setScreen] = useState<'title' | 'game' | 'history' | 'analysis' | 'review'>('title')
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest>({ mode: 'due' })
  const [unfinished, setUnfinished] = useState<GameRecord | null>(null)
  const handle = useGame(settings)

  // タイトルに戻るたびに「続きから」の対象を探す
  useEffect(() => {
    if (screen !== 'title') return
    latestUnfinishedGame().then(
      (g) => setUnfinished(g ?? null),
      () => setUnfinished(null),
    )
  }, [screen])

  const resume = async (record: GameRecord) => {
    const stored = await listEvaluations(record.id).catch(() => [])
    handle.resume(record, stored)
    setScreen('game')
  }

  const update = (patch: Partial<GameSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* 保存できなくても続行 */
    }
  }

  if (screen === 'game' && handle.game) return <GameScreen handle={handle} onQuit={() => setScreen('title')} />
  if (screen === 'history') return <HistoryScreen onBack={() => setScreen('title')} onResume={resume} />
  if (screen === 'analysis') {
    return (
      <AnalysisScreen
        onBack={() => setScreen('title')}
        onReview={(r) => {
          setReviewRequest(r)
          setScreen('review')
        }}
      />
    )
  }
  if (screen === 'review') return <ReviewScreen request={reviewRequest} onExit={() => setScreen('analysis')} />

  return (
    <div className="title">
      <div className="title__card">
        <h1 className="title__brand">MAHJONG ANALYST</h1>
        <p className="title__tagline">Think. Play. Improve.</p>
        <p className="title__lead">自分で考えて打ち、打牌のあとにAIの答え合わせを受ける麻雀トレーニング。</p>

        <fieldset className="field">
          <legend>対局形式</legend>
          <Segmented
            value={settings.length}
            options={[
              ['tonpuu', '東風戦'],
              ['hanchan', '東南戦'],
            ]}
            onChange={(v) => update({ length: v as GameSettings['length'] })}
          />
        </fieldset>
        <fieldset className="field">
          <legend>AIの強さ</legend>
          <Segmented
            value={String(settings.strength)}
            options={[
              ['1', '初級'],
              ['2', '中級'],
              ['3', '上級'],
            ]}
            onChange={(v) => update({ strength: Number(v) as GameSettings['strength'] })}
          />
        </fieldset>
        <fieldset className="field">
          <legend>評価の精度</legend>
          <Segmented
            value={settings.evalMode}
            options={[
              ['auto', '端末に合わせる'],
              ['full', '高精度'],
              ['light', '軽量'],
            ]}
            onChange={(v) => update({ evalMode: v as GameSettings['evalMode'] })}
          />
        </fieldset>

        <fieldset className="field">
          <legend>和了時の点数計算テスト</legend>
          <Segmented
            value={settings.scoreQuiz === false ? 'off' : 'on'}
            options={[
              ['on', '出す'],
              ['off', '出さない'],
            ]}
            onChange={(v) => update({ scoreQuiz: v === 'on' })}
          />
        </fieldset>
        <fieldset className="field">
          <legend>AIの打牌の速さ</legend>
          <Segmented
            value={settings.aiSpeed}
            options={[
              ['normal', '普通'],
              ['fast', '速い'],
            ]}
            onChange={(v) => update({ aiSpeed: v as GameSettings['aiSpeed'] })}
          />
        </fieldset>

        <ul className="opponents">
          {DEFAULT_OPPONENTS.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              <span>{p.description}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="btn btn--riichi btn--large"
          onClick={() => {
            handle.start()
            setScreen('game')
          }}
        >
          対局を始める
        </button>
        {unfinished && (
          <button type="button" className="btn btn--call btn--large" onClick={() => resume(unfinished)}>
            続きから（{unfinished.roundLabel}・{unfinished.settings.length === 'tonpuu' ? '東風戦' : '東南戦'}）
          </button>
        )}
        <button type="button" className="btn btn--plain btn--large" onClick={() => setScreen('analysis')}>
          弱点分析・復習問題
        </button>
        <button type="button" className="btn btn--plain btn--large" onClick={() => setScreen('history')}>
          対局履歴・振り返り
        </button>
      </div>
    </div>
  )
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className="segmented__item" onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
