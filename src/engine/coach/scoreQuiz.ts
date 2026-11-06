/**
 * 点数計算テスト：点数表を見せて、和了の点数にあたるマス（符×翻、または満貫以上の欄）を選ばせる
 *
 * 正解は点数計算エンジン（Python mahjong と 10,000 件で照合済み）の結果。
 * 点数表の各マスの点数も同じ計算（翻・符からの支払い）で作り、照合データで一致を確認している。
 * 点数は本場を含めない基本の支払い（ロン：放銃者の支払い、ツモ：子の支払い-親の支払い／親はオール）。
 * 判定は点数で行う（30符4翻と60符3翻のように同じ点数のマスはどちらも正解）。
 */
import type { HandValue } from '../rules/score'

export interface ScoreCell {
  /** マスの識別子（例: 30-4、limit-5、yakuman-2） */
  id: string
  han: number
  fu: number
  /** 役満の倍数（役満の欄だけ） */
  yakuman: number
  /** 支払いの表示（ロン 7700／子のツモ 2000-3900／親のツモ 3900オール） */
  label: string
  /** 満貫以上なら名前（符×翻のマスでも、点数が満貫に達していれば「満貫」） */
  limit: string | null
  /** この形の和了がありえないマス（20符のロン、25符の1翻など）は選べない */
  valid: boolean
}

export interface ScoreTable {
  fuRows: number[]
  hanCols: number[]
  /** grid[行=符][列=翻] */
  grid: ScoreCell[][]
  /** 満貫・跳満・倍満・三倍満・役満・二倍役満…の欄 */
  limits: ScoreCell[]
}

export const TABLE_FU = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]
export const TABLE_HAN = [1, 2, 3, 4]

/** 支払いの表示（ロン 7700／子のツモ 2000-3900／親のツモ 3900オール） */
export function paymentLabel(main: number, additional: number, dealer: boolean, tsumo: boolean): string {
  if (!tsumo) return `${main}`
  return dealer ? `${additional}オール` : `${additional}-${main}`
}

/** 翻・符（役満は倍数）から基本の支払いを計算する（切り上げ満貫なし・数え役満あり） */
export function basePayment(
  han: number,
  fu: number,
  dealer: boolean,
  tsumo: boolean,
  yakumanMultiplier = 0,
): { main: number; additional: number } {
  let base: number
  if (yakumanMultiplier > 0) base = 8000 * yakumanMultiplier
  else if (han >= 13) base = 8000
  else if (han >= 11) base = 6000
  else if (han >= 8) base = 4000
  else if (han >= 6) base = 3000
  else if (han >= 5) base = 2000
  else base = Math.min(2000, fu * 2 ** (han + 2))
  const up = (x: number) => Math.ceil(x / 100) * 100
  if (!tsumo) return { main: up(base * (dealer ? 6 : 4)), additional: 0 }
  const main = up(base * 2)
  return { main, additional: dealer ? main : up(base) }
}

/** その和了の正解の支払い表示 */
export function answerLabel(value: HandValue, tsumo: boolean): string {
  return paymentLabel(value.payment.main, value.payment.additional, value.isDealer, tsumo)
}

const MULTIPLE_NAMES = ['', '二', '三', '四', '五', '六']

/**
 * 親か子か・ロンかツモかに応じた点数表を作る
 * @param maxFu 110符を超える和了（ごくまれ）のときは、その符まで行を足す
 * @param maxYakuman 役満の欄を何倍まで出すか（最低 2）
 */
export function scoreTable(dealer: boolean, tsumo: boolean, maxFu = 110, maxYakuman = 2): ScoreTable {
  const fuRows = [...TABLE_FU]
  for (let f = 120; f <= maxFu; f += 10) fuRows.push(f)
  const label = (han: number, fu: number, mult = 0) => {
    const p = basePayment(han, fu, dealer, tsumo, mult)
    return paymentLabel(p.main, p.additional, dealer, tsumo)
  }
  const grid = fuRows.map((fu) =>
    TABLE_HAN.map((han): ScoreCell => {
      // 20符はツモの平和（2翻以上）だけ、25符は七対子（2翻以上、ツモなら3翻以上）だけ
      const valid = fu === 20 ? tsumo && han >= 2 : fu === 25 ? han >= (tsumo ? 3 : 2) : true
      const mangan = fu * 2 ** (han + 2) > 2000
      return { id: `${fu}-${han}`, han, fu, yakuman: 0, label: label(han, fu), limit: mangan ? '満貫' : null, valid }
    }),
  )
  const limitCell = (name: string, han: number): ScoreCell => ({
    id: `limit-${han}`,
    han,
    fu: 0,
    yakuman: 0,
    label: label(han, 30),
    limit: name,
    valid: true,
  })
  const yakuman = Array.from(
    { length: Math.max(2, maxYakuman) },
    (_, i): ScoreCell => ({
      id: `yakuman-${i + 1}`,
      han: 13,
      fu: 0,
      yakuman: i + 1,
      label: label(0, 0, i + 1),
      limit: i === 0 ? '役満' : `${MULTIPLE_NAMES[i] ?? i + 1}倍役満`,
      valid: true,
    }),
  )
  const limits = [limitCell('満貫', 5), limitCell('跳満', 6), limitCell('倍満', 8), limitCell('三倍満', 11), ...yakuman]
  return { fuRows, hanCols: TABLE_HAN, grid, limits }
}

/** 実際の和了（翻・符）にあたるマスの識別子 */
export function actualCellId(value: HandValue): string {
  if (value.yakumanMultiplier > 0) return `yakuman-${value.yakumanMultiplier}`
  if (value.han >= 13) return 'yakuman-1'
  if (value.han >= 11) return 'limit-11'
  if (value.han >= 8) return 'limit-8'
  if (value.han >= 6) return 'limit-6'
  if (value.han >= 5) return 'limit-5'
  return `${value.fu}-${value.han}`
}

/** その和了を出題するための点数表 */
export function scoreTableFor(value: HandValue, tsumo: boolean): ScoreTable {
  return scoreTable(value.isDealer, tsumo, value.fu, value.yakumanMultiplier)
}

/** 点数表の全マス（符×翻のマスと満貫以上の欄） */
export function allCells(table: ScoreTable): ScoreCell[] {
  return [...table.grid.flat(), ...table.limits]
}

/** 点数計算テストに出す「状況」の役（手牌からは分からないもの） */
export const SITUATIONAL_YAKU = new Set([
  'riichi',
  'doubleRiichi',
  'ippatsu',
  'haitei',
  'houtei',
  'rinshan',
  'chankan',
  'tenhou',
  'chiihou',
])
