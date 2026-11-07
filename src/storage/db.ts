/**
 * ローカル保存（IndexedDB）（仕様 §6：初期版はローカルDBが主）
 *
 * ストア
 * - games        : 対局1件 = seed＋全行動（MahjongGame.replay で完全に再現できる）＋結果・集計
 * - evaluations  : 自分の判断1件 = 判断直前の局面スナップショット＋実際の行動＋評価結果（仕様 §3-4）
 * - reviews      : 復習問題1件 = どの判断を、次にいつ出題するか（仕様 §7-3）
 * - quizzes      : 点数計算テスト1問の結果
 * - flags        : 評価に疑問が残る判断につけた「要検証」の印（理由・メモ・まとめて再評価した結果）
 *
 * 保存に失敗しても（プライベートブラウズなど）対局は続けられるよう、呼び出し側は例外を握りつぶしてよい。
 */
import type { ReviewItem } from '../engine/coach/review'
import type { Evaluation, EvaluationRecord } from '../engine/evaluator/types'
import type { Action, GameResult } from '../engine/game/types'

export const DB_NAME = 'mahjong-analyst'
export const DB_VERSION = 4

export interface StoredSettings {
  length: 'tonpuu' | 'hanchan'
  strength: 1 | 2 | 3
  evalMode: 'auto' | 'full' | 'light'
  aiSpeed: 'fast' | 'normal' | 'slow'
  /** 和了の局の終わりに点数計算テストを出す（古い保存データには無いので省略可） */
  scoreQuiz?: boolean
  /** 効果音と発声（古い保存データには無いので省略可。既定は「効果音＋発声」） */
  sound?: 'all' | 'se' | 'off'
}

/** 「要検証」の理由 */
export type FlagReason = 'tooLow' | 'tooHigh' | 'bestDoubt' | 'other'

export const FLAG_REASONS: [FlagReason, string][] = [
  ['tooLow', '点数が低すぎる'],
  ['tooHigh', '点数が高すぎる'],
  ['bestDoubt', '最善手が疑問'],
  ['other', 'その他'],
]

/** まとめて再評価した結果（試行回数を増やし、乱数を変えて複数回） */
export interface FlagVerification {
  at: string
  engineVersion: string
  simulations: number
  /** 回ごとの評価点 */
  scores: number[]
  /** 回ごとの最善手 */
  bestLabels: string[]
  /** 回ごとの判断損失 */
  losses: number[]
}

/** 要検証の印の識別子（画面で使う） */
export const flagKey = (gameId: string, decisionId: number) => `${gameId}:${decisionId}`

export interface FlagRecord {
  gameId: string
  decisionId: number
  reasons: FlagReason[]
  note: string
  createdAt: string
  updatedAt: string
  verification?: FlagVerification
  /** 復習問題で印をつけたとき：そのときの答えと評価。再評価はこの答えで行う */
  answer?: FlagAnswer
}

export interface FlagAnswer {
  action: Action
  label: string
  evaluation: Evaluation
  at: string
}

export interface QuizRecord {
  /** `${gameId}:${roundIndex}:${seat}` */
  id: string
  gameId: string
  roundIndex: number
  seat: number
  at: string
  correct: boolean
  answer: string
  expected: string
  han: number
  fu: number
  yakuman: boolean
}

export interface GameRecord {
  id: string
  startedAt: string
  updatedAt: string
  /** 終局していなければ null（「続きから」の対象） */
  finishedAt: string | null
  settings: StoredSettings
  seed: number
  actions: Action[]
  playerNames: string[]
  /** 最後に進んでいた局の表示名（例: 南2局 1本場） */
  roundLabel: string
  result: GameResult | null
  summary: {
    evaluated: number
    averageScore: number | null
    totalLoss: number
  }
}

export interface StoredEvaluation extends EvaluationRecord {
  gameId: string
  decisionId: number
  roundIndex: number
  roundLabel: string
  /** 打牌の表示名（例: 東、赤5萬（立直）） */
  label: string
}

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('この環境では IndexedDB が使えません'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id' })
        games.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains('evaluations')) {
        const evals = db.createObjectStore('evaluations', { keyPath: ['gameId', 'decisionId'] })
        evals.createIndex('gameId', 'gameId')
      }
      // v2：復習問題
      if (!db.objectStoreNames.contains('reviews')) {
        const reviews = db.createObjectStore('reviews', { keyPath: ['gameId', 'decisionId'] })
        reviews.createIndex('dueAt', 'dueAt')
      }
      // v3：点数計算テスト
      if (!db.objectStoreNames.contains('quizzes')) {
        const quizzes = db.createObjectStore('quizzes', { keyPath: 'id' })
        quizzes.createIndex('gameId', 'gameId')
      }
      // v4：要検証の印
      if (!db.objectStoreNames.contains('flags')) {
        db.createObjectStore('flags', { keyPath: ['gameId', 'decisionId'] })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

/** テスト用：接続を閉じて次回開き直す */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return
  const db = await dbPromise.catch(() => null)
  db?.close()
  dbPromise = null
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function store(
  name: 'games' | 'evaluations' | 'reviews' | 'quizzes' | 'flags',
  mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
  const db = await openDb()
  return db.transaction(name, mode).objectStore(name)
}

export async function saveGame(record: GameRecord): Promise<void> {
  await request((await store('games', 'readwrite')).put(record))
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  return request((await store('games', 'readonly')).get(id))
}

/** 更新が新しい順 */
export async function listGames(): Promise<GameRecord[]> {
  const all = await request((await store('games', 'readonly')).getAll())
  return (all as GameRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 最も新しい未終了の対局（「続きから」用） */
export async function latestUnfinishedGame(): Promise<GameRecord | undefined> {
  return (await listGames()).find((g) => g.finishedAt === null)
}

export async function saveEvaluation(record: StoredEvaluation): Promise<void> {
  await request((await store('evaluations', 'readwrite')).put(record))
}

/** 対局の打牌評価（打牌順） */
export async function listEvaluations(gameId: string): Promise<StoredEvaluation[]> {
  const s = await store('evaluations', 'readonly')
  const all = await request(s.index('gameId').getAll(gameId))
  return (all as StoredEvaluation[]).sort((a, b) => a.decisionId - b.decisionId)
}

/** 全ての判断の評価（弱点分析用） */
export async function listAllEvaluations(): Promise<StoredEvaluation[]> {
  return (await request((await store('evaluations', 'readonly')).getAll())) as StoredEvaluation[]
}

export async function getEvaluation(gameId: string, decisionId: number): Promise<StoredEvaluation | undefined> {
  return request((await store('evaluations', 'readonly')).get([gameId, decisionId]))
}

export async function listReviews(): Promise<ReviewItem[]> {
  return (await request((await store('reviews', 'readonly')).getAll())) as ReviewItem[]
}

export async function saveReviews(items: ReviewItem[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite')
    const s = tx.objectStore('reviews')
    for (const item of items) s.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveQuizResult(record: QuizRecord): Promise<void> {
  await request((await store('quizzes', 'readwrite')).put(record))
}

export async function listQuizzes(): Promise<QuizRecord[]> {
  return (await request((await store('quizzes', 'readonly')).getAll())) as QuizRecord[]
}

export async function saveFlag(record: FlagRecord): Promise<void> {
  await request((await store('flags', 'readwrite')).put(record))
}

export async function deleteFlag(gameId: string, decisionId: number): Promise<void> {
  await request((await store('flags', 'readwrite')).delete([gameId, decisionId]))
}

export async function listFlags(): Promise<FlagRecord[]> {
  const all = (await request((await store('flags', 'readonly')).getAll())) as FlagRecord[]
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
