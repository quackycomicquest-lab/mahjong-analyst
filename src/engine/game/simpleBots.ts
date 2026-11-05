/**
 * 簡易ボット（テスト・動作確認用）
 *
 * 本番のAIプレイヤー（仕様 §4-1 ②）ではない。対局エンジンを最後まで回して
 * 不変条件を確かめるためのもの。どちらもプレイヤー視点（PlayerView）だけを見る。
 */

import { discardOptions } from '../rules/efficiency'
import { countsOfTiles } from '../rules/tile'
import type { Action } from './types'
import type { PlayerView } from './view'

export type Bot = (view: PlayerView) => Action

/** 和了できれば和了し、それ以外はランダム（鳴き・槓・立直も一定確率で選ぶ） */
export function randomBot(rand: () => number): Bot {
  return (view) => {
    const acts = view.legalActions
    const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron')
    if (win && rand() < 0.95) return win
    const calls = acts.filter((a) => ['pon', 'chi', 'daiminkan', 'ankan', 'kakan'].includes(a.type))
    if (calls.length > 0 && rand() < 0.4) return calls[Math.floor(rand() * calls.length)]
    const riichi = acts.filter((a) => a.type === 'discard' && a.riichi)
    if (riichi.length > 0 && rand() < 0.7) return riichi[Math.floor(rand() * riichi.length)]
    const kyuushu = acts.find((a) => a.type === 'kyuushu')
    if (kyuushu && rand() < 0.5) return kyuushu
    const pass = acts.find((a) => a.type === 'pass')
    if (pass) return pass
    const discards = acts.filter((a) => a.type === 'discard' && !a.riichi)
    return discards[Math.floor(rand() * discards.length)] ?? acts[0]
  }
}

/** 牌効率で打ちつつ、一定確率で鳴き・槓をするボット（和了が多く起きる対局を作る用） */
export function callingEfficiencyBot(rand: () => number, callRate = 0.3): Bot {
  return (view) => {
    const acts = view.legalActions
    const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron')
    if (win) return win
    const kans = acts.filter((a) => a.type === 'ankan' || a.type === 'kakan' || a.type === 'daiminkan')
    if (kans.length > 0 && rand() < 0.5) return kans[0]
    const calls = acts.filter((a) => a.type === 'pon' || a.type === 'chi')
    if (calls.length > 0 && rand() < callRate) return calls[Math.floor(rand() * calls.length)]
    return efficiencyBot(view)
  }
}

/** 牌効率だけで打つボット（和了・立直はする、鳴かない） */
export const efficiencyBot: Bot = (view) => {
  const acts = view.legalActions
  const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron')
  if (win) return win
  const pass = acts.find((a) => a.type === 'pass')
  if (pass) return pass
  if (acts[0]?.type === 'nextRound') return acts[0]
  const discards = acts.filter((a) => a.type === 'discard')
  const allowedKinds = new Set(
    discards.map((a) => view.hand.find((t) => t.id === (a as { tileId: number }).tileId)!.kind),
  )
  const melds = view.players[view.seat].melds.length
  const best = discardOptions(countsOfTiles(view.hand), melds).find((o) => allowedKinds.has(o.discard))
  const pick = (riichi: boolean) =>
    discards.find((a) => {
      const t = view.hand.find((h) => h.id === (a as { tileId: number }).tileId)!
      return t.kind === best?.discard && !!(a as { riichi?: boolean }).riichi === riichi
    })
  return pick(true) ?? pick(false) ?? discards[0] ?? acts[0]
}
