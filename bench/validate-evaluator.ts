/**
 * 評価エンジンの当たり具合の検証（npm run validate -- <半荘数>）
 *
 * AI 同士の対局で、席0の打牌を評価し、予測（その局の和了率・放銃率・収支の期待値）と
 * その局の実際の結果を比べる。MAHJONG_NO_CALIBRATION=1 を付けると補正前の定数で測れる。
 */
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile } from '../src/engine/ai/profile'
import { CALIBRATION } from '../src/engine/calibration/calibration'
import { evaluateDecision } from '../src/engine/evaluator/evaluate'
import { MahjongGame } from '../src/engine/game/game'
import { efficiencyBot } from '../src/engine/game/simpleBots'
import type { Action } from '../src/engine/game/types'
import { getPlayerView } from '../src/engine/game/view'
import { createRng } from '../src/engine/game/wall'

interface Sample {
  win: number
  dealIn: number
  ev: number
  roundIndex: number
}

const games = Number(process.argv[2] ?? 40)
/** 'menzen' を指定すると、席0を鳴かない牌効率ボットにする（鳴きの影響を切り分ける） */
const seat0Menzen = process.argv[3] === 'menzen'
const profiles = [makeProfile('value', 3), makeProfile('speed', 3), makeProfile('defense', 3), makeProfile('speed', 2)]
const samples: (Sample & { actualWin: number; actualDealIn: number; actualDelta: number })[] = []
const t0 = performance.now()

for (let g = 0; g < games; g++) {
  const seed = 900000 + g
  const rand = createRng(seed)
  const bots: Record<number, (v: ReturnType<typeof getPlayerView>) => Action> = {}
  for (let s = 0; s < 4; s++) bots[s] = createAiBot(profiles[s], rand)
  if (seat0Menzen) bots[0] = efficiencyBot
  const game = new MahjongGame({ seed })
  let pending: Sample[] = []
  while (game.phase.type !== 'gameEnd') {
    const ph = game.phase
    if (ph.type === 'roundEnd') {
      const res = ph.result
      const win = res.type === 'agari' && res.wins.some((w) => w.seat === 0) ? 1 : 0
      const dealIn = res.type === 'agari' && res.wins.some((w) => w.from === 0) ? 1 : 0
      for (const s of pending) samples.push({ ...s, actualWin: win, actualDealIn: dealIn, actualDelta: res.deltas[0] })
      pending = []
      game.apply({ type: 'nextRound' })
      continue
    }
    const seat = game.pendingSeats()[0]
    const view = getPlayerView(game, seat)
    const action = bots[seat](view)
    // 席0の打牌を2回に1回評価する
    if (seat === 0 && action.type === 'discard' && view.decisionId % 2 === 0) {
      const e = evaluateDecision(view, action, { mode: 'light', seed: view.decisionId })
      if (e.chosen) pending.push({ win: e.chosen.winRate, dealIn: e.chosen.dealInRate, ev: e.chosen.ev, roundIndex: view.roundIndex })
    }
    game.apply(action)
  }
}

const mean = (f: (s: (typeof samples)[number]) => number) => samples.reduce((n, s) => n + f(s), 0) / samples.length
const brier = mean((s) => (s.win - s.actualWin) ** 2)
console.log(`\n■ 評価の当たり具合（席0：${seat0Menzen ? '鳴かない牌効率ボット' : '打点型AI'}・${games}半荘・${samples.length}局面・補正値 version ${CALIBRATION.version}${CALIBRATION.games ? `・${CALIBRATION.games}半荘で実測` : '（既定値）'}・${((performance.now() - t0) / 1000).toFixed(0)}秒）`)
console.log(`和了率   予測 ${(mean((s) => s.win) * 100).toFixed(1)}% ／ 実際 ${(mean((s) => s.actualWin) * 100).toFixed(1)}%   （Brier ${brier.toFixed(4)}）`)
console.log(`放銃率   予測 ${(mean((s) => s.dealIn) * 100).toFixed(1)}% ／ 実際 ${(mean((s) => s.actualDealIn) * 100).toFixed(1)}%`)
console.log(`局の収支 予測 ${mean((s) => s.ev).toFixed(0)}点 ／ 実際 ${mean((s) => s.actualDelta).toFixed(0)}点`)
console.log('和了率の予測帯ごとの実際（予測が当たっていれば両者が近い）')
for (const [lo, hi] of [[0, 0.05], [0.05, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 1.01]]) {
  const b = samples.filter((s) => s.win >= lo && s.win < hi)
  if (b.length === 0) continue
  const p = b.reduce((n, s) => n + s.win, 0) / b.length
  const a = b.reduce((n, s) => n + s.actualWin, 0) / b.length
  console.log(`  予測 ${(lo * 100).toFixed(0)}〜${Math.min(hi * 100, 100).toFixed(0)}%: 平均予測 ${(p * 100).toFixed(1)}% ／ 実際 ${(a * 100).toFixed(1)}%（${b.length}局面）`)
}
