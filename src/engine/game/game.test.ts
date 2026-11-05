import { describe, expect, it } from 'vitest'
import { kindOf } from '../rules/tile'
import { MahjongGame } from './game'
import { callingEfficiencyBot, efficiencyBot, randomBot } from './simpleBots'
import { buildWallOrder, checkInvariants, playToEnd } from './testUtils'
import type { Action, GameEvent, RoundResult, Seat } from './types'
import { createRng } from './wall'
import { getPlayerView } from './view'

const discardOf = (game: MahjongGame, seat: Seat, notation: string, riichi = false): Action => {
  const kind = kindOf(notation.slice(-1) as 'm' | 'p' | 's' | 'z', Number(notation[0]))
  const t = game.round.players[seat].hand.find((h) => h.kind === kind)
  if (!t) throw new Error(`席${seat}は ${notation} を持っていません`)
  return { type: 'discard', seat, tileId: t.id, riichi }
}

const passAll = (game: MahjongGame) => {
  for (const s of game.pendingSeats()) game.apply({ type: 'pass', seat: s })
}

/** 対局終了後の記録を検証する（点数移動・終わり方）。終わり方の集計を endings に足す */
function verifyFinishedGame(game: MahjongGame, endings: Map<string, number>): void {
  const ph = game.phase
  if (ph.type !== 'gameEnd') throw new Error('終わっていない')
  const start = game.state.config.startingPoints
  expect([...ph.result.ranks].sort()).toEqual([0, 1, 2, 3])
  expect(ph.result.finalPoints.reduce((a, b) => a + b, 0)).toBe(start * 4)

  let kyoutaku = 0
  let lastStart: Extract<GameEvent, { type: 'roundStart' }> | null = null
  for (const e of game.state.log) {
    if (e.type === 'roundStart') {
      kyoutaku = e.info.kyoutaku
      lastStart = e
    }
    if (e.type === 'riichiAccepted') kyoutaku++
    if (e.type !== 'roundEnd') continue
    const res = e.result
    const key = res.type === 'agari' ? `agari:${res.wins.length}` : `draw:${res.reason}`
    endings.set(key, (endings.get(key) ?? 0) + 1)
    const sum = res.deltas.reduce((a, b) => a + b, 0)
    if (res.type === 'agari') {
      // 和了：点数の移動の合計 = 和了者が受け取った供託
      expect(sum).toBe(kyoutaku * 1000)
      // 各和了者の収入（積み棒込み）と、実際の点数移動が一致する
      for (const w of res.wins) {
        const income = w.value.payment.total + (w === res.wins[0] ? kyoutaku * 1000 : 0)
        expect(res.deltas[w.seat]).toBe(income)
      }
    } else {
      expect(sum).toBe(0)
      if (res.reason === 'exhaustive' && res.nagashi.length === 0) {
        // ノーテン罰符：場に3000点
        const n = res.tenpai.filter(Boolean).length
        const want = res.tenpai.map((t) => (n === 0 || n === 4 ? 0 : t ? 3000 / n : -3000 / (4 - n)))
        expect(res.deltas).toEqual(want)
      }
    }
  }
  // 終わり方：飛び、またはオーラス以降まで進んでいる
  const lastWind = game.state.config.length === 'tonpuu' ? 27 : 28
  const busted = ph.result.finalPoints.some((p) => p < 0)
  const info = lastStart!.info
  const reachedEnd = info.wind > lastWind || (info.wind === lastWind && info.dealer === 3)
  expect(busted || reachedEnd).toBe(true)
}

describe('対局を最後まで回す（不変条件の確認）', () => {
  it('ランダムボット（鳴き・槓・立直あり）で東南戦 40局', { timeout: 120000 }, () => {
    const endings = new Map<string, number>()
    for (let seed = 1; seed <= 40; seed++) {
      const bot = randomBot(createRng(seed * 7919))
      const game = new MahjongGame({ seed })
      playToEnd(game, { 0: bot, 1: bot, 2: bot, 3: bot })
      verifyFinishedGame(game, endings)
    }
    expect(endings.get('draw:exhaustive')).toBeGreaterThan(0)
  })

  it('牌効率＋鳴きボットで東南戦 20局（和了・ダブロン・飛びが起きる）', { timeout: 120000 }, () => {
    const endings = new Map<string, number>()
    for (let seed = 1; seed <= 20; seed++) {
      const bot = callingEfficiencyBot(createRng(seed * 31))
      const game = new MahjongGame({ seed })
      playToEnd(game, { 0: bot, 1: bot, 2: bot, 3: bot })
      verifyFinishedGame(game, endings)
    }
    expect(endings.get('agari:1')).toBeGreaterThan(100)
  })

  it('牌効率ボットで東風戦 10局', { timeout: 120000 }, () => {
    const endings = new Map<string, number>()
    for (let seed = 100; seed < 110; seed++) {
      const game = new MahjongGame({ seed, config: { length: 'tonpuu' } })
      playToEnd(game, { 0: efficiencyBot, 1: efficiencyBot, 2: efficiencyBot, 3: efficiencyBot })
      verifyFinishedGame(game, endings)
    }
  })

  it('同じ seed と行動列から同じ対局を再現できる', () => {
    const bot = randomBot(createRng(42))
    const game = new MahjongGame({ seed: 7 })
    playToEnd(game, { 0: bot, 1: bot, 2: bot, 3: bot })
    const replayed = MahjongGame.replay({ seed: 7 }, game.state.actions)
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(game.state))
  })

  it('不正な行動は拒否する', () => {
    const game = new MahjongGame({ seed: 1 })
    expect(() => game.apply({ type: 'pass', seat: 1 })).toThrow()
    expect(() => game.apply({ type: 'discard', seat: 1, tileId: 0 })).toThrow()
  })
})

describe('プレイヤー視点', () => {
  it('他家の手牌・山・裏ドラを含まない', () => {
    const game = new MahjongGame({ seed: 3 })
    const view = getPlayerView(game, 1)
    const json = JSON.stringify(view)
    expect(view.hand).toHaveLength(13)
    expect(view.players[0].handCount).toBe(14)
    expect(json).not.toContain('"wall"')
    expect(json).not.toContain('deadWall')
    for (const t of game.round.players[0].hand) {
      expect(view.hand.some((h) => h.id === t.id)).toBe(false)
    }
    expect(view.legalActions).toEqual([])
    expect(getPlayerView(game, 0).drawn).not.toBeNull()
  })
})

describe('局の個別シナリオ', () => {
  // ドラ表示牌は 1s（ドラ2s）で統一
  const OTHERS: [string, string] = ['2468m2468p2468s1z', '1357m1357p1357s2z']
  // 席1: 123456789m 34p 55s（2p・5p待ち、平和・一気通貫）
  const ronHands: [string, string, string, string] = ['5p19m19p19s123467z', '123456789m34p55s', ...OTHERS]

  it('ロン：子の平和・一気通貫 3翻30符 3900 を親が払う', () => {
    const game = new MahjongGame({ seed: 1, wallOrders: [buildWallOrder({ hands: ronHands, draws: '7z', dora: '1s' })] })
    game.apply(discardOf(game, 0, '5p'))
    expect(game.legalActions(1).some((a) => a.type === 'ron')).toBe(true)
    game.apply({ type: 'ron', seat: 1 })
    const ph = game.phase
    if (ph.type !== 'roundEnd' || ph.result.type !== 'agari') throw new Error('和了になっていない')
    expect(ph.result.wins[0].value.han).toBe(3)
    expect(ph.result.deltas).toEqual([-3900, 3900, 0, 0])
    expect(ph.next).toMatchObject({ dealer: 1, honba: 0 })
  })

  it('見逃すと同巡内フリテン、自分の河にある待ちは永久フリテン', () => {
    const game = new MahjongGame({
      seed: 1,
      wallOrders: [buildWallOrder({ hands: ronHands, draws: '7z2p', dora: '1s' })],
    })
    game.apply(discardOf(game, 0, '5p'))
    game.apply({ type: 'pass', seat: 1 })
    expect(game.round.players[1].temporaryFuriten).toBe(true)
    // 席1は2pをツモ（ツモ和了できる）が、あえて2pを切る
    expect(game.legalActions(1)).toContainEqual({ type: 'tsumo', seat: 1 })
    game.apply(discardOf(game, 1, '2p'))
    expect(game.round.players[1].temporaryFuriten).toBe(false)
    expect(game.isFuriten(1)).toBe(true) // 待ちの2pが自分の河にある
  })

  it('立直：宣言牌が通ると1000点を供託し、一発の権利を持つ', () => {
    const hands: [string, string, string, string] = ['123456789m34p55s', '19m19p19s1234567z', ...OTHERS]
    const game = new MahjongGame({ seed: 1, wallOrders: [buildWallOrder({ hands, draws: '7z', dora: '1s' })] })
    const riichi = discardOf(game, 0, '7z', true)
    expect(game.legalActions(0)).toContainEqual(riichi)
    game.apply(riichi)
    passAll(game)
    expect(game.round.players[0].points).toBe(24000)
    expect(game.round.kyoutaku).toBe(1)
    expect(game.round.players[0].riichi).toMatchObject({ double: true, ippatsu: true })
    checkInvariants(game)
  })

  it('チー後の喰い替え（現物・筋）は切れない', () => {
    // 席1が 45m で 3m をチー → 3m・6m は切れない
    const hands: [string, string, string, string] = ['39m19p19s1234567z', '3456m119p258s135z', ...OTHERS]
    const game = new MahjongGame({ seed: 1, wallOrders: [buildWallOrder({ hands, draws: '7z', dora: '1s' })] })
    game.apply(discardOf(game, 0, '3m'))
    const chi = game.legalActions(1).find((a) => a.type === 'chi')
    expect(chi).toBeDefined()
    for (const s of game.pendingSeats()) if (s !== 1) game.apply({ type: 'pass', seat: s })
    game.apply(chi!)
    const discards = game
      .legalActions(1)
      .filter((a) => a.type === 'discard')
      .map((a) => game.round.players[1].hand.find((t) => t.id === (a as { tileId: number }).tileId)!.kind)
    expect(discards).not.toContain(kindOf('m', 3))
    expect(discards).not.toContain(kindOf('m', 6))
    expect(discards.length).toBeGreaterThan(0)
  })

  it('ダブロン：2人に支払い、和了者は放銃者に近い順', () => {
    // 席1・席3 とも 2p/5p 待ち。親が 5p を切る
    const hands: [string, string, string, string] = [
      '5p19m19p19s123467z',
      '123456789m34p55s',
      OTHERS[0],
      '123456789s34p77p',
    ]
    const game = new MahjongGame({ seed: 1, wallOrders: [buildWallOrder({ hands, draws: '7z', dora: '1s' })] })
    game.apply(discardOf(game, 0, '5p'))
    game.apply({ type: 'ron', seat: 3 })
    game.apply({ type: 'ron', seat: 1 })
    const ph = game.phase
    if (ph.type !== 'roundEnd' || ph.result.type !== 'agari') throw new Error('和了になっていない')
    expect(ph.result.wins.map((w) => w.seat)).toEqual([1, 3])
    expect(ph.result.deltas[0]).toBe(-(ph.result.deltas[1] + ph.result.deltas[3]))
  })

  it('四風連打で流局（親は連荘・本場+1）', () => {
    const hands: [string, string, string, string] = [
      '19m19p19s1234556z',
      '28m28p28s1234667z',
      '37m37p37s1234777z',
      '456m456p456s7m7p7s1z',
    ]
    const game = new MahjongGame({
      seed: 1,
      wallOrders: [buildWallOrder({ hands, draws: '2m3m4m6m', dora: '1s' })],
    })
    for (const s of [0, 1, 2, 3] as Seat[]) {
      if (game.phase.type === 'response') passAll(game)
      game.apply(discardOf(game, s, '1z'))
    }
    if (game.phase.type === 'response') passAll(game)
    const ph = game.phase
    if (ph.type !== 'roundEnd') throw new Error('流局していない')
    expect((ph.result as Extract<RoundResult, { type: 'draw' }>).reason).toBe('suufon')
    expect(ph.next).toMatchObject({ dealer: 0, honba: 1 })
  })

  it('九種九牌を宣言できる', () => {
    const hands: [string, string, string, string] = ['19m19p19s1234z258m', '123456789m34p55s', ...OTHERS]
    const game = new MahjongGame({ seed: 1, wallOrders: [buildWallOrder({ hands, draws: '7z', dora: '1s' })] })
    expect(game.legalActions(0)).toContainEqual({ type: 'kyuushu', seat: 0 })
    game.apply({ type: 'kyuushu', seat: 0 })
    expect(game.phase).toMatchObject({ type: 'roundEnd', result: { reason: 'kyuushu' } })
  })
})
