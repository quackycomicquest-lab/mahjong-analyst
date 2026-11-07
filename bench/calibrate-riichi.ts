/**
 * 他家の立直が「新たに出る」割合を AI 同士の対局で実測し、calibration.json の riichiAppear に書き込む
 *
 *   npx tsx bench/calibrate-riichi.ts <半荘数> [seed開始]
 *
 * 各打牌について、打った人以外の各席から見て「他家の立直者がまだいない」ときに 1 回と数え、
 * その打牌が立直宣言なら「新たな立直」として数える。山の残り枚数（10枚ごと）別に集計する。
 * 役のない仕掛け（形式聴牌しか取れない手）が、流局まで聴牌を保てる見込みの計算に使う（評価エンジン v0.4.0）。
 * 他の定数（calibrate.ts）とは別に測り、この項目だけを書き換える。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile } from '../src/engine/ai/profile'
import { MahjongGame } from '../src/engine/game/game'
import type { Action, Seat } from '../src/engine/game/types'
import { getPlayerView } from '../src/engine/game/view'
import { createRng } from '../src/engine/game/wall'

const WALL_BUCKETS = 7
const wallBucket = (wall: number) => Math.min(WALL_BUCKETS - 1, Math.floor(wall / 10))
const PROFILES = [makeProfile('speed', 3), makeProfile('defense', 3), makeProfile('value', 3), makeProfile('speed', 2)]

const games = Number(process.argv[2] ?? 200)
const seedStart = Number(process.argv[3] ?? 700000)
const stat = Array.from({ length: WALL_BUCKETS }, () => ({ n: 0, hits: 0 }))
const t0 = performance.now()

for (let g = 0; g < games; g++) {
  const seed = seedStart + g
  const rand = createRng(seed * 977)
  const bots: Record<number, (v: ReturnType<typeof getPlayerView>) => Action> = {}
  for (let s = 0; s < 4; s++) bots[s] = createAiBot(PROFILES[(s + seed) % 4], rand)
  const game = new MahjongGame({ seed })
  while (game.phase.type !== 'gameEnd') {
    if (game.phase.type === 'roundEnd') {
      game.apply({ type: 'nextRound' })
      continue
    }
    const seat = game.pendingSeats()[0]
    const action = bots[seat](getPlayerView(game, seat))
    if (action.type === 'discard') {
      const r = game.round
      const b = stat[wallBucket(r.wall.length)]
      for (let p = 0 as Seat; p < 4; p = (p + 1) as Seat) {
        if (p === seat) continue
        if (r.players.some((pl, s) => s !== p && pl.riichi)) continue
        b.n++
        if (action.riichi) b.hits++
      }
    }
    game.apply(action)
  }
}

const rates = stat.map((s) => (s.n > 0 ? Math.round((s.hits / s.n) * 1e5) / 1e5 : 0))
const file = new URL('../src/engine/calibration/calibration.json', import.meta.url)
const data = JSON.parse(readFileSync(file, 'utf8'))
data.riichiAppear = { byWall: rates, n: stat.map((s) => s.n), games }
writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
console.log(`${games}半荘（${((performance.now() - t0) / 1000).toFixed(0)}秒） 立直の出る割合（打牌1回あたり、山の残り÷10ごと）: ${rates.join(', ')}`)
