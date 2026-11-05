/**
 * AI 同士の大量対局から、評価エンジンの定数を実測する（集計の生データを出力）
 *
 *   npx tsx bench/calibrate.ts <半荘数> <seed開始> <出力JSON>
 *   npx tsx bench/calibrate-merge.ts <生データ...>   … 合算して src/engine/calibration/calibration.json を作る
 *
 * シミュレーションでは全員の手牌が分かるので、「その牌が実際に当たり牌だったか」を
 * 捨てたかどうかに関係なく数えられる（打ち手の偏りの影響を受けにくい）。
 * ここで隠し情報を使うのは集計のためだけで、評価・AI の実行時には使わない。
 */
import { writeFileSync } from 'node:fs'
import { dangerCategory, findThreats, seenCounts } from '../src/engine/ai/danger'
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile, type AiProfile } from '../src/engine/ai/profile'
import type { ThreatType } from '../src/engine/calibration/calibration'
import { MahjongGame } from '../src/engine/game/game'
import type { Action, Seat } from '../src/engine/game/types'
import { getPlayerView } from '../src/engine/game/view'
import { createRng } from '../src/engine/game/wall'
import { waitingKinds } from '../src/engine/rules/agari'
import { calculateHandValue } from '../src/engine/rules/score'
import { countsOfTiles, KIND_COUNT, type PhysicalTile, type TileKind } from '../src/engine/rules/tile'

export interface RawCalibration {
  games: number
  rounds: number
  profiles: string[]
  danger: Record<ThreatType, Record<string, { n: number; hits: number }>>
  loss: Record<ThreatType, { dealer: { sum: number; n: number }; nonDealer: { sum: number; n: number } }>
  ron: { dama: { hits: number; baseline: number }; riichi: { hits: number; baseline: number } }
  /** [山の残り枚数÷10][自分以外の立直者数 0,1,2+] */
  hazard: { normal: { discards: number; endings: number }[][]; selfRiichi: { discards: number; endings: number }[][] }
  draw: { tenpai: { sum: number; n: number }; noten: { sum: number; n: number } }
  riichiBonus: { actual: number; base: number }
  /** 1打牌あたりの放銃率：[山の残り枚数÷10][打った人から脅威が見えていたか 0/1] */
  discardDealIn: { n: number; hits: number; lossSum: number }[][]
}

export function emptyRaw(): RawCalibration {
  const types: ThreatType[] = ['riichi', 'open3', 'open2']
  const zl = () => ({ dealer: { sum: 0, n: 0 }, nonDealer: { sum: 0, n: 0 } })
  const zh = () => Array.from({ length: WALL_BUCKETS }, () => [0, 1, 2].map(() => ({ discards: 0, endings: 0 })))
  return {
    games: 0,
    rounds: 0,
    profiles: [],
    danger: Object.fromEntries(types.map((t) => [t, {}])) as RawCalibration['danger'],
    loss: Object.fromEntries(types.map((t) => [t, zl()])) as RawCalibration['loss'],
    ron: { dama: { hits: 0, baseline: 0 }, riichi: { hits: 0, baseline: 0 } },
    hazard: { normal: zh(), selfRiichi: zh() },
    draw: { tenpai: { sum: 0, n: 0 }, noten: { sum: 0, n: 0 } },
    riichiBonus: { actual: 0, base: 0 },
    discardDealIn: Array.from({ length: WALL_BUCKETS }, () => [0, 1].map(() => ({ n: 0, hits: 0, lossSum: 0 }))),
  }
}

/** この局の打牌（放銃したかを局の終わりに判定する） */
let roundDiscards: { tileId: number; bucket: number; threat: number }[] = []

export const WALL_BUCKETS = 7
const wallBucket = (wall: number) => Math.min(WALL_BUCKETS - 1, Math.floor(wall / 10))

const PROFILES: AiProfile[] = [
  makeProfile('speed', 3),
  makeProfile('defense', 3),
  makeProfile('value', 3),
  makeProfile('speed', 2),
]

function seatWind(game: MahjongGame, seat: Seat): TileKind {
  return 27 + ((seat - game.round.dealer + 4) % 4)
}

/** seat がその牌でロンしたときの点数（役がなければ 0） */
function ronPoints(game: MahjongGame, seat: Seat, kind: TileKind): number {
  const p = game.round.players[seat]
  const winTile: PhysicalTile = { id: 9999, kind, red: false }
  const v = calculateHandValue({
    hand: [...p.hand, winTile],
    winTile,
    melds: p.melds,
    isTsumo: false,
    riichi: p.riichi ? (p.riichi.double ? 'double' : 'riichi') : 'none',
    isIppatsu: !!p.riichi?.ippatsu,
    seatWind: seatWind(game, seat),
    roundWind: game.round.wind,
    doraIndicators: game.doraIndicators(),
    uraDoraIndicators: game.uraDoraIndicators(),
    honba: game.round.honba,
  })
  return v.ok ? v.payment.main + v.payment.mainBonus : 0
}

/** 席ごとの「和了できる待ち（役あり・フリテンでない）」 */
function ronnableWaits(game: MahjongGame, seat: Seat): Map<TileKind, number> {
  const out = new Map<TileKind, number>()
  const p = game.round.players[seat]
  if (game.isFuriten(seat)) return out
  for (const k of waitingKinds(countsOfTiles(p.hand), p.melds.length)) {
    const pts = ronPoints(game, seat, k)
    if (pts > 0) out.set(k, pts)
  }
  return out
}

function pointsFor(han: number, fu: number, dealer: boolean, tsumo: boolean): number {
  let base: number
  if (han >= 13) base = 8000
  else if (han >= 11) base = 6000
  else if (han >= 8) base = 4000
  else if (han >= 6) base = 3000
  else if (han >= 5) base = 2000
  else base = Math.min(2000, fu * 2 ** (han + 2))
  const up = (x: number) => Math.ceil(x / 100) * 100
  if (!tsumo) return up(base * (dealer ? 6 : 4))
  return dealer ? 3 * up(base * 2) : up(base * 2) + 2 * up(base)
}

export function runCalibration(games: number, seedStart: number): RawCalibration {
  const raw = emptyRaw()
  raw.profiles = PROFILES.map((p) => p.id)
  for (let g = 0; g < games; g++) {
    const seed = seedStart + g
    const rand = createRng(seed * 977)
    const bots: Record<number, (v: ReturnType<typeof getPlayerView>) => Action> = {}
    for (let s = 0; s < 4; s++) bots[s] = createAiBot(PROFILES[(s + seed) % 4], rand)
    const game = new MahjongGame({ seed })
    raw.games++

    while (game.phase.type !== 'gameEnd') {
      const ph = game.phase
      if (ph.type === 'roundEnd') {
        recordRoundEnd(game, raw)
        game.apply({ type: 'nextRound' })
        continue
      }
      const seat = game.pendingSeats()[0]
      const view = getPlayerView(game, seat)
      const action = bots[seat](view)
      if (action.type === 'discard') recordDiscard(game, seat, view, action.tileId, raw)
      game.apply(action)
    }
  }
  return raw
}

function riichiCountExcept(game: MahjongGame, p: Seat): number {
  return game.round.players.filter((pl, s) => s !== p && pl.riichi).length
}

function recordDiscard(
  game: MahjongGame,
  seat: Seat,
  view: ReturnType<typeof getPlayerView>,
  tileId: number,
  raw: RawCalibration,
): void {
  const r = game.round
  const kind = view.hand.find((t) => t.id === tileId)!.kind

  // --- 1打牌あたりの放銃率（局の終わりに当たったかを判定）
  const visibleThreats = findThreats(view)
  roundDiscards.push({ tileId, bucket: wallBucket(r.wall.length), threat: visibleThreats.length > 0 ? 1 : 0 })

  // --- 危険度：打つ人の視点で、手牌の各牌が脅威の当たり牌かどうか
  const seen = seenCounts(view)
  const myKinds = [...new Set(view.hand.map((t) => t.kind))]
  for (const t of visibleThreats) {
    const ronnable = ronnableWaits(game, t.seat)
    const dealer = t.seat === r.dealer
    for (const k of myKinds) {
      const cat = dangerCategory(k, t.safeKinds, seen, 3)
      const hit = ronnable.has(k) ? 1 : 0
      const keys = new Set([cat, cat.split('+')[0]])
      if (cat !== 'genbutsu') keys.add('unknown')
      for (const key of keys) {
        const s = (raw.danger[t.type][key] ??= { n: 0, hits: 0 })
        s.n++
        s.hits += hit
      }
      if (hit) {
        const l = raw.loss[t.type][dealer ? 'dealer' : 'nonDealer']
        l.sum += ronnable.get(k)!
        l.n++
      }
    }
  }

  // --- 当たり牌が切られる割合：聴牌している他家ごとに、実際の打牌と「一様に並べた場合」の期待を比べる
  for (let w = 0 as Seat; w < 4; w = (w + 1) as Seat) {
    if (w === seat) continue
    const ronnable = ronnableWaits(game, w)
    if (ronnable.size === 0) continue
    const wSeen = seenCounts(getPlayerView(game, w))
    let unseen = 0
    let waitUnseen = 0
    for (let k = 0; k < KIND_COUNT; k++) {
      const u = Math.max(0, 4 - wSeen[k])
      unseen += u
      if (ronnable.has(k)) waitUnseen += u
    }
    if (unseen === 0) continue
    const bucket = r.players[w].riichi ? raw.ron.riichi : raw.ron.dama
    bucket.baseline += waitUnseen / unseen
    bucket.hits += ronnable.has(kind) ? 1 : 0
  }

  // --- 局の終わりやすさ：打った人以外の各席から見た「他家の打牌」1回
  for (let p = 0 as Seat; p < 4; p = (p + 1) as Seat) {
    if (p === seat) continue
    const k = Math.min(riichiCountExcept(game, p), 2)
    const table = r.players[p].riichi ? raw.hazard.selfRiichi : raw.hazard.normal
    table[wallBucket(r.wall.length)][k].discards++
  }
}

function recordRoundEnd(game: MahjongGame, raw: RawCalibration): void {
  const ph = game.phase
  if (ph.type !== 'roundEnd') return
  raw.rounds++
  const res = ph.result
  const r = game.round
  const dealt = new Map<number, number>()
  if (res.type === 'agari') {
    for (const w of res.wins) if (w.from !== null) dealt.set(w.winTile.id, (dealt.get(w.winTile.id) ?? 0) + w.value.payment.main + w.value.payment.mainBonus)
  }
  for (const d of roundDiscards) {
    const s = raw.discardDealIn[d.bucket][d.threat]
    s.n++
    const loss = dealt.get(d.tileId)
    if (loss !== undefined) {
      s.hits++
      s.lossSum += loss
    }
  }
  roundDiscards = []
  if (res.type === 'agari') {
    const involved = new Set<number>()
    for (const w of res.wins) {
      involved.add(w.seat)
      if (w.from !== null) involved.add(w.from)
    }
    for (let p = 0 as Seat; p < 4; p = (p + 1) as Seat) {
      if (involved.has(p)) continue
      const k = Math.min(riichiCountExcept(game, p), 2)
      const table = r.players[p].riichi ? raw.hazard.selfRiichi : raw.hazard.normal
      table[wallBucket(r.wall.length)][k].endings++
    }
    // 立直和了の打点に、裏ドラ・一発がどれだけ上乗せされたか
    for (const w of res.wins) {
      const v = w.value
      if (v.yakumanMultiplier > 0 || !v.yaku.some((y) => y.id === 'riichi' || y.id === 'doubleRiichi')) continue
      const extra = v.yaku.filter((y) => y.id === 'uraDora' || y.id === 'ippatsu').reduce((n, y) => n + y.han, 0)
      const dealer = w.seat === r.dealer
      raw.riichiBonus.actual += pointsFor(v.han, v.fu, dealer, w.from === null)
      raw.riichiBonus.base += pointsFor(v.han - extra, v.fu, dealer, w.from === null)
    }
  } else if (res.reason === 'exhaustive' && res.nagashi.length === 0) {
    for (let s = 0; s < 4; s++) {
      const b = res.tenpai[s] ? raw.draw.tenpai : raw.draw.noten
      b.sum += res.deltas[s]
      b.n++
    }
  }
}

// ---------------------------------------------------------------------------

const isMain = process.argv[1]?.endsWith('calibrate.ts')
if (isMain) {
  const games = Number(process.argv[2] ?? 10)
  const seedStart = Number(process.argv[3] ?? 1)
  const out = process.argv[4] ?? 'calibration-raw.json'
  const t0 = performance.now()
  const raw = runCalibration(games, seedStart)
  writeFileSync(out, JSON.stringify(raw))
  console.log(`${games}半荘・${raw.rounds}局を集計 → ${out}（${((performance.now() - t0) / 1000).toFixed(0)}秒）`)
}
