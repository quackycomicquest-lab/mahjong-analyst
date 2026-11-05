/**
 * 打牌候補ごとの期待値シミュレーション（仕様 §3 Evaluator の E2〜E4）
 *
 * 見えていない牌（自分の手・河・副露・ドラ表示牌以外）を一様に並べ替え、
 * 「他家3人の打牌 → 自分のツモ」を山が尽きるまで繰り返して、この局の収支を推定する。
 * 他家の手牌は使わない（仕様 §4-1）。
 *
 * 分散を減らす工夫:
 * - 全候補で同じ乱数列（同じツモ順）を使い、候補間の差を比べやすくする
 * - 放銃と他家の和了は抽選せず「生き残り確率」を掛けていく（期待値で計算）
 *
 * 自分の打ち方（シミュレーション内の方針）:
 * - 有効牌を引いたら向聴数が最も進む打牌、引かなければツモ切り
 * - 脅威（立直・2副露以上）があり2向聴以上なら、最も安全な牌を切って降りる
 * - 門前で聴牌したら立直（立直後はツモ切り）。ただし打牌時点で聴牌の候補は、その候補の立直・ダマのまま進める
 */

import { drawPayment, riichiBonusRate, ronRate } from '../calibration/calibration'
import { createRng } from '../game/wall'
import type { PlayerView } from '../game/view'
import { waitingKinds } from '../rules/agari'
import { calculateHandValue } from '../rules/score'
import { chiitoitsuShanten, kokushiShanten, regularShantenUnadjusted } from '../rules/shanten'
import { KIND_COUNT, type PhysicalTile, type TileKind } from '../rules/tile'
import type { Meld } from '../rules/types'
import { seatWindOf } from '../ai/value'

export interface SimSetup {
  view: PlayerView
  melds: Meld[]
  menzen: boolean
  /** 見えていない牌の種類（重複あり） */
  pool: TileKind[]
  /** 自分の残りツモ回数 */
  ownTurns: number
  /** 種類ごとの放銃確率（脅威全員の合計、0〜0.5） */
  dealInProb: Float64Array
  /** 種類ごとの放銃時の失点 */
  dealInLoss: Float64Array
  /** 自分の t 回目のツモまでの他家の打牌1回ごとに、自分以外の和了で局が終わる確率 */
  otherEndHazard: Float64Array
  /** 同上（自分が立直しているとき。他家が守りに回るので下がる） */
  otherEndHazardSelfRiichi: Float64Array
  hasThreat: boolean
  /** 自分の t 回目のツモ後の打牌で、今は見えていない脅威（この先の立直・ダマ聴牌）に放銃する確率 */
  futureDealIn: Float64Array
  /** その場合の平均失点 */
  futureDealInLoss: number
  /** 自分の河にある牌の種類（フリテン判定） */
  riverKinds: TileKind[]
  /** 場の供託・本場 */
  kyoutaku: number
  honba: number
}

export interface SimCandidate {
  /** この候補で切る牌（スキップなど、切らない場合は null） */
  kind: TileKind | null
  riichi: boolean
  /** 打牌後の手牌（3n+1枚）の種類別枚数 */
  counts: number[]
  /** 打牌後も手に残る赤5の種類 */
  redKinds: TileKind[]
  /** 鳴き・カンで副露が変わる場合の副露 */
  melds?: Meld[]
  /** 鳴きで門前でなくなる場合は false */
  menzen?: boolean
  /** カンの直後など、他家の打牌より先に自分がツモる */
  drawFirst?: boolean
  /** 見逃したロンなど、追加でフリテンになる牌 */
  extraFuriten?: TileKind[]
}

export interface SimOutcome {
  /** 各試行の収支 */
  outcomes: Float64Array
  mean: number
  stdError: number
  winRate: number
  winValue: number
  dealInRate: number
}

const RIICHI_STICK = 1000
// 以下の定数は AI 同士の大量対局で実測した値（calibration.json。無ければ経験則の既定値）
const RON_RATE_DAMA = ronRate(false)
const RON_RATE_RIICHI = ronRate(true)
const TENPAI_BONUS = drawPayment(true)
const NOTEN_PENALTY = -drawPayment(false)
const RIICHI_BONUS_RATE = riichiBonusRate()

function fastShanten(c: number[], meldCount: number): number {
  let s = regularShantenUnadjusted(c, meldCount)
  if (meldCount === 0) s = Math.min(s, chiitoitsuShanten(c), kokushiShanten(c))
  return s
}

export function simulateCandidate(setup: SimSetup, cand: SimCandidate, n: number, seed: number): SimOutcome {
  const outcomes = new Float64Array(n)
  let winSum = 0
  let winValueSum = 0
  let dealInSum = 0
  const melds = cand.melds ?? setup.melds
  const menzen = cand.menzen ?? setup.menzen
  const meldCount = melds.length
  const need = setup.ownTurns * 4

  for (let i = 0; i < n; i++) {
    const rng = createRng(seed + i * 7919)
    // 必要な枚数だけ部分シャッフル
    const pool = setup.pool.slice()
    const m = Math.min(need, pool.length)
    for (let j = 0; j < m; j++) {
      const r = j + Math.floor(rng() * (pool.length - j))
      const t = pool[j]
      pool[j] = pool[r]
      pool[r] = t
    }

    const c = cand.counts.slice()
    let shanten = fastShanten(c, meldCount)
    // 最初から聴牌している候補は「立直するか」をこの打牌で決めているので、途中で立直しない
    const decidedAtStart = shanten === 0
    let riichi = cand.riichi
    let stickWeight = riichi ? 1 : 0 // 立直棒を払っている確率の重み
    const furiten = new Set<TileKind>(setup.riverKinds)
    if (cand.kind !== null) furiten.add(cand.kind)
    for (const k of cand.extraFuriten ?? []) furiten.add(k)

    // 打牌した瞬間の放銃
    let alive = 1
    let outcome = 0
    let dealIn = 0
    // future：この先の打牌なら、今は見えていない脅威への放銃率も足す（降りているときは半分）
    const discardRisk = (k: TileKind, future = 0) => {
      const p1 = setup.dealInProb[k]
      const p = Math.min(0.5, p1 + future)
      const loss = p > 0 ? (p1 * setup.dealInLoss[k] + (p - p1) * setup.futureDealInLoss) / p : 0
      outcome -= alive * p * loss
      dealIn += alive * p
      alive *= 1 - p
    }
    if (cand.kind !== null) discardRisk(cand.kind)

    let won = 0 // 和了した確率
    let wonPoints = 0 // Σ 和了確率 × 点
    let wonAfterRiichi = 0
    let ended = false
    let idx = 0
    for (let t = 0; t < setup.ownTurns && idx < m && !ended; t++) {
      // 他家3人の打牌（ロンの機会）。他家は当たり牌をいつも切るわけではないので、
      // 当たり牌が出る割合を掛ける（立直していれば他家は警戒してさらに出にくい）
      const others = t === 0 && cand.drawFirst ? 0 : 3
      for (let j = 0; j < others && idx < m; j++) {
        alive *= 1 - (riichi ? setup.otherEndHazardSelfRiichi[t] : setup.otherEndHazard[t])
        const tile = pool[idx++]
        if (shanten !== 0) continue
        c[tile]++
        if (fastShanten(c, meldCount) === -1 && !isFuriten(c, tile, furiten, meldCount)) {
          const v = winValue(setup, cand, melds, menzen, c, tile, false, riichi)
          if (v > 0) {
            const p = alive * (riichi ? RON_RATE_RIICHI : RON_RATE_DAMA)
            outcome += p * v
            won += p
            wonPoints += p * v
            if (riichi) wonAfterRiichi += p
            alive -= p
          }
        }
        c[tile]--
      }
      if (idx >= m) break
      // 自分のツモ
      const draw = pool[idx++]
      c[draw]++
      if (shanten === 0 && fastShanten(c, meldCount) === -1) {
        const v = winValue(setup, cand, melds, menzen, c, draw, true, riichi)
        if (v > 0) {
          outcome += alive * v
          won += alive
          wonPoints += alive * v
          if (riichi) wonAfterRiichi += alive
          alive = 0
          ended = true
          break
        }
      }

      let discard: TileKind = draw
      if (!riichi) {
        if (setup.hasThreat && shanten >= 2) {
          // 降り：最も安全な牌
          let best = Infinity
          for (let k = 0; k < KIND_COUNT; k++) {
            if (c[k] > 0 && setup.dealInProb[k] < best) {
              best = setup.dealInProb[k]
              discard = k
            }
          }
        } else {
          const s14 = fastShanten(c, meldCount)
          // s14 === -1 は役なしで和了できなかった形。ツモ切りして聴牌を維持する
          if (s14 < shanten && s14 >= 0) {
            let bestRisk = Infinity
            for (let k = 0; k < KIND_COUNT; k++) {
              if (c[k] === 0) continue
              c[k]--
              const s = fastShanten(c, meldCount)
              c[k]++
              if (s === s14 && setup.dealInProb[k] < bestRisk) {
                bestRisk = setup.dealInProb[k]
                discard = k
              }
            }
            shanten = s14
          }
        }
      }
      c[discard]--
      furiten.add(discard)
      const folding = !riichi && setup.hasThreat && shanten >= 2
      discardRisk(discard, (setup.futureDealIn[t] ?? 0) * (folding ? 0.5 : 1))

      // 門前で（新たに）聴牌したら立直する
      if (!riichi && !decidedAtStart && menzen && shanten === 0 && t < setup.ownTurns - 1) {
        riichi = true
        stickWeight = alive
      }
    }

    if (!ended) outcome += alive * (shanten === 0 ? TENPAI_BONUS : -NOTEN_PENALTY)
    // 立直棒：立直後に和了できなかった分は失う
    outcome -= RIICHI_STICK * Math.max(0, stickWeight - wonAfterRiichi)

    outcomes[i] = outcome
    winSum += won
    winValueSum += wonPoints
    dealInSum += dealIn
  }

  let mean = 0
  for (const o of outcomes) mean += o
  mean /= n
  let v = 0
  for (const o of outcomes) v += (o - mean) ** 2
  const stdError = n > 1 ? Math.sqrt(v / (n - 1) / n) : 0
  return {
    outcomes,
    mean,
    stdError,
    winRate: winSum / n,
    winValue: winSum > 0 ? winValueSum / winSum : 0,
    dealInRate: dealInSum / n,
  }
}

function isFuriten(c14: number[], winTile: TileKind, furiten: Set<TileKind>, meldCount: number): boolean {
  if (furiten.has(winTile)) return true
  c14[winTile]--
  const waits = waitingKinds(c14, meldCount)
  c14[winTile]++
  return waits.some((k) => furiten.has(k))
}

/** 和了点（ロンは放銃者の支払い、ツモは合計）。役がなければ 0 */
function winValue(
  setup: SimSetup,
  cand: SimCandidate,
  melds: Meld[],
  menzen: boolean,
  c14: number[],
  winKind: TileKind,
  tsumo: boolean,
  riichi: boolean,
): number {
  const hand: PhysicalTile[] = []
  const reds = new Set(cand.redKinds)
  let winTile: PhysicalTile | null = null
  for (let k = 0; k < KIND_COUNT; k++) {
    for (let j = 0; j < c14[k]; j++) {
      const t: PhysicalTile = { id: 1000 + k * 4 + j, kind: k, red: j === 0 && reds.has(k) }
      hand.push(t)
      if (k === winKind && j === c14[k] - 1) winTile = t
    }
  }
  const v = calculateHandValue({
    hand,
    winTile: winTile!,
    melds,
    isTsumo: tsumo,
    riichi: riichi && menzen ? 'riichi' : 'none',
    seatWind: seatWindOf(setup.view),
    roundWind: setup.view.round.wind,
    doraIndicators: setup.view.doraIndicators,
    honba: setup.honba,
  })
  if (!v.ok) return 0
  const p = v.payment
  const gain = (tsumo ? p.total : p.main + p.mainBonus) * (riichi && menzen ? RIICHI_BONUS_RATE : 1)
  return Math.round(gain) + setup.kyoutaku * 1000
}
