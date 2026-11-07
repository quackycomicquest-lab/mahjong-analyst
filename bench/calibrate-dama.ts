/**
 * 立直していない聴牌（ダマ・仕掛けの聴牌）のときの「他家の和了で局が終わる確率」と「当たり牌が切られる割合」を実測し、
 * calibration.json の damaTenpai に書き込む（npx tsx bench/calibrate-dama.ts <半荘数> [seed開始]）
 *
 * 他家の和了で局が終わる確率（hazard）は全ての局面の平均を使っていたが、自分が聴牌しているときは自分が先に和了る分だけ
 * 他家の和了は減る（AI 同士の対局で、仕掛けの聴牌の予測 34% ／ 実際 24%）。当たり牌が切られる割合も、
 * 門前と仕掛けで分けて測る（評価エンジン v0.5.1）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile } from '../src/engine/ai/profile'
import { MahjongGame } from '../src/engine/game/game'
import type { Action, Seat } from '../src/engine/game/types'
import { getPlayerView } from '../src/engine/game/view'
import { createRng } from '../src/engine/game/wall'
import { seenCounts } from '../src/engine/ai/danger'
import { waitingKinds } from '../src/engine/rules/agari'
import { calculateHandValue } from '../src/engine/rules/score'
import { calculateShanten } from '../src/engine/rules/shanten'
import { countsOfTiles, KIND_COUNT, type PhysicalTile, type TileKind } from '../src/engine/rules/tile'

const WALL_BUCKETS = 7
const wallBucket = (wall: number) => Math.min(WALL_BUCKETS - 1, Math.floor(wall / 10))
const PROFILES = [makeProfile('speed', 3), makeProfile('defense', 3), makeProfile('value', 3), makeProfile('speed', 2)]
const games = Number(process.argv[2] ?? 200)
const seedStart = Number(process.argv[3] ?? 600000)

// hazard[門前0／仕掛け1][山の残り÷10][自分以外の立直者 0,1,2+]
const hazard = [0, 1].map(() => Array.from({ length: WALL_BUCKETS }, () => [0, 1, 2].map(() => ({ discards: 0, endings: 0 }))))
// ron[門前0／仕掛け1]
const ron = [0, 1].map(() => ({ hits: 0, baseline: 0 }))
const t0 = performance.now()

const isOpen = (game: MahjongGame, p: Seat) => game.round.players[p].melds.some((m) => m.type !== 'ankan')
const isDamaTenpai = (game: MahjongGame, p: Seat) => {
  const pl = game.round.players[p]
  return !pl.riichi && calculateShanten(countsOfTiles(pl.hand), pl.melds.length).shanten === 0
}

/** p がその牌でロンできるか（役あり・フリテンでない） */
function ronnable(game: MahjongGame, p: Seat): Set<TileKind> {
  const out = new Set<TileKind>()
  const pl = game.round.players[p]
  if (game.isFuriten(p)) return out
  for (const k of waitingKinds(countsOfTiles(pl.hand), pl.melds.length)) {
    const winTile: PhysicalTile = { id: 9999, kind: k, red: false }
    const v = calculateHandValue({
      hand: [...pl.hand, winTile],
      winTile,
      melds: pl.melds,
      isTsumo: false,
      riichi: 'none',
      isIppatsu: false,
      seatWind: 27 + ((p - game.round.dealer + 4) % 4),
      roundWind: game.round.wind,
      doraIndicators: game.doraIndicators(),
      honba: game.round.honba,
    })
    if (v.ok) out.add(k)
  }
  return out
}

for (let g = 0; g < games; g++) {
  const seed = seedStart + g
  const rand = createRng(seed * 977)
  const bots: Record<number, (v: ReturnType<typeof getPlayerView>) => Action> = {}
  for (let s = 0; s < 4; s++) bots[s] = createAiBot(PROFILES[(s + seed) % 4], rand)
  const game = new MahjongGame({ seed })
  // この局で、ダマ聴牌の席が他家の打牌を見た回数（局の終わりに、他家の和了だったかを数える）
  let watched: { p: Seat; open: number; bucket: number; k: number; idx: number }[] = []
  let discardIdx = 0
  while (game.phase.type !== 'gameEnd') {
    const ph = game.phase
    if (ph.type === 'roundEnd') {
      const res = ph.result
      const involved = new Set<number>()
      if (res.type === 'agari') for (const w of res.wins) {
        involved.add(w.seat)
        if (w.from !== null) involved.add(w.from)
      }
      // 局の最後の打牌のときにダマ聴牌だった席について、他家の和了で終わったかを数える
      for (const w of watched) hazard[w.open][w.bucket][w.k].discards++
      if (res.type === 'agari') {
        for (const w of watched) if (w.idx === discardIdx && !involved.has(w.p)) hazard[w.open][w.bucket][w.k].endings++
      }
      watched = []
      discardIdx = 0
      game.apply({ type: 'nextRound' })
      continue
    }
    const seat = game.pendingSeats()[0]
    const view = getPlayerView(game, seat)
    const action = bots[seat](view)
    if (action.type === 'discard') {
      discardIdx++
      const kind = view.hand.find((t) => t.id === action.tileId)!.kind
      const bucket = wallBucket(game.round.wall.length)
      for (let p = 0 as Seat; p < 4; p = (p + 1) as Seat) {
        if (p === seat || !isDamaTenpai(game, p)) continue
        const open = isOpen(game, p) ? 1 : 0
        const k = Math.min(game.round.players.filter((pl, s) => s !== p && pl.riichi).length, 2)
        watched.push({ p, open, bucket, k, idx: discardIdx })
        // 当たり牌が切られる割合（p から見た見えていない牌に対する、待ちの割合と比べる）
        const waits = ronnable(game, p)
        if (waits.size === 0) continue
        const seen = seenCounts(getPlayerView(game, p))
        let unseen = 0
        let waitUnseen = 0
        for (let k = 0; k < KIND_COUNT; k++) {
          const u = Math.max(0, 4 - seen[k])
          unseen += u
          if (waits.has(k)) waitUnseen += u
        }
        if (unseen === 0) continue
        ron[open].baseline += waitUnseen / unseen
        ron[open].hits += waits.has(kind) ? 1 : 0
      }
    }
    game.apply(action)
  }
}

const rate = (s: { discards: number; endings: number }) => (s.discards > 0 ? Math.round((s.endings / s.discards) * 1e5) / 1e5 : 0)
const data = {
  hazardByWall: hazard.map((row) => row.map((cells) => cells.map(rate))),
  hazardN: hazard.map((row) => row.map((cells) => cells.map((s) => s.discards))),
  ronRate: ron.map((r) => (r.baseline > 0 ? Math.round((r.hits / r.baseline) * 1000) / 1000 : 0)),
  ronN: ron.map((r) => Math.round(r.baseline)),
  games,
}
const file = new URL('../src/engine/calibration/calibration.json', import.meta.url)
const json = JSON.parse(readFileSync(file, 'utf8'))
json.damaTenpai = data
writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
console.log(`${games}半荘（${((performance.now() - t0) / 1000).toFixed(0)}秒）`)
console.log(`他家の和了で終わる確率（打牌1回あたり）[門前][山÷10][立直者]: ${JSON.stringify(data.hazardByWall)}`)
console.log(`当たり牌が切られる割合 門前 ${data.ronRate[0]} ／ 仕掛け ${data.ronRate[1]}（ダマ全体の実測は ${json.ronRate?.dama}）`)
