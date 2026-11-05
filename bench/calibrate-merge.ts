/**
 * calibrate.ts の生データを合算し、src/engine/calibration/calibration.json を書き出す
 *
 *   npx tsx bench/calibrate-merge.ts raw1.json raw2.json ...
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { CalibrationData, ThreatType } from '../src/engine/calibration/calibration'
import { emptyRaw, type RawCalibration } from './calibrate'

const files = process.argv.slice(2)
if (files.length === 0) throw new Error('生データのファイルを指定してください')

const total = emptyRaw()
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8')) as RawCalibration
  total.games += r.games
  total.rounds += r.rounds
  total.profiles = r.profiles
  for (const t of Object.keys(r.danger) as ThreatType[]) {
    for (const [k, v] of Object.entries(r.danger[t])) {
      const s = (total.danger[t][k] ??= { n: 0, hits: 0 })
      s.n += v.n
      s.hits += v.hits
    }
    for (const d of ['dealer', 'nonDealer'] as const) {
      total.loss[t][d].sum += r.loss[t][d].sum
      total.loss[t][d].n += r.loss[t][d].n
    }
  }
  for (const b of ['dama', 'riichi'] as const) {
    total.ron[b].hits += r.ron[b].hits
    total.ron[b].baseline += r.ron[b].baseline
  }
  for (const b of ['normal', 'selfRiichi'] as const) {
    r.hazard[b].forEach((row, w) =>
      row.forEach((h, i) => {
        total.hazard[b][w][i].discards += h.discards
        total.hazard[b][w][i].endings += h.endings
      }),
    )
  }
  for (const b of ['tenpai', 'noten'] as const) {
    total.draw[b].sum += r.draw[b].sum
    total.draw[b].n += r.draw[b].n
  }
  total.riichiBonus.actual += r.riichiBonus.actual
  total.riichiBonus.base += r.riichiBonus.base
  r.discardDealIn.forEach((row, w) =>
    row.forEach((d, i) => {
      const t = total.discardDealIn[w][i]
      t.n += d.n
      t.hits += d.hits
      t.lossSum += d.lossSum
    }),
  )
}

const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d
const avg = (s: { sum: number; n: number }, fallback: number) => (s.n > 0 ? Math.round(s.sum / s.n) : fallback)
type H = { discards: number; endings: number }
const sumH = (hs: H[]): H => hs.reduce((a, h) => ({ discards: a.discards + h.discards, endings: a.endings + h.endings }), { discards: 0, endings: 0 })
const rate = (h: H, fallback: number) => (h.discards >= 1000 ? round(h.endings / h.discards) : fallback)

const danger = {} as NonNullable<CalibrationData['danger']>
for (const t of Object.keys(total.danger) as ThreatType[]) {
  danger[t] = {}
  for (const [k, v] of Object.entries(total.danger[t]).sort()) danger[t][k] = { n: v.n, p: round(v.hits / v.n) }
}
// 山の残り枚数ごと：立直者がいない時点からは、この先の立直も平均として含む「全体」の値を使う
const all = total.hazard.normal.map((row, w) => rate(sumH([...row, ...total.hazard.selfRiichi[w]]), 0.02))
const byRiichi = total.hazard.normal.map((row, w) => row.map((h, i) => (i === 0 ? all[w] : rate(h, all[w] * 4))))
const selfRiichi = total.hazard.selfRiichi.map((row, w) => rate(sumH(row), all[w]))
const out: CalibrationData = {
  version: 1,
  generatedAt: new Date().toISOString(),
  games: total.games,
  rounds: total.rounds,
  profiles: total.profiles,
  danger,
  dealInLoss: Object.fromEntries(
    (Object.keys(total.loss) as ThreatType[]).map((t) => [
      t,
      { dealer: avg(total.loss[t].dealer, 7700), nonDealer: avg(total.loss[t].nonDealer, 5200) },
    ]),
  ) as NonNullable<CalibrationData['dealInLoss']>,
  ronRate: {
    dama: round(total.ron.dama.hits / total.ron.dama.baseline, 3),
    riichi: round(total.ron.riichi.hits / total.ron.riichi.baseline, 3),
  },
  hazard: { byWall: byRiichi, selfRiichiByWall: selfRiichi },
  drawPayment: { tenpai: avg(total.draw.tenpai, 1000), noten: avg(total.draw.noten, -1000) },
  riichiBonusRate: round(total.riichiBonus.actual / total.riichiBonus.base, 3),
  discardDealIn: {
    // 全体（脅威の有無を問わない）と、打った時点で脅威が見えていなかった打牌（ダマ・仕掛けの見えない聴牌への放銃）
    all: total.discardDealIn.map((row) => round((row[0].hits + row[1].hits) / Math.max(1, row[0].n + row[1].n))),
    unseen: total.discardDealIn.map((row) => round(row[0].hits / Math.max(1, row[0].n))),
    loss: Math.round(
      total.discardDealIn.flat().reduce((n, d) => n + d.lossSum, 0) /
        Math.max(1, total.discardDealIn.flat().reduce((n, d) => n + d.hits, 0)),
    ),
  },
}
writeFileSync('src/engine/calibration/calibration.json', JSON.stringify(out, null, 2) + '\n')
console.log(`${out.games}半荘・${out.rounds}局 → src/engine/calibration/calibration.json`)
console.log(JSON.stringify({ ...out, danger: undefined }, null, 1))
