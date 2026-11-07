/**
 * 評価・AI で使う定数（補正値）
 *
 * AI 同士の大量対局（npm run calibrate）で実測した値を calibration.json に保存し、ここで読み込む。
 * 実測データがない項目・サンプルが少ない項目は、経験則による既定値を使う。
 */
import data from './calibration.json'

export type ThreatType = 'riichi' | 'open3' | 'open2'

export interface RateStat {
  /** サンプル数 */
  n: number
  /** 確率（0〜1） */
  p: number
}

export interface CalibrationData {
  version: number
  generatedAt?: string
  games?: number
  rounds?: number
  profiles?: string[]
  /** 脅威の種類 → 危険度の分類 → 放銃率 */
  danger?: Record<ThreatType, Record<string, RateStat>>
  /** 放銃したときの平均失点 */
  dealInLoss?: Record<ThreatType, { dealer: number; nonDealer: number }>
  /** 当たり牌が他家から実際に切られる割合（見えていない牌を一様に並べた場合との比） */
  ronRate?: { dama: number; riichi: number }
  /**
   * 他家の打牌1回あたり、自分以外の和了で局が終わる確率。
   * byWall[山の残り枚数÷10][自分以外の立直者数 0,1,2+]。立直者 0 の列は「この先の立直も平均として含む」値。
   * selfRiichiByWall[山の残り枚数÷10]：自分が立直しているとき
   */
  hazard?: { byWall: number[][]; selfRiichiByWall: number[] }
  /** 荒牌流局時の平均収支 */
  drawPayment?: { tenpai: number; noten: number }
  /** 立直和了の打点 ÷ 裏ドラ・一発を除いた打点 */
  riichiBonusRate?: number
  /**
   * 1打牌あたりの放銃率 [山の残り枚数÷10]。
   * all：脅威の有無を問わない（今は脅威がなくても、この先の立直・仕掛けへの放銃を含む）
   * unseen：打った時点で脅威が見えていなかった打牌（ダマ聴牌などへの放銃）
   */
  discardDealIn?: { all: number[]; unseen: number[]; loss: number }
  /** 他家の立直者がいないとき、他家の打牌1回あたりにそれが立直宣言である割合 [山の残り枚数÷10]（bench/calibrate-riichi.ts） */
  riichiAppear?: { byWall: number[]; n?: number[]; games?: number }
}

/** 検証用：環境変数 MAHJONG_NO_CALIBRATION=1 なら実測値を使わず既定値だけで動かす（Node 実行時のみ） */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const disabled = env?.MAHJONG_NO_CALIBRATION === '1'

export const CALIBRATION: CalibrationData = disabled ? { version: 0 } : (data as CalibrationData)

/** サンプル数がこれ未満の分類は使わず、上位の分類か既定値に戻す */
export const MIN_SAMPLES = 300

/** 経験則による既定値（%）。実測値がない場合に使う */
export const DEFAULT_DANGER_PERCENT: Record<string, number> = {
  genbutsu: 0,
  unknown: 8,
  'honor-s3': 1,
  'honor-s2': 3,
  'honor-s1': 6,
  'honor-s0': 8,
  'suji-19': 3,
  'suji-28': 4,
  'suji-37': 5,
  nakasuji: 4,
  katasuji: 8,
  'musuji-19': 6,
  'musuji-28': 9,
  'musuji-37': 11,
  'musuji-456': 13,
}

/** 副露の脅威は立直の何倍の危険度とみなすか（実測がない場合） */
const DEFAULT_THREAT_SCALE: Record<ThreatType, number> = { riichi: 1, open3: 0.5, open2: 0.25 }

/**
 * 分類の放銃率（%）。
 * 実測値（サンプル十分）→ 細分類を外した分類の実測値 → 既定値 の順に探す。
 */
export function dangerPercent(type: ThreatType, category: string): number {
  const table = CALIBRATION.danger?.[type]
  for (const cat of fallbackChain(category)) {
    const s = table?.[cat]
    if (s && s.n >= MIN_SAMPLES) return s.p * 100
  }
  // 副露の表に十分なデータがなければ、立直の表を縮小して使う
  if (type !== 'riichi') return dangerPercent('riichi', category) * DEFAULT_THREAT_SCALE[type]
  for (const cat of fallbackChain(category)) {
    if (cat in DEFAULT_DANGER_PERCENT) return refineDefault(category, DEFAULT_DANGER_PERCENT[cat])
  }
  return DEFAULT_DANGER_PERCENT.unknown
}

/** 'musuji-28+onechance' → ['musuji-28+onechance', 'musuji-28'] */
function fallbackChain(category: string): string[] {
  const i = category.indexOf('+')
  return i < 0 ? [category] : [category, category.slice(0, i)]
}

function refineDefault(category: string, base: number): number {
  if (category.endsWith('+nochance')) return Math.min(base, category.includes('19') ? 3 : 4)
  if (category.endsWith('+onechance')) return base * 0.7
  return base
}

export function dealInLoss(type: ThreatType, dealer: boolean): number {
  const v = CALIBRATION.dealInLoss?.[type]
  if (v) return dealer ? v.dealer : v.nonDealer
  return type === 'riichi' ? (dealer ? 9600 : 6400) : dealer ? 5800 : 3900
}

export function ronRate(riichi: boolean): number {
  const r = CALIBRATION.ronRate
  return r ? (riichi ? r.riichi : r.dama) : riichi ? 0.25 : 0.45
}

/** 他家の打牌1回あたりに、自分以外の和了で局が終わる確率（山の残り枚数 wall の時点） */
export function otherEndHazard(wall: number, riichiThreats: number, openThreats: number, selfRiichi: boolean): number {
  const h = CALIBRATION.hazard
  if (h) {
    const w = Math.max(0, Math.min(h.byWall.length - 1, Math.floor(wall / 10)))
    const base = selfRiichi ? h.selfRiichiByWall[w] : h.byWall[w][Math.min(riichiThreats, 2)]
    // 2副露以上の相手がいれば少し上げる（実測していないので控えめな目安）
    return base * (1 + 0.15 * openThreats)
  }
  const base = 0.03 + 0.025 * riichiThreats + 0.008 * openThreats
  return selfRiichi ? base * 0.6 : base
}

export function drawPayment(tenpai: boolean): number {
  const d = CALIBRATION.drawPayment
  if (d) return tenpai ? d.tenpai : d.noten
  return tenpai ? 1000 : -500
}

export function riichiBonusRate(): number {
  return CALIBRATION.riichiBonusRate ?? 1.2
}

/**
 * 今は見えていない脅威（この先の立直、ダマ聴牌）に対する、1打牌あたりの放銃率と失点。
 * @param threatsVisible 評価した時点で脅威（立直・2副露以上）が見えているか
 */
export function futureDealIn(wall: number, threatsVisible: boolean): { rate: number; loss: number } {
  const d = CALIBRATION.discardDealIn
  if (!d) return { rate: 0, loss: 0 }
  const w = Math.max(0, Math.min(d.all.length - 1, Math.floor(wall / 10)))
  return { rate: threatsVisible ? d.unseen[w] : d.all[w], loss: d.loss }
}

/** 他家の立直者がいないとき、他家の打牌1回あたりに新たな立直が出る確率（山の残り枚数 wall の時点） */
export function riichiAppearRate(wall: number): number {
  const r = CALIBRATION.riichiAppear
  if (r) return r.byWall[Math.max(0, Math.min(r.byWall.length - 1, Math.floor(wall / 10)))]
  return wall >= 20 ? 0.03 : 0.01
}
