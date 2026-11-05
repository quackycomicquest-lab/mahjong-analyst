/**
 * ローカル保存（IndexedDB）（仕様 §6：初期版はローカルDBが主）
 *
 * ストア
 * - games        : 対局1件 = seed＋全行動（MahjongGame.replay で完全に再現できる）＋結果・集計
 * - evaluations  : 自分の打牌1件 = 打牌直前の局面スナップショット＋実際の打牌＋評価結果（仕様 §3-4）
 *
 * 保存に失敗しても（プライベートブラウズなど）対局は続けられるよう、呼び出し側は例外を握りつぶしてよい。
 */
import type { EvaluationRecord } from '../engine/evaluator/types'
import type { Action, GameResult } from '../engine/game/types'

export const DB_NAME = 'mahjong-analyst'
export const DB_VERSION = 1

export interface StoredSettings {
  length: 'tonpuu' | 'hanchan'
  strength: 1 | 2 | 3
  evalMode: 'auto' | 'full' | 'light'
  aiSpeed: 'normal' | 'fast'
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

async function store(name: 'games' | 'evaluations', mode: IDBTransactionMode): Promise<IDBObjectStore> {
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
