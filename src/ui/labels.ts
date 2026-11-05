/**
 * 表示用の文言
 */
import type { DrawReason, Seat } from '../engine/game/types'
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
