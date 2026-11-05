/**
 * 対局進行エンジン（仕様 §2, §4-1 ①）
 *
 * - 状態はプレーンなデータで、行動（Action）を適用して進める。
 * - ツモは自動。人やAIが決めるのは「手番の行動」と「他家の打牌への応答」だけ。
 * - 同じ seed と行動列からは同じ対局が再現される（MahjongGame.replay）。
 */

import { isAgari, waitingKinds } from '../rules/agari'
import { calculateHandValue, type HandValue } from '../rules/score'
import { calculateShanten } from '../rules/shanten'
import {
  countsOfTiles,
  isTerminalOrHonor,
  STANDARD_RED_FIVES,
  YAOCHU_KINDS,
  type PhysicalTile,
  type TileKind,
} from '../rules/tile'
import { isOpenMeld, STANDARD_RULES, type WinInput } from '../rules/types'
import {
  DEFAULT_GAME_CONFIG,
  SEATS,
  type Action,
  type CalledMeld,
  type DrawReason,
  type GameConfig,
  type GameEvent,
  type GameResult,
  type GameState,
  type PlayerState,
  type ResponseAction,
  type ResponseKind,
  type ResponsePhase,
  type RoundInfo,
  type RoundResult,
  type RoundState,
  type Seat,
  type TurnAction,
  type TurnPhase,
  type WinRecord,
} from './types'
import { dealFromOrder, roundSeed, shuffledTiles } from './wall'

type Deltas = [number, number, number, number]

export interface GameOptions {
  seed: number
  config?: Partial<GameConfig>
  /** テスト用：局番号ごとの山の並び（136枚）。無い局は seed から生成 */
  wallOrders?: (PhysicalTile[] | undefined)[]
}

const next = (s: Seat, n = 1): Seat => ((s + n) % 4) as Seat
const distance = (from: Seat, to: Seat): number => (to - from + 4) % 4

export class MahjongGame {
  state: GameState
  private readonly wallOrders: (PhysicalTile[] | undefined)[]

  constructor(options: GameOptions) {
    const config: GameConfig = {
      ...DEFAULT_GAME_CONFIG,
      scoring: STANDARD_RULES,
      redFives: STANDARD_RED_FIVES,
      ...options.config,
    }
    this.wallOrders = options.wallOrders ?? []
    this.state = {
      config,
      seed: options.seed,
      round: undefined as unknown as RoundState,
      roundIndex: 0,
      decisionId: 0,
      actions: [],
      log: [],
    }
    const pts = config.startingPoints
    this.startRound({ wind: 27, dealer: 0, honba: 0, kyoutaku: 0 }, [pts, pts, pts, pts])
  }

  /** seed と行動列から対局を再現する */
  static replay(options: GameOptions, actions: Action[]): MahjongGame {
    const g = new MahjongGame(options)
    for (const a of actions) g.apply(a)
    return g
  }

  // =========================================================================
  // 参照

  get round(): RoundState {
    return this.state.round
  }

  get phase() {
    return this.state.round.phase
  }

  /** 状態のコピー（外部で書き換えても影響しない） */
  snapshot(): GameState {
    return structuredClone(this.state)
  }

  doraIndicators(): TileKind[] {
    return this.round.deadWall.slice(4, 4 + this.round.doraRevealed).map((t) => t.kind)
  }

  uraDoraIndicators(): TileKind[] {
    return this.round.deadWall.slice(9, 9 + this.round.doraRevealed).map((t) => t.kind)
  }

  /** いま行動を決める必要がある席 */
  pendingSeats(): Seat[] {
    const ph = this.phase
    if (ph.type === 'turn') return [ph.seat]
    if (ph.type === 'response') {
      return SEATS.filter((s) => ph.options[s] && !ph.decisions[s])
    }
    return []
  }

  legalActions(seat: Seat): Action[] {
    const ph = this.phase
    if (ph.type === 'turn') return ph.seat === seat ? this.turnActions(ph) : []
    if (ph.type === 'response') return ph.decisions[seat] ? [] : (ph.options[seat] ?? [])
    if (ph.type === 'roundEnd') return [{ type: 'nextRound' }]
    return []
  }

  // =========================================================================
  // 行動の適用

  apply(action: Action): void {
    if (!this.isLegal(action)) {
      throw new Error(`不正な行動です: ${JSON.stringify(action)}`)
    }
    this.state.actions.push(action)
    this.state.decisionId++
    switch (action.type) {
      case 'nextRound':
        return this.goNextRound()
      case 'discard':
        return this.doDiscard(action)
      case 'tsumo':
        return this.doTsumo(action.seat)
      case 'ankan':
        return this.doAnkan(action.seat, action.kind)
      case 'kakan':
        return this.doKakan(action.seat, action.tileId)
      case 'kyuushu':
        return this.abortiveDraw('kyuushu')
      default:
        return this.recordResponse(action)
    }
  }

  private isLegal(action: Action): boolean {
    const key = actionKey(action)
    const seats: Seat[] = 'seat' in action ? [action.seat] : [0]
    return seats.some((s) => this.legalActions(s).some((a) => actionKey(a) === key))
  }

  // =========================================================================
  // 局の開始・ツモ

  private startRound(info: RoundInfo, points: number[]): void {
    const { config } = this.state
    const order =
      this.wallOrders[this.state.roundIndex] ??
      shuffledTiles(roundSeed(this.state.seed, this.state.roundIndex), config.redFives)
    const dealt = dealFromOrder(order, info.dealer)
    const player = (s: Seat): PlayerState => ({
      hand: dealt.hands[s],
      melds: [],
      river: [],
      points: points[s],
      riichi: null,
      temporaryFuriten: false,
      riichiFuriten: false,
      discardCount: 0,
    })
    this.state.round = {
      ...info,
      wall: dealt.wall,
      deadWall: dealt.deadWall,
      doraRevealed: 1,
      pendingKanDora: 0,
      rinshanUsed: 0,
      players: [player(0), player(1), player(2), player(3)],
      noCallsYet: true,
      kanBy: [],
      suukanPending: false,
      discardSeq: 0,
      pendingRiichi: null,
      phase: { type: 'turn', seat: info.dealer, drawn: null, afterCall: 'none', rinshan: false, kuikaeForbidden: [] },
    }
    this.log({
      type: 'roundStart',
      roundIndex: this.state.roundIndex,
      info: { ...info },
      points: [...points],
      doraIndicator: this.doraIndicators()[0],
    })
    this.draw(info.dealer, false)
  }

  private draw(seat: Seat, rinshan: boolean): void {
    const r = this.round
    let tile: PhysicalTile
    if (rinshan) {
      tile = r.deadWall[r.rinshanUsed++]
      // 王牌を14枚に保つため、山の最後の牌が王牌側へ移る（その分ハイテイが早まる）
      r.deadWall.push(r.wall.pop()!)
    } else {
      tile = r.wall.shift()!
    }
    r.players[seat].hand.push(tile)
    this.log({ type: 'draw', seat, tile, rinshan })
    r.phase = { type: 'turn', seat, drawn: tile, afterCall: 'none', rinshan, kuikaeForbidden: [] }
  }

  // =========================================================================
  // 手番の行動

  private turnActions(ph: TurnPhase): TurnAction[] {
    const seat = ph.seat
    const p = this.round.players[seat]
    const acts: TurnAction[] = []

    if (ph.afterCall === 'none') {
      if (this.tsumoValue(seat)) acts.push({ type: 'tsumo', seat })
      if (this.canKyuushu(seat)) acts.push({ type: 'kyuushu', seat })
      for (const kind of this.ankanKinds(seat)) acts.push({ type: 'ankan', seat, kind })
      for (const tileId of this.kakanTiles(seat)) acts.push({ type: 'kakan', seat, tileId })
    }

    if (p.riichi) {
      acts.push({ type: 'discard', seat, tileId: ph.drawn!.id })
      return acts
    }
    const forbidden = new Set(ph.kuikaeForbidden)
    const riichiOk = ph.afterCall === 'none' && this.canDeclareRiichiAtAll(seat)
    for (const t of p.hand) {
      if (forbidden.has(t.kind)) continue
      acts.push({ type: 'discard', seat, tileId: t.id })
      if (riichiOk && this.isTenpaiAfterDiscard(p, t.id)) {
        acts.push({ type: 'discard', seat, tileId: t.id, riichi: true })
      }
    }
    return acts
  }

  private canDeclareRiichiAtAll(seat: Seat): boolean {
    const p = this.round.players[seat]
    return !p.riichi && !p.melds.some(isOpenMeld) && p.points >= 1000 && this.round.wall.length >= 4
  }

  private isTenpaiAfterDiscard(p: PlayerState, tileId: number): boolean {
    const rest = p.hand.filter((t) => t.id !== tileId)
    const counts = countsOfTiles(rest)
    if (calculateShanten(counts, p.melds.length).shanten !== 0) return false
    return waitingKinds(counts, p.melds.length).length > 0
  }

  private canKyuushu(seat: Seat): boolean {
    const r = this.round
    const p = r.players[seat]
    if (!r.noCallsYet || p.discardCount > 0) return false
    const kinds = new Set(p.hand.map((t) => t.kind).filter((k) => YAOCHU_KINDS.includes(k)))
    return kinds.size >= 9
  }

  private canKanAtAll(): boolean {
    return this.round.wall.length > 0 && this.round.kanBy.length < 4
  }

  private ankanKinds(seat: Seat): TileKind[] {
    if (!this.canKanAtAll()) return []
    const ph = this.phase as TurnPhase
    const p = this.round.players[seat]
    const counts = countsOfTiles(p.hand)
    const kinds: TileKind[] = []
    counts.forEach((n, k) => {
      if (n === 4) kinds.push(k)
    })
    if (!p.riichi) return kinds
    // 立直後の暗槓：ツモった牌で、待ちが変わらない場合のみ（送り槓の禁止）
    return kinds.filter((k) => {
      if (ph.drawn?.kind !== k) return false
      const before = countsOfTiles(p.hand.filter((t) => t.id !== ph.drawn!.id))
      const after = before.slice()
      after[k] -= 3
      const w1 = waitingKinds(before, p.melds.length)
      const w2 = waitingKinds(after, p.melds.length + 1)
      return w1.length > 0 && w1.join() === w2.join()
    })
  }

  private kakanTiles(seat: Seat): number[] {
    if (!this.canKanAtAll()) return []
    const p = this.round.players[seat]
    const ids: number[] = []
    for (const m of p.melds) {
      if (m.type !== 'pon') continue
      const t = p.hand.find((h) => h.kind === m.tiles[0].kind)
      if (t) ids.push(t.id)
    }
    return ids
  }

  private doDiscard(action: Extract<TurnAction, { type: 'discard' }>): void {
    const r = this.round
    const ph = this.phase as TurnPhase
    const seat = action.seat
    const p = r.players[seat]
    const idx = p.hand.findIndex((t) => t.id === action.tileId)
    const [tile] = p.hand.splice(idx, 1)
    p.river.push({
      tile,
      tsumogiri: ph.drawn?.id === tile.id,
      riichi: !!action.riichi,
      calledBy: null,
      seq: r.discardSeq++,
    })
    p.discardCount++
    p.temporaryFuriten = false
    if (p.riichi) p.riichi.ippatsu = false
    if (action.riichi) {
      r.pendingRiichi = { seat, double: r.noCallsYet && p.discardCount === 1 }
    }
    this.revealPendingKanDora()
    this.log({ type: 'discard', seat, tile, tsumogiri: ph.drawn?.id === tile.id, riichi: !!action.riichi })

    const options: ResponsePhase['options'] = {}
    for (const other of SEATS) {
      if (other === seat) continue
      const opts = this.discardResponseOptions(other, seat, tile)
      if (opts.length > 1) options[other] = opts
    }
    if (Object.keys(options).length > 0) {
      r.phase = { type: 'response', kind: 'discard', actor: seat, tile, options, decisions: {} }
    } else {
      this.afterDiscardPassed(seat)
    }
  }

  // =========================================================================
  // 応答（ロン・ポン・チー・大明槓）

  private discardResponseOptions(seat: Seat, discarder: Seat, tile: PhysicalTile): ResponseAction[] {
    const r = this.round
    const p = r.players[seat]
    const opts: ResponseAction[] = []
    if (this.ronValue(seat, tile, 'discard')) opts.push({ type: 'ron', seat })
    if (r.wall.length > 0 && !p.riichi) {
      const same = p.hand.filter((t) => t.kind === tile.kind)
      for (const pair of distinctCombos(same, 2)) {
        if (this.hasDiscardAfterCall(p, pair, [tile.kind])) {
          opts.push({ type: 'pon', seat, tileIds: [pair[0].id, pair[1].id] })
        }
      }
      if (same.length === 3 && r.kanBy.length < 4) opts.push({ type: 'daiminkan', seat })
      if (seat === next(discarder) && tile.kind < 27) {
        for (const pair of this.chiCombos(p, tile)) {
          if (this.hasDiscardAfterCall(p, pair, chiForbidden(tile.kind, pair))) {
            opts.push({ type: 'chi', seat, tileIds: [pair[0].id, pair[1].id] })
          }
        }
      }
    }
    if (opts.length > 0) opts.push({ type: 'pass', seat })
    return opts
  }

  private chiCombos(p: PlayerState, tile: PhysicalTile): PhysicalTile[][] {
    const k = tile.kind
    const rank = k % 9
    const patterns: [number, number][] = []
    if (rank >= 2) patterns.push([k - 2, k - 1])
    if (rank >= 1 && rank <= 7) patterns.push([k - 1, k + 1])
    if (rank <= 6) patterns.push([k + 1, k + 2])
    const out: PhysicalTile[][] = []
    for (const [a, b] of patterns) {
      const as = distinctCombos(p.hand.filter((t) => t.kind === a), 1)
      const bs = distinctCombos(p.hand.filter((t) => t.kind === b), 1)
      for (const [x] of as) for (const [y] of bs) out.push([x, y])
    }
    return out
  }

  /** 鳴いた後に喰い替えにならない打牌が残るか */
  private hasDiscardAfterCall(p: PlayerState, used: PhysicalTile[], forbidden: TileKind[]): boolean {
    const usedIds = new Set(used.map((t) => t.id))
    return p.hand.some((t) => !usedIds.has(t.id) && !forbidden.includes(t.kind))
  }

  private recordResponse(action: ResponseAction): void {
    const ph = this.phase as ResponsePhase
    ph.decisions[action.seat] = action
    if (this.pendingSeats().length === 0) this.resolveResponses(ph)
  }

  private resolveResponses(ph: ResponsePhase): void {
    const r = this.round
    const ordered = SEATS.filter((s) => ph.decisions[s]).sort(
      (a, b) => distance(ph.actor, a) - distance(ph.actor, b),
    )
    // ロンを見逃した人はフリテン
    for (const s of ordered) {
      const hadRon = ph.options[s]!.some((o) => o.type === 'ron')
      if (hadRon && ph.decisions[s]!.type !== 'ron') {
        r.players[s].temporaryFuriten = true
        if (r.players[s].riichi) r.players[s].riichiFuriten = true
      }
    }

    const rons = ordered.filter((s) => ph.decisions[s]!.type === 'ron')
    if (rons.length > 0) {
      if (rons.length === 3 && this.state.config.sanchahouDraw) return this.abortiveDraw('sanchahou')
      const winners = this.state.config.doubleRon ? rons : [rons[0]]
      return this.settleRon(winners, ph.actor, ph.tile, ph.kind)
    }

    if (ph.kind === 'chankan') return this.completeKakan(ph.actor, ph.tile.id)
    if (ph.kind === 'ankanChankan') return this.completeAnkan(ph.actor, ph.tile.kind)

    const call =
      ordered.map((s) => ph.decisions[s]!).find((d) => d.type === 'pon' || d.type === 'daiminkan') ??
      ordered.map((s) => ph.decisions[s]!).find((d) => d.type === 'chi')
    if (!call) return this.afterDiscardPassed(ph.actor)

    // 鳴きが入っても立直宣言は成立する
    if (this.acceptPendingRiichi()) return
    if (r.suukanPending) return this.abortiveDraw('suukan')
    this.executeCall(call, ph.actor, ph.tile)
  }

  private executeCall(call: ResponseAction, from: Seat, tile: PhysicalTile): void {
    const r = this.round
    const seat = call.seat
    const p = r.players[seat]
    const river = r.players[from].river
    river[river.length - 1].calledBy = seat
    this.breakFirstTurnAndIppatsu()

    if (call.type === 'daiminkan') {
      const own = p.hand.filter((t) => t.kind === tile.kind)
      p.hand = p.hand.filter((t) => t.kind !== tile.kind)
      const meld: CalledMeld = { type: 'minkan', tiles: [...own, tile], from, calledTile: tile }
      p.melds.push(meld)
      this.log({ type: 'kan', seat, meld })
      this.registerKan(seat)
      r.pendingKanDora++
      this.draw(seat, true)
      return
    }
    if (call.type !== 'pon' && call.type !== 'chi') throw new Error('unreachable')
    const used = new Set(call.tileIds)
    const own = p.hand.filter((t) => used.has(t.id))
    p.hand = p.hand.filter((t) => !used.has(t.id))
    const meld: CalledMeld = { type: call.type, tiles: [...own, tile], from, calledTile: tile }
    p.melds.push(meld)
    this.log({ type: 'call', seat, meld })
    r.phase = {
      type: 'turn',
      seat,
      drawn: null,
      afterCall: call.type,
      rinshan: false,
      kuikaeForbidden: call.type === 'pon' ? [tile.kind] : chiForbidden(tile.kind, own),
    }
  }

  /** 打牌が誰にも取られなかった後の処理 */
  private afterDiscardPassed(discarder: Seat): void {
    const r = this.round
    if (this.acceptPendingRiichi()) return
    if (r.noCallsYet && SEATS.every((s) => r.players[s].discardCount === 1)) {
      const first = r.players[0].river[0].tile.kind
      if (first >= 27 && first <= 30 && SEATS.every((s) => r.players[s].river[0].tile.kind === first)) {
        return this.abortiveDraw('suufon')
      }
    }
    if (r.suukanPending) return this.abortiveDraw('suukan')
    if (r.wall.length === 0) return this.exhaustiveDraw()
    this.draw(next(discarder), false)
  }

  /** 保留中の立直を成立させる。四家立直で流局したら true */
  private acceptPendingRiichi(): boolean {
    const r = this.round
    const pending = r.pendingRiichi
    if (!pending) return false
    r.pendingRiichi = null
    const p = r.players[pending.seat]
    p.points -= 1000
    r.kyoutaku++
    p.riichi = { double: pending.double, ippatsu: true, riverIndex: p.river.length - 1 }
    this.log({ type: 'riichiAccepted', seat: pending.seat })
    if (SEATS.every((s) => r.players[s].riichi)) {
      this.abortiveDraw('suucha')
      return true
    }
    return false
  }

  private breakFirstTurnAndIppatsu(): void {
    const r = this.round
    r.noCallsYet = false
    for (const pl of r.players) if (pl.riichi) pl.riichi.ippatsu = false
  }

  // =========================================================================
  // 槓

  private doAnkan(seat: Seat, kind: TileKind): void {
    const tile = this.round.players[seat].hand.find((t) => t.kind === kind)!
    // 暗槓は国士無双のみ槍槓できる
    const options = this.chankanOptions(seat, tile, 'ankanChankan')
    if (options) {
      this.round.phase = { type: 'response', kind: 'ankanChankan', actor: seat, tile, options, decisions: {} }
      return
    }
    this.completeAnkan(seat, kind)
  }

  private completeAnkan(seat: Seat, kind: TileKind): void {
    const r = this.round
    const p = r.players[seat]
    const tiles = p.hand.filter((t) => t.kind === kind)
    p.hand = p.hand.filter((t) => t.kind !== kind)
    const meld: CalledMeld = { type: 'ankan', tiles, from: null, calledTile: null }
    p.melds.push(meld)
    this.log({ type: 'kan', seat, meld })
    this.breakFirstTurnAndIppatsu()
    this.registerKan(seat)
    // 暗槓のドラは即めくり
    r.pendingKanDora++
    this.revealPendingKanDora()
    this.draw(seat, true)
  }

  private doKakan(seat: Seat, tileId: number): void {
    const tile = this.round.players[seat].hand.find((t) => t.id === tileId)!
    const options = this.chankanOptions(seat, tile, 'chankan')
    if (options) {
      this.round.phase = { type: 'response', kind: 'chankan', actor: seat, tile, options, decisions: {} }
      return
    }
    this.completeKakan(seat, tileId)
  }

  private completeKakan(seat: Seat, tileId: number): void {
    const r = this.round
    const p = r.players[seat]
    const tile = p.hand.find((t) => t.id === tileId)!
    p.hand = p.hand.filter((t) => t.id !== tileId)
    const meld = p.melds.find((m) => m.type === 'pon' && m.tiles[0].kind === tile.kind)!
    meld.type = 'kakan'
    meld.tiles = [...meld.tiles, tile]
    this.log({ type: 'kan', seat, meld })
    this.breakFirstTurnAndIppatsu()
    this.registerKan(seat)
    r.pendingKanDora++
    this.draw(seat, true)
  }

  private chankanOptions(
    actor: Seat,
    tile: PhysicalTile,
    kind: ResponseKind,
  ): ResponsePhase['options'] | null {
    const options: ResponsePhase['options'] = {}
    for (const s of SEATS) {
      if (s === actor) continue
      if (this.ronValue(s, tile, kind)) options[s] = [{ type: 'ron', seat: s }, { type: 'pass', seat: s }]
    }
    return Object.keys(options).length > 0 ? options : null
  }

  private registerKan(seat: Seat): void {
    const r = this.round
    r.kanBy.push(seat)
    if (r.kanBy.length === 4 && new Set(r.kanBy).size > 1) r.suukanPending = true
  }

  private revealPendingKanDora(): void {
    const r = this.round
    while (r.pendingKanDora > 0) {
      r.pendingKanDora--
      r.doraRevealed++
      this.log({ type: 'doraReveal', indicator: r.deadWall[4 + r.doraRevealed - 1].kind })
    }
  }

  // =========================================================================
  // 和了

  private baseWinInput(seat: Seat): Omit<WinInput, 'hand' | 'winTile' | 'isTsumo'> {
    const r = this.round
    const p = r.players[seat]
    return {
      melds: p.melds,
      riichi: p.riichi ? (p.riichi.double ? 'double' : 'riichi') : 'none',
      isIppatsu: !!p.riichi?.ippatsu,
      seatWind: (27 + distance(r.dealer, seat)) as TileKind,
      roundWind: r.wind,
      doraIndicators: this.doraIndicators(),
      uraDoraIndicators: this.uraDoraIndicators(),
      honba: r.honba,
      kyoutaku: 0,
    }
  }

  private tsumoValue(seat: Seat): HandValue | null {
    const r = this.round
    const ph = this.phase as TurnPhase
    const p = r.players[seat]
    if (!ph.drawn) return null
    const counts = countsOfTiles(p.hand)
    if (!isAgari(counts, p.melds.length)) return null
    const first = r.noCallsYet && p.discardCount === 0 && !ph.rinshan
    const dealer = seat === r.dealer
    const v = calculateHandValue(
      {
        ...this.baseWinInput(seat),
        hand: p.hand,
        winTile: ph.drawn,
        isTsumo: true,
        isHaitei: r.wall.length === 0 && !ph.rinshan,
        isRinshan: ph.rinshan,
        isTenhou: first && dealer,
        isChiihou: first && !dealer,
      },
      this.state.config.scoring,
    )
    return v.ok ? v : null
  }

  private ronValue(seat: Seat, tile: PhysicalTile, kind: ResponseKind): HandValue | null {
    const r = this.round
    const p = r.players[seat]
    const hand = [...p.hand, tile]
    if (!isAgari(countsOfTiles(hand), p.melds.length)) return null
    if (this.isFuriten(seat)) return null
    const v = calculateHandValue(
      {
        ...this.baseWinInput(seat),
        hand,
        winTile: tile,
        isTsumo: false,
        isHoutei: kind === 'discard' && r.wall.length === 0,
        isChankan: kind !== 'discard',
      },
      this.state.config.scoring,
    )
    if (!v.ok) return null
    if (kind === 'ankanChankan' && !v.yaku.some((y) => y.id === 'kokushi' || y.id === 'kokushi13')) return null
    return v
  }

  isFuriten(seat: Seat): boolean {
    const p = this.round.players[seat]
    if (p.temporaryFuriten || p.riichiFuriten) return true
    const waits = waitingKinds(countsOfTiles(p.hand), p.melds.length)
    return p.river.some((rt) => waits.includes(rt.tile.kind))
  }

  private doTsumo(seat: Seat): void {
    const r = this.round
    const ph = this.phase as TurnPhase
    this.revealPendingKanDora()
    const value = this.tsumoValue(seat)!
    const p = r.players[seat]
    const deltas: Deltas = [0, 0, 0, 0]
    const pay = value.payment
    for (const s of SEATS) {
      if (s === seat) continue
      const amount = s === r.dealer ? pay.main + pay.mainBonus : pay.additional + pay.additionalBonus
      deltas[s] -= amount
      deltas[seat] += amount
    }
    deltas[seat] += r.kyoutaku * 1000
    r.kyoutaku = 0
    const win: WinRecord = {
      seat,
      from: null,
      value,
      hand: [...p.hand],
      winTile: ph.drawn!,
      melds: structuredClone(p.melds),
    }
    this.endRound(
      { type: 'agari', wins: [win], deltas, uraDoraIndicators: p.riichi ? this.uraDoraIndicators() : [] },
      seat === r.dealer,
      false,
    )
  }

  private settleRon(winners: Seat[], from: Seat, tile: PhysicalTile, kind: ResponseKind): void {
    const r = this.round
    // ロンされた立直宣言牌の立直は不成立
    if (r.pendingRiichi?.seat === from) r.pendingRiichi = null
    const deltas: Deltas = [0, 0, 0, 0]
    const wins: WinRecord[] = winners.map((seat) => {
      const value = this.ronValue(seat, tile, kind)!
      const amount = value.payment.main + value.payment.mainBonus
      deltas[seat] += amount
      deltas[from] -= amount
      const p = r.players[seat]
      return { seat, from, value, hand: [...p.hand, tile], winTile: tile, melds: structuredClone(p.melds) }
    })
    // 供託は放銃者から見て最も近い和了者が受け取る
    deltas[winners[0]] += r.kyoutaku * 1000
    r.kyoutaku = 0
    const anyRiichi = winners.some((s) => r.players[s].riichi)
    this.endRound(
      { type: 'agari', wins, deltas, uraDoraIndicators: anyRiichi ? this.uraDoraIndicators() : [] },
      winners.includes(r.dealer),
      false,
    )
  }

  // =========================================================================
  // 流局

  private tenpaiFlags(): [boolean, boolean, boolean, boolean] {
    const r = this.round
    return SEATS.map((s) => {
      const p = r.players[s]
      return waitingKinds(countsOfTiles(p.hand), p.melds.length).length > 0
    }) as [boolean, boolean, boolean, boolean]
  }

  private exhaustiveDraw(): void {
    const r = this.round
    const tenpai = this.tenpaiFlags()
    const deltas: Deltas = [0, 0, 0, 0]
    const nagashi = SEATS.filter((s) => {
      const river = r.players[s].river
      return river.length > 0 && river.every((rt) => isTerminalOrHonor(rt.tile.kind) && rt.calledBy === null)
    })
    if (nagashi.length > 0) {
      // 流し満貫：満貫ツモと同じ支払い（積み棒なし）
      for (const w of nagashi) {
        for (const s of SEATS) {
          if (s === w) continue
          const amount = w === r.dealer || s === r.dealer ? 4000 : 2000
          deltas[s] -= amount
          deltas[w] += amount
        }
      }
    } else {
      const n = tenpai.filter(Boolean).length
      if (n > 0 && n < 4) {
        for (const s of SEATS) deltas[s] = tenpai[s] ? 3000 / n : -3000 / (4 - n)
      }
    }
    this.endRound({ type: 'draw', reason: 'exhaustive', tenpai, nagashi, deltas }, tenpai[r.dealer], true)
  }

  private abortiveDraw(reason: Exclude<DrawReason, 'exhaustive'>): void {
    this.endRound(
      { type: 'draw', reason, tenpai: [false, false, false, false], nagashi: [], deltas: [0, 0, 0, 0] },
      true,
      true,
    )
  }

  // =========================================================================
  // 局の終了と次局

  private endRound(result: RoundResult, renchan: boolean, isDraw: boolean): void {
    const r = this.round
    r.players.forEach((p, s) => (p.points += result.deltas[s]))
    const nextInfo = this.decideNext(renchan, isDraw)
    r.phase = { type: 'roundEnd', result, next: nextInfo }
    this.log({ type: 'roundEnd', result })
  }

  private decideNext(renchan: boolean, isDraw: boolean): RoundInfo | null {
    const r = this.round
    const { config } = this.state
    const points = r.players.map((p) => p.points)
    const lastWind = config.length === 'tonpuu' ? 27 : 28
    if (config.tobi && points.some((p) => p < 0)) return null
    const isAllLast = r.wind === lastWind && r.dealer === 3
    const inExtension = r.wind > lastWind
    const reached = points.some((p) => p >= config.returnPoints)

    if (renchan) {
      const top = ranksOf(points).indexOf(0)
      if (
        (isAllLast || inExtension) &&
        config.agariYame &&
        top === r.dealer &&
        points[r.dealer] >= config.returnPoints
      ) {
        return null
      }
      if (inExtension && reached) return null
      return { wind: r.wind, dealer: r.dealer, honba: r.honba + 1, kyoutaku: r.kyoutaku }
    }
    const dealer = next(r.dealer)
    const wind = dealer === 0 ? r.wind + 1 : r.wind
    if ((isAllLast || inExtension) && (reached || wind > lastWind + 1)) return null
    return { wind, dealer, honba: isDraw ? r.honba + 1 : 0, kyoutaku: r.kyoutaku }
  }

  private goNextRound(): void {
    const ph = this.phase
    if (ph.type !== 'roundEnd') return
    const points = this.round.players.map((p) => p.points)
    if (ph.next) {
      this.state.roundIndex++
      this.startRound(ph.next, points)
      return
    }
    // 残った供託はトップが受け取る
    const ranks = ranksOf(points)
    points[ranks.indexOf(0)] += this.round.kyoutaku * 1000
    this.round.kyoutaku = 0
    const result: GameResult = {
      finalPoints: points as GameResult['finalPoints'],
      ranks: ranksOf(points) as GameResult['ranks'],
    }
    this.round.players.forEach((p, s) => (p.points = points[s]))
    this.round.phase = { type: 'gameEnd', result }
    this.log({ type: 'gameEnd', result })
  }

  private log(e: GameEvent): void {
    this.state.log.push(structuredClone(e))
  }
}

// ===========================================================================
// ヘルパー

/** 順位（0 = 1位）。同点は起家（席0）に近い方が上 */
export function ranksOf(points: number[]): number[] {
  const order = [0, 1, 2, 3].sort((a, b) => points[b] - points[a] || a - b)
  const ranks = [0, 0, 0, 0]
  order.forEach((s, i) => (ranks[s] = i))
  return ranks
}

/** チーの喰い替え禁止牌（現物と、両面で鳴いた場合の筋） */
function chiForbidden(called: TileKind, own: PhysicalTile[]): TileKind[] {
  const kinds = own.map((t) => t.kind).sort((a, b) => a - b)
  const out = [called]
  const rank = called % 9
  if (kinds[0] === called + 1 && kinds[1] === called + 2 && rank <= 5) out.push(called + 3)
  if (kinds[0] === called - 2 && kinds[1] === called - 1 && rank >= 3) out.push(called - 3)
  return out
}

/** 同じ種類の牌から n 枚選ぶ組み合わせ（赤の有無が同じものは1つにまとめる） */
function distinctCombos(tiles: PhysicalTile[], n: number): PhysicalTile[][] {
  const out: PhysicalTile[][] = []
  const seen = new Set<string>()
  const pick = (start: number, acc: PhysicalTile[]) => {
    if (acc.length === n) {
      const key = acc.map((t) => `${t.kind}${t.red ? 'r' : ''}`).sort().join()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(acc.slice())
      }
      return
    }
    for (let i = start; i < tiles.length; i++) {
      acc.push(tiles[i])
      pick(i + 1, acc)
      acc.pop()
    }
  }
  pick(0, [])
  return out
}

function actionKey(a: Action): string {
  if ('tileIds' in a) return JSON.stringify({ ...a, tileIds: [...a.tileIds].sort((x, y) => x - y) })
  if (a.type === 'discard') return JSON.stringify({ type: a.type, seat: a.seat, tileId: a.tileId, riichi: !!a.riichi })
  return JSON.stringify(a)
}
