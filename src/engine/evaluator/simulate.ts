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
 * - 有効牌を引いたら向聴数が最も進む打牌。その中で受け入れ（聴牌なら待ちの残り枚数）が最も多いものを選ぶ
 *   （聴牌に取るときはフリテンにならない待ちを優先。脅威があるときは安全度がほぼ同じ打牌の中から選ぶ）
 * - 有効牌でなくても、ツモ牌の方が手の中で最も孤立した牌より役立つなら入れ替える（形の改善）
 * - 他家の捨て牌は、向聴数が進み、役（役牌・対々和・断幺九・混一色）の見込みがあれば鳴く
 *   （役牌のポン以外は鳴いた後が2向聴以内のとき。チーは上家の捨て牌だけ。立直中・脅威があって遠いときは鳴かない）
 *   鳴いたらすぐ打牌し、間の打ち手を飛ばして手番が進む
 * - 脅威（立直・2副露以上）があり2向聴以上なら、最も安全な牌を切って降りる
 * - 脅威があって1向聴なら、向聴数を保てる牌のうち安全なものを切る（回し打ち）。それが危険なら降りる
 *   （立直が2人以上なら、ほぼ現物でしか回さず、聴牌に取るために危険な牌も切らない）
 * - 立直者がいるとき、立直の後に誰かが切って通った牌は、その立直者には以後安全（現物）になる
 * - 役のない仕掛け（形式聴牌）は和了できず、脅威が見えたら降りる。流局時の聴牌料は「他家の立直が出なかった割合」だけ見込む
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
  /** dealInProb のうち立直者に対する分（立直の後にその牌が通れば、以後は安全になる） */
  riichiDealInProb: Float64Array
  /** 立直者が見えているか */
  riichiVisible: boolean
  /** 見えている立直者の数 */
  riichiCount: number
  /** 自分の t 回目のツモまでの他家の打牌1回ごとに、他家が新たに立直する確率（立直者が見えていないとき） */
  riichiAppear: Float64Array
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
  /** シミュレーション内で鳴くか（検証で鳴きの効果を切り分けるときは false） */
  allowCalls?: boolean
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

/**
 * 脅威があるときの1向聴：向聴数を保てる最も安全な牌の放銃率がこれを超えるなら降りる。
 * 立直が2人以上なら、ほぼ現物でしか回さない
 */
const ONE_SHANTEN_PUSH_LIMIT = 0.05
const ONE_SHANTEN_PUSH_LIMIT_MULTI = 0.01

const isYaochu = (k: TileKind) => k >= 27 || k % 9 === 0 || k % 9 === 8

/**
 * 余った字牌の対子：対子が3組以上あり、断幺九を狙える（副露が中張牌だけ・么九牌が3枚以下）とき、
 * 役牌でない字牌の対子は雀頭の候補として余っているので、先に崩す（役立ち度から引く）
 */
const SURPLUS_HONOR_PAIR_BIAS = 3
function surplusHonorPair(c: number[], meldKinds: TileKind[][], yakuhai: Set<TileKind>): TileKind[] {
  if (meldKinds.some((m) => m.some(isYaochu))) return []
  let pairs = 0
  let y = 0
  const honors: TileKind[] = []
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 2) pairs++
    if (c[k] > 0 && isYaochu(k)) y += c[k]
    if (k >= 27 && c[k] === 2 && !yakuhai.has(k)) honors.push(k)
  }
  return pairs >= 3 && y <= 3 ? honors : []
}

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
  const initialMelds = cand.melds ?? setup.melds
  const initialMenzen = cand.menzen ?? setup.menzen
  const allowCalls = setup.allowCalls !== false
  const yakuhai = new Set<TileKind>([31, 32, 33, seatWindOf(setup.view), setup.view.round.wind])
  const need = setup.ownTurns * 4
  const poolCount = new Int8Array(KIND_COUNT)
  for (const k of setup.pool) poolCount[k]++
  const effCache = effectiveCacheOf(setup)

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
    // 残り枚数の目安（見えていない枚数 − この試行で自分が引いた分）
    const avail = (k: TileKind) => Math.max(0, poolCount[k] + cand.counts[k] - c[k])
    // 鳴きで変わる副露の状態（試行ごとに初期化）
    let melds = initialMelds
    let meldCount = melds.length
    let menzen = initialMenzen
    const meldKinds: TileKind[][] = melds.map((m) => m.tiles.map((t) => t.kind))
    let shanten = fastShanten(c, meldCount)
    // 最初から聴牌している候補は「立直するか」をこの打牌で決めているので、途中で立直しない
    const decidedAtStart = shanten === 0
    let riichi = cand.riichi
    let stickWeight = riichi ? 1 : 0 // 立直棒を払っている確率の重み
    const furiten = new Set<TileKind>(setup.riverKinds)
    if (cand.kind !== null) furiten.add(cand.kind)
    for (const k of cand.extraFuriten ?? []) furiten.add(k)

    // 牌ごとの放銃率（立直の後に通った牌は、その立直者には安全になるので下がっていく）
    const danger = Float64Array.from(setup.dealInProb)
    const passed = (k: TileKind) => {
      if (setup.riichiDealInProb[k] > 0) danger[k] = Math.max(0, setup.dealInProb[k] - setup.riichiDealInProb[k])
    }
    // 他家の立直がまだ出ていない確率（形式聴牌を流局まで保てる見込み）
    let calm = 1

    // 打牌した瞬間の放銃
    let alive = 1
    let outcome = 0
    let dealIn = 0
    // future：この先の打牌なら、今は見えていない脅威への放銃率も足す（降りているときは半分）
    const discardRisk = (k: TileKind, future = 0) => {
      const p1 = danger[k]
      const p = Math.min(0.5, p1 + future)
      const loss = p > 0 ? (p1 * setup.dealInLoss[k] + (p - p1) * setup.futureDealInLoss) / p : 0
      outcome -= alive * p * loss
      dealIn += alive * p
      alive *= 1 - p
    }
    if (cand.kind !== null) {
      discardRisk(cand.kind)
      passed(cand.kind)
    }

    /**
     * 今の手（3n+1枚、聴牌）が、役のある和了をできる待ちを持つか（門前ならツモ・立直で役が付く）。
     * 評価する時点で既に仕掛けている手（この候補の鳴きを含む）だけを調べる。シミュレーション中の鳴きは
     * 役の見込みを大まかにしか見ていないので、ここで厳しくすると鳴きの方針の粗さが候補の差に出てしまう
     */
    const hasYakuWait = (): boolean => {
      if (menzen || initialMenzen) return true
      for (const w of waitingKinds(c, meldCount)) {
        if (c[w] >= 4) continue
        c[w]++
        const v = winValue(setup, cand, melds, menzen, c, w, false, false) || winValue(setup, cand, melds, menzen, c, w, true, false)
        c[w]--
        if (v > 0) return true
      }
      return false
    }
    /** ツモ前の手（ツモ牌 draw を除いた13枚）で hasYakuWait を調べる */
    const yakuBeforeDraw = (draw: TileKind): boolean => {
      c[draw]--
      const ok = hasYakuWait()
      c[draw]++
      return ok
    }
    /** 最も安全な牌 */
    const safestTile = (): TileKind => {
      let best = Infinity
      let out: TileKind = 0
      for (let k = 0; k < KIND_COUNT; k++) {
        if (c[k] > 0 && danger[k] < best) {
          best = danger[k]
          out = k
        }
      }
      return out
    }

    /** 他家の捨て牌 x を鳴くか判断し、鳴いたら打牌まで済ませて true */
    const tryCall = (x: TileKind, canChi: boolean, t: number): boolean => {
      if (!allowCalls || riichi || meldCount >= 4 || shanten <= 0) return false
      const options: { remove: [TileKind, TileKind]; type: 'pon' | 'chi' }[] = []
      if (c[x] >= 2) options.push({ remove: [x, x], type: 'pon' })
      if (canChi && x < 27) {
        const r = x % 9
        if (r >= 2 && c[x - 2] > 0 && c[x - 1] > 0) options.push({ remove: [x - 2, x - 1], type: 'chi' })
        if (r >= 1 && r <= 7 && c[x - 1] > 0 && c[x + 1] > 0) options.push({ remove: [x - 1, x + 1], type: 'chi' })
        if (r <= 6 && c[x + 1] > 0 && c[x + 2] > 0) options.push({ remove: [x + 1, x + 2], type: 'chi' })
      }
      let best: { opt: (typeof options)[number]; s: number; d: TileKind } | null = null
      for (const opt of options) {
        c[opt.remove[0]]--
        c[opt.remove[1]]--
        let sBest = 99
        let ties: TileKind[] = []
        for (let d = 0; d < KIND_COUNT; d++) {
          if (c[d] === 0 || d === x) continue // 喰い替え（同じ牌）は不可
          c[d]--
          const sh = fastShanten(c, meldCount + 1)
          c[d]++
          if (sh < sBest) {
            sBest = sh
            ties = [d]
          } else if (sh === sBest) ties.push(d)
        }
        // 鳴いた後の打牌も、向聴数が同じなら受け入れの多いもの（ツモのときと同じ選び方）
        const dBest =
          ties.length === 0
            ? -1
            : chooseAdvance(c, ties, sBest, meldCount + 1, danger, avail, furiten, effCache)
        const ok =
          dBest >= 0 &&
          sBest < shanten &&
          (!best || sBest < best.s) &&
          openYakuPossible(c, meldKinds, [opt.remove[0], opt.remove[1], x], opt.type, yakuhai, dBest)
        c[opt.remove[0]]++
        c[opt.remove[1]]++
        if (ok) best = { opt, s: sBest, d: dBest }
      }
      if (!best) return false
      const yakuhaiPon = best.opt.type === 'pon' && yakuhai.has(x)
      if (!yakuhaiPon && best.s > 2) return false
      if (setup.hasThreat && best.s >= 2) return false

      // 鳴く：副露を加え、門前でなくなり、すぐ打牌する
      const kinds = [best.opt.remove[0], best.opt.remove[1], x].sort((a, b) => a - b)
      c[best.opt.remove[0]]--
      c[best.opt.remove[1]]--
      const id0 = 2000 + meldKinds.length * 4
      melds = [...melds, { type: best.opt.type, tiles: kinds.map((k, i) => ({ id: id0 + i, kind: k, red: false })) }]
      meldKinds.push(kinds)
      meldCount++
      menzen = false
      c[best.d]--
      furiten.add(best.d)
      shanten = best.s
      discardRisk(best.d, setup.futureDealIn[t] ?? 0)
      passed(best.d)
      return true
    }

    let won = 0 // 和了した確率
    let wonPoints = 0 // Σ 和了確率 × 点
    let wonAfterRiichi = 0
    let ended = false
    let idx = 0
    for (let t = 0; t < setup.ownTurns && idx < m && !ended; t++) {
      // 他家3人の打牌（ロンの機会）。他家は当たり牌をいつも切るわけではないので、
      // 当たり牌が出る割合を掛ける（立直していれば他家は警戒してさらに出にくい）
      const others = t === 0 && cand.drawFirst ? 0 : 3
      let called = false
      for (let j = 0; j < others && idx < m; j++) {
        alive *= 1 - (riichi ? setup.otherEndHazardSelfRiichi[t] : setup.otherEndHazard[t])
        calm *= 1 - (setup.riichiAppear[t] ?? 0)
        const tile = pool[idx++]
        // 聴牌していればロンの機会
        if (shanten === 0) {
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
        passed(tile)
        // 鳴き（チーは上家＝この直前の打ち手 j=2 の捨て牌だけ）。鳴いたら間の打ち手は飛ばし、自分のツモもない。
        // 他家は欲しい牌を一様には切らないので、ロンと同じ割合で機会を間引く（候補間で同じ判定になるよう、試行番号と山の位置で決める）
        if (callChance(i, idx) < RON_RATE_DAMA && tryCall(tile, j === 2, t)) {
          called = true
          break
        }
      }
      if (called) continue
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
      let recompute = false
      if (!riichi) {
        const s14 = fastShanten(c, meldCount)
        const advancing = s14 < shanten && s14 >= 0
        if (setup.hasThreat && shanten >= 2) {
          // 降り：最も安全な牌
          discard = safestTile()
        } else if (setup.hasThreat && shanten === 0 && s14 >= 0 && !yakuBeforeDraw(draw)) {
          // 役のない聴牌（形式聴牌）は和了できないので、脅威には降りる
          discard = safestTile()
          recompute = true
        } else if (setup.hasThreat && shanten === 1 && !advancing) {
          // 1向聴：向聴数を保てる牌のうち最も安全なもの（回し打ち）。それも危険なら降りる
          let keep = -1
          let keepDanger = Infinity
          for (let k = 0; k < KIND_COUNT; k++) {
            if (c[k] === 0 || danger[k] >= keepDanger) continue
            c[k]--
            if (fastShanten(c, meldCount) === shanten) {
              keep = k
              keepDanger = danger[k]
            }
            c[k]++
          }
          const limit = setup.riichiCount >= 2 ? ONE_SHANTEN_PUSH_LIMIT_MULTI : ONE_SHANTEN_PUSH_LIMIT
          if (keep >= 0 && keepDanger <= limit) discard = keep
          else {
            discard = safestTile()
            recompute = true
          }
        } else {
          // s14 === -1 は役なしで和了できなかった形。ツモ切りして聴牌を維持する
          if (advancing) {
            // 向聴数が進む打牌の中から、安全なものを選ぶ。
            // 聴牌に取るときは、自分の河にある牌（と今切る牌）が当たりにならない打牌を優先（フリテン回避）
            const options: TileKind[] = []
            for (let k = 0; k < KIND_COUNT; k++) {
              if (c[k] === 0) continue
              c[k]--
              if (fastShanten(c, meldCount) === s14) options.push(k)
              c[k]++
            }
            discard = chooseAdvance(c, options, s14, meldCount, danger, avail, furiten, effCache)
            if (setup.riichiCount >= 2 && danger[discard] > ONE_SHANTEN_PUSH_LIMIT_MULTI) {
              // 立直2人以上：聴牌に取るために危険な牌を切るなら、降りる
              discard = safestTile()
              recompute = true
            } else shanten = s14
          } else if (s14 >= 0 && shanten > 0) {
            // 形の改善：ツモ牌の方が、手の中で最も孤立した牌より役に立つなら入れ替える（向聴数が戻らない場合のみ）
            const surplus = surplusHonorPair(c, meldKinds, yakuhai)
            const u0 = (k: TileKind) => usefulness(c, k) - (surplus.includes(k) ? SURPLUS_HONOR_PAIR_BIAS : 0)
            let worst = -1
            let worstU = Infinity
            for (let k = 0; k < KIND_COUNT; k++) {
              if (c[k] === 0 || k === draw) continue
              const u = u0(k)
              if (u < worstU) {
                worstU = u
                worst = k
              }
            }
            if (worst >= 0 && u0(draw) > worstU + 0.5) {
              c[worst]--
              const s = fastShanten(c, meldCount)
              c[worst]++
              if (s === shanten) discard = worst
            }
          }
        }
      }
      c[discard]--
      furiten.add(discard)
      if (recompute) shanten = fastShanten(c, meldCount)
      const folding = !riichi && setup.hasThreat && (shanten >= 2 || recompute)
      discardRisk(discard, (setup.futureDealIn[t] ?? 0) * (folding ? 0.5 : 1))
      passed(discard)

      // 門前で（新たに）聴牌したら立直する
      if (!riichi && !decidedAtStart && menzen && shanten === 0 && t < setup.ownTurns - 1) {
        riichi = true
        stickWeight = alive
      }
    }

    if (!ended) {
      if (shanten !== 0) outcome -= alive * NOTEN_PENALTY
      else if (hasYakuWait()) outcome += alive * TENPAI_BONUS
      else {
        // 形式聴牌：他家の立直が出れば降りるので、聴牌のまま流局できるのは立直が出なかった場合だけ
        const keep = setup.riichiVisible ? 0 : calm
        outcome += alive * (keep * TENPAI_BONUS - (1 - keep) * NOTEN_PENALTY)
      }
    }
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

/** 安全度の差がこの範囲なら「同じくらい安全」とみなし、受け入れの広さで選ぶ */
const SAFETY_TOLERANCE = 0.02
const YAOCHU: TileKind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

/**
 * 向聴数が進むツモのあとの打牌を選ぶ（14枚の c から切る牌）。
 * 安全度がほぼ同じ打牌の中から、受け入れ（聴牌なら待ちの残り枚数）が最も多いものを選ぶ
 * （2向聴以上に進んだときは計算を軽くするため、最も孤立した牌を選ぶ）。
 * 聴牌に取るときは、フリテンにならない打牌を優先する。
 */
function chooseAdvance(
  c: number[],
  options: TileKind[],
  s14: number,
  meldCount: number,
  dealInProb: Float64Array,
  avail: (k: TileKind) => number,
  furiten: Set<TileKind>,
  cache: Map<string, TileKind[]>,
): TileKind {
  let pool = options
  if (s14 === 0) {
    const fresh = options.filter((k) => !makesFuriten(c, k, furiten, meldCount))
    if (fresh.length > 0) pool = fresh
  }
  if (pool.length === 1) return pool[0]
  let safest = Infinity
  for (const k of pool) safest = Math.min(safest, dealInProb[k])
  let best = pool[0]
  if (s14 >= 2) {
    // 2向聴以上は受け入れを数えず、最も孤立した牌を切る（計算を軽くするため）
    let bestU = Infinity
    for (const k of pool) {
      if (dealInProb[k] > safest + SAFETY_TOLERANCE) continue
      const u = usefulness(c, k) + dealInProb[k]
      if (u < bestU) {
        bestU = u
        best = k
      }
    }
    return best
  }
  let bestScore = -Infinity
  for (const k of pool) {
    if (dealInProb[k] > safest + SAFETY_TOLERANCE) continue
    c[k]--
    let u = 0
    for (const w of effectiveKinds(c, s14, meldCount, cache)) u += avail(w)
    c[k]++
    // 同じ受け入れなら安全な方
    const score = u - dealInProb[k]
    if (score > bestScore) {
      bestScore = score
      best = k
    }
  }
  return best
}

const EFFECTIVE_CACHE_LIMIT = 200_000
const effectiveCaches = new WeakMap<SimSetup, Map<string, TileKind[]>>()
/** 同じ局面の候補どうしで共有する（形だけで決まるので局面をまたいでも正しいが、メモリを抑えるため局面ごと） */
function effectiveCacheOf(setup: SimSetup): Map<string, TileKind[]> {
  let m = effectiveCaches.get(setup)
  if (!m) effectiveCaches.set(setup, (m = new Map()))
  return m
}

/**
 * 3n+1枚の手 c（向聴数 s）で、引くと向聴数が進む牌の種類。
 * 同じ乱数列を全候補で使うので同じ形が何度も出る。形ごとに覚えておく。
 */
function effectiveKinds(c: number[], s: number, meldCount: number, cache: Map<string, TileKind[]>): TileKind[] {
  const key = c.join('') + meldCount
  const hit = cache.get(key)
  if (hit) return hit
  // 向聴数を進めうる牌だけ調べる：手にある牌と、その同じ色の2つ以内の牌
  // （それ以外の牌は孤立した浮き牌にしかならない。国士無双は么九牌を足す）
  const near = new Uint8Array(KIND_COUNT)
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] === 0) continue
    near[k] = 1
    if (k < 27) {
      const r = k % 9
      for (let d = -2; d <= 2; d++) if (r + d >= 0 && r + d <= 8) near[k + d] = 1
    }
  }
  if (meldCount === 0 && kokushiShanten(c) <= s + 1) for (const k of YAOCHU) near[k] = 1
  const out: TileKind[] = []
  for (let w = 0; w < KIND_COUNT; w++) {
    if (!near[w] || c[w] >= 4) continue
    c[w]++
    if (fastShanten(c, meldCount) < s) out.push(w)
    c[w]--
  }
  if (cache.size >= EFFECTIVE_CACHE_LIMIT) cache.clear()
  cache.set(key, out)
  return out
}

/** 試行番号と山の位置から決まる 0〜1 の値（候補が違っても同じ） */
function callChance(trial: number, pos: number): number {
  let h = Math.imul(trial + 1, 0x9e3779b1) ^ Math.imul(pos + 1, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

/**
 * 牌の役立ち度（形の改善の目安）。同じ牌・隣・一つ飛びにある牌の枚数で数える。
 * 孤立した字牌・端牌ほど小さい。c にはその牌自身を含む。
 */
function usefulness(c: number[], k: TileKind): number {
  const same = c[k] - 1
  if (k >= 27) return same * 3
  const r = k % 9
  const at = (d: number) => (r + d >= 0 && r + d <= 8 ? c[k + d] : 0)
  let u = same * 2.5 + (at(-1) + at(1)) * 2 + (at(-2) + at(2)) * 1
  if (r === 0 || r === 8) u -= 0.5
  else if (r === 1 || r === 7) u -= 0.25
  return u
}

/** 14枚の手から k を切って聴牌に取ったとき、自分の河の牌（と k）が当たりになるか */
function makesFuriten(c14: number[], k: TileKind, furiten: Set<TileKind>, meldCount: number): boolean {
  c14[k]--
  let hit = false
  for (const w of [...furiten, k]) {
    if (c14[w] >= 4) continue
    c14[w]++
    if (fastShanten(c14, meldCount) === -1) hit = true
    c14[w]--
    if (hit) break
  }
  c14[k]++
  return hit
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

/**
 * 鳴いた後に役を作れる見込みがあるか（役牌・対々和・断幺九・混一色）。
 * @param c 鳴きに使う牌を抜いた後の手牌
 */
function openYakuPossible(
  c: number[],
  meldKinds: TileKind[][],
  newMeld: TileKind[],
  type: 'pon' | 'chi',
  yakuhai: Set<TileKind>,
  /** 鳴いた後に切る牌（断幺九・混一色の見込みは、この牌を切った後の手で見る） */
  discard: TileKind = -1,
): boolean {
  const allMelds = [...meldKinds, newMeld]
  // 役牌：鳴く刻子・既にある副露・手の中の暗刻
  if (type === 'pon' && yakuhai.has(newMeld[2])) return true
  if (meldKinds.some((m) => m[0] === m[1] && yakuhai.has(m[0]))) return true
  for (const k of yakuhai) if (c[k] >= 3) return true
  // 対々和：ポンだけで、手の対子・暗刻と副露を合わせて4組以上
  if (type === 'pon' && allMelds.every((m) => m[0] === m[1])) {
    let sets = allMelds.length
    for (let k = 0; k < KIND_COUNT; k++) if (c[k] >= 2) sets++
    if (sets >= 5) return true
  }
  // 断幺九：副露に么九牌がなく、手の么九牌が1枚以下
  if (allMelds.every((m) => m.every((k) => !isYaochu(k)))) {
    let yaochu = discard >= 0 && isYaochu(discard) ? -1 : 0
    for (let k = 0; k < KIND_COUNT; k++) if (c[k] > 0 && isYaochu(k)) yaochu += c[k]
    if (yaochu <= 1) return true
  }
  // 混一色・清一色：数牌が1色（他の色が手に1枚以下）で、副露もその色か字牌
  const suitCount = [0, 0, 0]
  for (let k = 0; k < 27; k++) suitCount[Math.floor(k / 9)] += c[k]
  for (const m of allMelds) if (m[0] < 27) suitCount[Math.floor(m[0] / 9)] += 3
  const main = suitCount.indexOf(Math.max(...suitCount))
  const meldsOk = allMelds.every((m) => m[0] >= 27 || Math.floor(m[0] / 9) === main)
  let off = discard >= 0 && discard < 27 && Math.floor(discard / 9) !== main ? -1 : 0
  for (let k = 0; k < 27; k++) if (Math.floor(k / 9) !== main) off += c[k]
  return meldsOk && off <= 1
}
