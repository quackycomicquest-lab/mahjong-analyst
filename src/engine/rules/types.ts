/**
 * 和了・点数計算で使う型とルール設定
 */

import type { PhysicalTile, TileKind } from './tile'

/** 副露の種類。ankan（暗槓）以外は門前を崩す。 */
export type MeldType = 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan'

export interface Meld {
  type: MeldType
  /** 構成牌（チー・ポンは3枚、カンは4枚） */
  tiles: PhysicalTile[]
}

export const isOpenMeld = (m: Meld): boolean => m.type !== 'ankan'
export const isKanMeld = (m: Meld): boolean =>
  m.type === 'minkan' || m.type === 'kakan' || m.type === 'ankan'

/**
 * ルール設定（仕様 §2-1）。
 * 元仕様の標準ルール表が欠落しているため、一般的なネット麻雀の標準を既定値にしている。
 */
export interface RuleConfig {
  /** 喰いタン */
  kuitan: boolean
  /** 数え役満（13翻以上を役満にする。false なら三倍満止まり） */
  kazoeYakuman: boolean
  /** 切り上げ満貫（4翻30符・3翻60符を満貫にする） */
  kiriageMangan: boolean
  /** ダブル役満（国士13面・四暗刻単騎・純正九蓮・大四喜を2倍にする） */
  doubleYakuman: boolean
}

export const STANDARD_RULES: RuleConfig = {
  kuitan: true,
  kazoeYakuman: true,
  kiriageMangan: false,
  doubleYakuman: true,
}

export interface WinInput {
  /** 門前部分の手牌（和了牌を含む）。副露した牌は含めない。 */
  hand: PhysicalTile[]
  /** 和了牌（hand に含まれる個体） */
  winTile: PhysicalTile
  melds: Meld[]
  isTsumo: boolean
  riichi: 'none' | 'riichi' | 'double'
  isIppatsu?: boolean
  /** 海底摸月（最後のツモ牌でツモ和了） */
  isHaitei?: boolean
  /** 河底撈魚（最後の打牌でロン和了） */
  isHoutei?: boolean
  isRinshan?: boolean
  isChankan?: boolean
  isTenhou?: boolean
  isChiihou?: boolean
  /** 自風（27=東 … 30=北）。東なら親。 */
  seatWind: TileKind
  /** 場風（27=東 … 30=北） */
  roundWind: TileKind
  doraIndicators: TileKind[]
  /** 立直時のみ有効 */
  uraDoraIndicators?: TileKind[]
  /** 積み棒 */
  honba?: number
  /** 供託（立直棒の本数） */
  kyoutaku?: number
}
