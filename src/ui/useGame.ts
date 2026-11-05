/**
 * 対局の進行管理（UI 用フック）
 *
 * - 席0が自分、席1〜3が AI。AI の手番・応答は少し間を置いて自動で進める。
 * - 自分が判断（打牌・鳴き・スキップ・和了・カン）したら、直前の局面スナップショットを評価 Worker に送り、
 *   対局はそのまま進める（評価を待たない。仕様 §5-3）。
 * - 評価結果は局面ID（decisionId）と結び付けて保持する。
 * - 対局（seed＋全行動）と打牌評価は IndexedDB に自動保存し、途中からでも再開できる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createAiBot } from '../engine/ai/player'
import { DEFAULT_OPPONENTS, type AiProfile } from '../engine/ai/profile'
import type { Evaluation } from '../engine/evaluator/types'
import { MahjongGame } from '../engine/game/game'
import type { Action, Seat } from '../engine/game/types'
import { getPlayerView, type PlayerView } from '../engine/game/view'
import { createRng } from '../engine/game/wall'
import {
  saveEvaluation,
  saveGame,
  type GameRecord,
  type StoredEvaluation,
  type StoredSettings,
} from '../storage/db'
import { actionLabel, roundLabel } from './labels'
import { defaultEvaluationMode, requestEvaluation } from './evaluatorClient'

export const HUMAN: Seat = 0

export type GameSettings = StoredSettings

export interface PlayerInfo {
  seat: Seat
  name: string
  profile: AiProfile | null
}

export interface EvalEntry {
  decisionId: number
  roundIndex: number
  roundLabel: string
  /** 打牌の表示名（例: 東、5萬（立直）） */
  label: string
  evaluation: Evaluation | null
  error: string | null
}

const AI_DELAYS = {
  normal: { turn: 550, response: 250 },
  fast: { turn: 120, response: 60 },
} as const

const SAVE_DEBOUNCE_MS = 400

function makePlayers(strength: GameSettings['strength']): PlayerInfo[] {
  const profiles = DEFAULT_OPPONENTS.map((p) => ({ ...p, strength }))
  return [
    { seat: 0, name: 'あなた', profile: null },
    ...profiles.map((p, i) => ({ seat: (i + 1) as Seat, name: p.name, profile: p })),
  ]
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface Session {
  id: string
  startedAt: string
  /** この対局の設定（強さ・形式は対局中に変わらない） */
  settings: GameSettings
}

/**
 * @param prefs 現在の設定。評価の精度と AI の速さは対局中でもこの値に従う
 */
export function useGame(prefs: GameSettings) {
  const [game, setGame] = useState<MahjongGame | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const botsRef = useRef<Record<number, (v: PlayerView) => Action>>({})
  const [version, setVersion] = useState(0)
  const [evals, setEvals] = useState<EvalEntry[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const strength = session?.settings.strength ?? prefs.strength
  const players = useMemo(() => makePlayers(strength), [strength])

  const setupBots = (seed: number, list: PlayerInfo[]) => {
    const rand = createRng(seed ^ 0x5bd1e995)
    botsRef.current = {}
    for (const p of list) if (p.profile) botsRef.current[p.seat] = createAiBot(p.profile, rand)
  }

  const start = useCallback(() => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0
    const settings = { ...prefs }
    setupBots(seed, makePlayers(settings.strength))
    setSession({ id: newId(), startedAt: new Date().toISOString(), settings })
    setGame(new MahjongGame({ seed, config: { length: settings.length } }))
    setEvals([])
    bump()
  }, [prefs, bump])

  /** 保存した対局を、seed と行動列から再現して続きから打つ */
  const resume = useCallback(
    (record: GameRecord, stored: StoredEvaluation[]) => {
      const g = MahjongGame.replay({ seed: record.seed, config: { length: record.settings.length } }, record.actions)
      setupBots(record.seed + record.actions.length, makePlayers(record.settings.strength))
      setSession({ id: record.id, startedAt: record.startedAt, settings: record.settings })
      setGame(g)
      setEvals(
        stored.map((s) => ({
          decisionId: s.decisionId,
          roundIndex: s.roundIndex,
          roundLabel: s.roundLabel,
          label: s.label,
          evaluation: s.evaluation,
          error: null,
        })),
      )
      bump()
    },
    [bump],
  )

  // AI の行動を自動で進める
  useEffect(() => {
    const g = game
    if (!g) return
    const ph = g.phase
    if (ph.type !== 'turn' && ph.type !== 'response') return
    const aiSeats = g.pendingSeats().filter((s) => s !== HUMAN)
    if (aiSeats.length === 0) return
    const timer = setTimeout(
      () => {
        for (const s of aiSeats) {
          if (!g.pendingSeats().includes(s)) continue
          g.apply(botsRef.current[s](getPlayerView(g, s)))
        }
        bump()
      },
      ph.type === 'turn' ? AI_DELAYS[prefs.aiSpeed].turn : AI_DELAYS[prefs.aiSpeed].response,
    )
    return () => clearTimeout(timer)
  }, [game, version, bump, prefs.aiSpeed])

  // 対局を自動保存（行動のたびに、少しまとめて書き込む）
  useEffect(() => {
    if (!game || !session) return
    const timer = setTimeout(() => {
      const record = buildGameRecord(game, session, players, evals)
      saveGame(record).then(
        () => setSaveError(null),
        (err: Error) => setSaveError(`対局を保存できませんでした（${err.message}）`),
      )
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [game, session, players, evals, version])

  const act = useCallback(
    (action: Action) => {
      const g = game
      if (!g || !session) return
      if (action.type !== 'nextRound' && action.seat === HUMAN) {
        // 判断確定時点のスナップショット（仕様 §3-1）。打牌だけでなく鳴き・スキップ・和了・カンも評価する
        const view = getPlayerView(g, HUMAN)
        const entry: EvalEntry = {
          decisionId: view.decisionId,
          roundIndex: view.roundIndex,
          roundLabel: roundLabel(view.round.wind, view.round.dealer, view.round.honba),
          label: actionLabel(view, action),
          evaluation: null,
          error: null,
        }
        setEvals((prev) => [...prev, entry])
        const mode = prefs.evalMode === 'auto' ? defaultEvaluationMode() : prefs.evalMode
        requestEvaluation(view, action, mode).then(
          (evaluation) => {
            setEvals((prev) => prev.map((e) => (e.decisionId === entry.decisionId ? { ...e, evaluation } : e)))
            // 局面・打牌・評価を保存（仕様 §3-4）
            saveEvaluation({
              gameId: session.id,
              decisionId: entry.decisionId,
              roundIndex: entry.roundIndex,
              roundLabel: entry.roundLabel,
              label: entry.label,
              snapshot: view,
              action,
              evaluation,
              createdAt: new Date().toISOString(),
            }).catch((err: Error) => setSaveError(`評価を保存できませんでした（${err.message}）`))
          },
          (err: Error) =>
            setEvals((prev) => prev.map((e) => (e.decisionId === entry.decisionId ? { ...e, error: err.message } : e))),
        )
      }
      g.apply(action)
      bump()
    },
    [game, session, prefs.evalMode, bump],
  )

  const view = game ? getPlayerView(game, HUMAN) : null
  return { game, version, view, players, evals, saveError, start, resume, act }
}

/** 保存用の対局レコードを作る */
export function buildGameRecord(
  game: MahjongGame,
  session: Session,
  players: PlayerInfo[],
  evals: EvalEntry[],
): GameRecord {
  const ph = game.phase
  const scored = evals.filter((e) => e.evaluation?.score != null)
  const r = game.round
  const now = new Date().toISOString()
  return {
    id: session.id,
    startedAt: session.startedAt,
    updatedAt: now,
    finishedAt: ph.type === 'gameEnd' ? now : null,
    settings: session.settings,
    seed: game.state.seed,
    actions: game.state.actions,
    playerNames: players.map((p) => p.name),
    roundLabel: roundLabel(r.wind, r.dealer, r.honba),
    result: ph.type === 'gameEnd' ? ph.result : null,
    summary: {
      evaluated: scored.length,
      averageScore: scored.length ? scored.reduce((n, e) => n + e.evaluation!.score!, 0) / scored.length : null,
      totalLoss: scored.reduce((n, e) => n + (e.evaluation!.loss ?? 0), 0),
    },
  }
}
