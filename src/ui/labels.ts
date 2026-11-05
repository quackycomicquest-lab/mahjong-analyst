/**
 * 表示用の文言
 */
import type { Action, DrawReason, Seat } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'
import { kindName, type PhysicalTile, type TileKind } from '../engine/rules/tile'

export const WIND_NAMES: Record<number, string> = { 27: '東', 28: '南', 29: '西', 30: '北' }

export function tileLabel(t: PhysicalTile): string {
  return (t.red ? '赤' : '') + kindName(t.kind)
}

export function roundLabel(wind: TileKind, dealer: Seat, honba: number): string {
  return `${WIND_NAMES[wind]}${dealer + 1}局 ${honba}本場`
}

export function seatWind(seat: Seat, dealer: Seat): string {
  return WIND_NAMES[27 + ((seat - dealer + 4) % 4)]
}

export const DRAW_REASONS: Record<DrawReason, string> = {
  exhaustive: '荒牌流局',
  kyuushu: '九種九牌',
  suufon: '四風連打',
  suucha: '四家立直',
  suukan: '四開槓',
  sanchahou: '三家和',
}

export const LIMIT_NAMES: Record<string, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  kazoeYakuman: '数え役満',
  yakuman: '役満',
}

/** 評価点の言葉（色だけに頼らない表示。仕様 §8-1） */
export function scoreGrade(score: number): { label: string; tone: 'great' | 'good' | 'fair' | 'poor' } {
  if (score >= 90) return { label: '好判断', tone: 'great' }
  if (score >= 70) return { label: 'まずまず', tone: 'good' }
  if (score >= 50) return { label: '改善の余地', tone: 'fair' }
  return { label: '要復習', tone: 'poor' }
}

export const pct = (x: number) => `${(x * 100).toFixed(0)}%`
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** 評価履歴に表示する、判断の短い名前（例: 東、5萬（立直）、ポン 白、スキップ（3萬）） */
export function actionLabel(view: PlayerView, a: Action): string {
  const byId = (id: number) => view.hand.find((t) => t.id === id)!
  const target = view.responseTo ? tileLabel(view.responseTo.tile) : ''
  switch (a.type) {
    case 'discard':
      return tileLabel(byId(a.tileId)) + (a.riichi ? '（立直）' : '')
    case 'pass':
      return `スキップ（${target}）`
    case 'pon':
      return `ポン ${target}`
    case 'chi':
      return `チー ${target}`
    case 'daiminkan':
      return `カン ${target}`
    case 'ron':
      return `ロン ${target}`
    case 'tsumo':
      return 'ツモ'
    case 'ankan':
      return `暗槓 ${kindName(a.kind)}`
    case 'kakan':
      return `加槓 ${tileLabel(byId(a.tileId))}`
    case 'kyuushu':
      return '九種九牌'
    default:
      return ''
  }
}

export const DECISION_NAMES = {
  discard: '打牌',
  call: '鳴き判断',
  win: '和了判断',
  kan: 'カン判断',
  kyuushu: '九種九牌',
} as const
