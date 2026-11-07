/**
 * 他家の和了で局が終わったときの、自分の失点（ツモの支払い）を AI 同士の対局で実測し、calibration.json の otherWinLoss に書き込む
 *
 *   npx tsx bench/calibrate-otherwin.ts <半荘数> [seed開始]
 *
 * 和了でも放銃でもない席（＝他家の和了で局が終わった人）の収支を集める。他家どうしのロンなら 0、ツモなら支払い。
 * 局が終わった時点の「自分以外の立直者の数（0・1・2以上）」と「自分が親か」で分ける。
 * 評価エンジンは、他家の和了で局が終わる確率（hazard）にこの平均失点を掛けて収支に入れる（v0.5.0）。
 * それまでは他家のツモの支払いを数えておらず、降りの収支が良く見えすぎていた。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile } from '../src/engine/ai/profile'
import { MahjongGame } from '../src/engine/game/game'
import type { Action, Seat } from '../src/engine/game/types'
import { getPlayerView } from '../src/engine/game/view'
import { createRng } from '../src/engine/game/wall'

const PROFILES = [makeProfile('speed', 3), makeProfile('defense', 3), makeProfile('value', 3), makeProfile('speed', 2)]
const games = Number(process.argv[2] ?? 200)
const seedStart = Number(process.argv[3] ?? 800000)
// [立直者数 0,1,2+][自分が子 0／親 1]
const stat = [0, 1, 2].map(() => [0, 1].map(() => ({ n: 0, sum: 0 })))
const t0 = performance.now()

for (let g = 0; g < games; g++) {
  const seed = seedStart + g
  const rand = createRng(seed * 977)
  const bots: Record<number, (v: ReturnType<typeof getPlayerView>) => Action> = {}
  for (let s = 0; s < 4; s++) bots[s] = createAiBot(PROFILES[(s + seed) % 4], rand)
  const game = new MahjongGame({ seed })
  while (game.phase.type !== 'gameEnd') {
    const ph = game.phase
    if (ph.type === 'roundEnd') {
      const res = ph.result
      if (res.type === 'agari') {
        const r = game.round
        const involved = new Set<number>()
        for (const w of res.wins) {
          involved.add(w.seat)
          if (w.from !== null) involved.add(w.from)
        }
        for (let p = 0 as Seat; p < 4; p = (p + 1) as Seat) {
          if (involved.has(p)) continue
          const k = Math.min(r.players.filter((pl, s) => s !== p && pl.riichi).length, 2)
          const b = stat[k][p === r.dealer ? 1 : 0]
          b.n++
          // 供託・本場は和了者に入るだけなので、自分の収支は支払い分だけ
          b.sum += Math.min(0, res.deltas[p])
        }
      }
      game.apply({ type: 'nextRound' })
      continue
    }
    const seat = game.pendingSeats()[0]
    game.apply(bots[seat](getPlayerView(game, seat)))
  }
}

const loss = stat.map((row) => row.map((b) => (b.n > 0 ? Math.round(-b.sum / b.n) : 0)))
const file = new URL('../src/engine/calibration/calibration.json', import.meta.url)
const data = JSON.parse(readFileSync(file, 'utf8'))
data.otherWinLoss = { byRiichi: loss, n: stat.map((row) => row.map((b) => b.n)), games }
writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
console.log(`${games}半荘（${((performance.now() - t0) / 1000).toFixed(0)}秒） 他家の和了で終わった局の平均失点 [立直者0,1,2+][子,親]: ${JSON.stringify(loss)}`)
