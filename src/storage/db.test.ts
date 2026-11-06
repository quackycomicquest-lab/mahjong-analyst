import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateDecision } from '../engine/evaluator/evaluate'
import { MahjongGame } from '../engine/game/game'
import { efficiencyBot } from '../engine/game/simpleBots'
import { getPlayerView } from '../engine/game/view'
import { buildGameRecord, type EvalEntry, type PlayerInfo } from '../ui/useGame'
import {
  closeDb,
  DB_NAME,
  deleteFlag,
  listFlags,
  saveFlag,
  getGame,
  latestUnfinishedGame,
  listEvaluations,
  listGames,
  saveEvaluation,
  saveGame,
} from './db'

const settings = { length: 'tonpuu', strength: 2, evalMode: 'light', aiSpeed: 'fast' } as const
const players: PlayerInfo[] = ['あなた', '速攻型', '守備型', '打点型'].map((name, seat) => ({
  seat: seat as 0 | 1 | 2 | 3,
  name,
  profile: null,
}))

/** 牌効率ボットで n 手進める */
function playSteps(game: MahjongGame, n: number) {
  for (let i = 0; i < n && game.phase.type !== 'gameEnd'; i++) {
    if (game.phase.type === 'roundEnd') {
      game.apply({ type: 'nextRound' })
      continue
    }
    const seat = game.pendingSeats()[0]
    game.apply(efficiencyBot(getPlayerView(game, seat)))
  }
}

beforeEach(async () => {
  await closeDb()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = () => resolve()
  })
})
afterEach(() => closeDb())

describe('対局の保存と再開', () => {
  it('seed と行動列から、保存した時点の局面をそのまま再現できる', async () => {
    const game = new MahjongGame({ seed: 123, config: { length: 'tonpuu' } })
    playSteps(game, 300)
    const record = buildGameRecord(game, { id: 'g1', startedAt: '2026-11-05T10:00:00Z', settings }, players, [])
    await saveGame(record)

    const loaded = (await getGame('g1'))!
    expect(loaded.actions.length).toBe(game.state.actions.length)
    const replayed = MahjongGame.replay({ seed: loaded.seed, config: { length: loaded.settings.length } }, loaded.actions)
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(game.state))
    expect(loaded.finishedAt).toBeNull()
    expect((await latestUnfinishedGame())?.id).toBe('g1')
  })

  it('終局した対局は「続きから」の対象にならず、結果が残る', async () => {
    const game = new MahjongGame({ seed: 5, config: { length: 'tonpuu' } })
    playSteps(game, 100000)
    expect(game.phase.type).toBe('gameEnd')
    await saveGame(buildGameRecord(game, { id: 'done', startedAt: '2026-11-05T09:00:00Z', settings }, players, []))
    const g = (await getGame('done'))!
    expect(g.finishedAt).not.toBeNull()
    expect(g.result?.ranks).toHaveLength(4)
    expect(await latestUnfinishedGame()).toBeUndefined()
  })

  it('一覧は更新が新しい順', async () => {
    const base = buildGameRecord(new MahjongGame({ seed: 1 }), { id: 'a', startedAt: 'x', settings }, players, [])
    await saveGame({ ...base, id: 'old', updatedAt: '2026-11-01T00:00:00Z' })
    await saveGame({ ...base, id: 'new', updatedAt: '2026-11-05T00:00:00Z' })
    expect((await listGames()).map((g) => g.id)).toEqual(['new', 'old'])
  })
})

describe('打牌評価の保存（仕様 §3-4）', () => {
  it('局面スナップショット・打牌・評価をまとめて保存し、打牌順に読み出せる', async () => {
    const game = new MahjongGame({ seed: 9 })
    const entries: EvalEntry[] = []
    let saved = 0
    while (saved < 3) {
      const seat = game.pendingSeats()[0]
      const view = getPlayerView(game, seat)
      const action = efficiencyBot(view)
      if (seat === 0 && action.type === 'discard') {
        const evaluation = evaluateDecision(view, action, { mode: 'light' })
        await saveEvaluation({
          gameId: 'g',
          decisionId: view.decisionId,
          roundIndex: view.roundIndex,
          roundLabel: '東1局 0本場',
          label: `打牌${saved}`,
          snapshot: view,
          action,
          evaluation,
          createdAt: new Date().toISOString(),
        })
        entries.push({ decisionId: view.decisionId, roundIndex: 0, roundLabel: '東1局 0本場', label: '', evaluation, error: null })
        saved++
      }
      game.apply(action)
    }
    await saveEvaluation({ ...(await listEvaluations('g'))[0], gameId: 'other' })

    const list = await listEvaluations('g')
    expect(list.map((r) => r.label)).toEqual(['打牌0', '打牌1', '打牌2'])
    const r = list[0]
    expect(r.snapshot.hand).toHaveLength(14)
    expect(r.evaluation.engineVersion).toMatch(/^evaluator-/)
    expect(r.evaluation.candidates.length).toBeGreaterThan(0)
    // 保存した局面からもう一度評価できる（再評価）
    const again = evaluateDecision(r.snapshot, r.action, { mode: 'light', seed: 1 })
    expect(again.status).not.toBe('unavailable')

    // 対局レコードの集計
    const rec = buildGameRecord(game, { id: 'g', startedAt: 'x', settings }, players, entries)
    expect(rec.summary.evaluated).toBe(3)
    expect(rec.summary.averageScore).not.toBeNull()
  })

  it('要検証の印を保存・更新・削除できる（新しい順）', async () => {
    const base = { reasons: ['tooLow' as const], note: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }
    await saveFlag({ ...base, gameId: 'g', decisionId: 1 })
    await saveFlag({ ...base, gameId: 'g', decisionId: 2, createdAt: '2026-11-02T00:00:00Z' })
    await saveFlag({ ...base, gameId: 'g', decisionId: 1, note: '両面より打点では？' })
    const flags = await listFlags()
    expect(flags.map((f) => f.decisionId)).toEqual([2, 1])
    expect(flags[1].note).toBe('両面より打点では？')
    await deleteFlag('g', 2)
    expect((await listFlags()).map((f) => f.decisionId)).toEqual([1])
  })
})
