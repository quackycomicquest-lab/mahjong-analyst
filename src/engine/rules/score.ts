/**
 * 和了の役・符・点数計算（仕様 §4-1 ① Rules Engine）
 *
 * 一般形は「全ての面子分解 × 和了牌の取り方（待ちの解釈）」を列挙し、
 * 最も高い点数になる解釈を採用する。七対子・国士は別形として評価する。
 */

import {
  decomposeRegular,
  isChiitoitsuForm,
  isKokushiForm,
  type Decomposition,
} from './agari'
import {
  countsOfTiles,
  isHonor,
  isTerminal,
  isTerminalOrHonor,
  type PhysicalTile,
  type TileKind,
} from './tile'
import { isKanMeld, isOpenMeld, STANDARD_RULES, type Meld, type RuleConfig, type WinInput } from './types'
import { YAKU, type YakuId } from './yaku'

// ---------------------------------------------------------------------------
// 結果の型

export interface YakuResult {
  id: YakuId
  name: string
  /** 翻数（役満は 13 × 倍数） */
  han: number
}

export interface FuDetail {
  reason: string
  fu: number
}

export type WaitType = 'ryanmen' | 'kanchan' | 'penchan' | 'tanki' | 'shanpon'

export type LimitLevel =
  | ''
  | 'mangan'
  | 'haneman'
  | 'baiman'
  | 'sanbaiman'
  | 'kazoeYakuman'
  | 'yakuman'

/**
 * 支払い。
 * - ロン: main = 放銃者の支払い、additional = 0
 * - 親のツモ: main = additional = 子1人あたり
 * - 子のツモ: main = 親の支払い、additional = 子1人あたり
 * bonus は積み棒分。total は和了者の収入合計（供託含む）。
 */
export interface Payment {
  main: number
  additional: number
  mainBonus: number
  additionalBonus: number
  kyoutakuBonus: number
  total: number
}

export interface HandValue {
  ok: true
  han: number
  fu: number
  fuDetails: FuDetail[]
  yaku: YakuResult[]
  /** 役満の倍数（役満でなければ 0） */
  yakumanMultiplier: number
  level: LimitLevel
  isDealer: boolean
  /** 採用された待ちの解釈（七対子・国士は tanki） */
  wait: WaitType
  payment: Payment
}

export interface HandError {
  ok: false
  reason: 'invalid_input' | 'not_agari' | 'no_yaku'
  message: string
}

// ---------------------------------------------------------------------------
// 内部表現

type BlockType = 'shuntsu' | 'koutsu' | 'kantsu'

interface Block {
  type: BlockType
  kind: TileKind
  /** 明刻・明槓・チー、またはロンで完成した刻子 */
  open: boolean
}

interface Placement {
  wait: WaitType
  /** 和了牌を含む門前面子の index（tanki は -1） */
  setIndex: number
}

interface Context {
  input: WinInput
  rules: RuleConfig
  menzen: boolean
  isDealer: boolean
  allCounts: number[]
  meldBlocks: Block[]
  winKind: TileKind
  dora: number
  aka: number
  ura: number
}

interface Candidate {
  yaku: YakuResult[]
  han: number
  fu: number
  rawFu: number
  fuDetails: FuDetail[]
  yakumanMultiplier: number
  wait: WaitType
}

const DRAGONS = [31, 32, 33]
const WINDS = [27, 28, 29, 30]
/** 緑一色に使える牌: 2索 3索 4索 6索 8索 發 */
const GREEN = new Set([19, 20, 21, 23, 25, 32])

// ---------------------------------------------------------------------------
// 公開API

export function calculateHandValue(
  input: WinInput,
  rules: RuleConfig = STANDARD_RULES,
): HandValue | HandError {
  const invalid = validate(input)
  if (invalid) return { ok: false, reason: 'invalid_input', message: invalid }

  const counts = countsOfTiles(input.hand)
  const allTiles: PhysicalTile[] = [...input.hand, ...input.melds.flatMap((m) => m.tiles)]
  const riichi = input.riichi !== 'none'
  const ctx: Context = {
    input,
    rules,
    menzen: !input.melds.some(isOpenMeld),
    isDealer: input.seatWind === 27,
    allCounts: countsOfTiles(allTiles),
    meldBlocks: input.melds.map(meldToBlock),
    winKind: input.winTile.kind,
    dora: countDora(allTiles, input.doraIndicators),
    aka: allTiles.filter((t) => t.red).length,
    ura: riichi ? countDora(allTiles, input.uraDoraIndicators ?? []) : 0,
  }

  const candidates: Candidate[] = []
  for (const d of decomposeRegular(counts)) {
    for (const p of placements(d, ctx.winKind)) candidates.push(evaluateRegular(d, p, ctx))
  }
  if (input.melds.length === 0 && isChiitoitsuForm(counts)) candidates.push(evaluateChiitoitsu(ctx))
  if (input.melds.length === 0 && isKokushiForm(counts)) candidates.push(evaluateKokushi(ctx))

  if (candidates.length === 0) {
    return { ok: false, reason: 'not_agari', message: '和了形ではありません' }
  }

  let best: { c: Candidate; payment: Payment; level: LimitLevel } | null = null
  for (const c of candidates) {
    if (c.han === 0) continue
    const { payment, level } = computePayment(c, ctx)
    if (!best || compare(c, payment, best.c, best.payment) > 0) best = { c, payment, level }
  }
  if (!best) return { ok: false, reason: 'no_yaku', message: '役がありません' }

  return {
    ok: true,
    han: best.c.han,
    fu: best.c.fu,
    fuDetails: best.c.fuDetails,
    yaku: best.c.yaku,
    yakumanMultiplier: best.c.yakumanMultiplier,
    level: best.level,
    isDealer: ctx.isDealer,
    wait: best.c.wait,
    payment: best.payment,
  }
}

/** ドラ表示牌 → ドラ */
export function doraFromIndicator(ind: TileKind): TileKind {
  if (ind < 27) return ind - (ind % 9) + ((ind % 9) + 1) % 9
  if (ind <= 30) return 27 + ((ind - 27 + 1) % 4)
  return 31 + ((ind - 31 + 1) % 3)
}

// ---------------------------------------------------------------------------
// 入力検証

function validate(input: WinInput): string | null {
  const { hand, melds } = input
  if (hand.length + melds.length * 3 !== 14) {
    return `牌の枚数が不正です（門前${hand.length}枚・副露${melds.length}組）`
  }
  if (!hand.some((t) => t.id === input.winTile.id)) return '和了牌が手牌に含まれていません'
  const ids = [...hand, ...melds.flatMap((m) => m.tiles)].map((t) => t.id)
  if (new Set(ids).size !== ids.length) return '同じ個体IDの牌が重複しています'
  for (const m of melds) {
    const err = validateMeld(m)
    if (err) return err
  }
  const open = melds.some(isOpenMeld)
  const tsumo = input.isTsumo
  if (input.riichi !== 'none' && open) return '副露している手で立直はできません'
  if (input.isIppatsu && input.riichi === 'none') return '一発には立直が必要です'
  if (input.isHaitei && !tsumo) return '海底摸月はツモ和了のみです'
  if (input.isHoutei && tsumo) return '河底撈魚はロン和了のみです'
  if (input.isRinshan && (!tsumo || !melds.some(isKanMeld))) return '嶺上開花はカン後のツモ和了のみです'
  if (input.isRinshan && input.isHaitei) return '嶺上開花と海底摸月は複合しません'
  if (input.isChankan && tsumo) return '槍槓はロン和了のみです'
  const dealer = input.seatWind === 27
  if (input.isTenhou && (!dealer || !tsumo || melds.length > 0)) return '天和は親の配牌ツモ和了のみです'
  if (input.isChiihou && (dealer || !tsumo || melds.length > 0)) return '地和は子の第一ツモ和了のみです'
  for (const w of [input.seatWind, input.roundWind]) {
    if (w < 27 || w > 30) return '風牌の指定が不正です'
  }
  return null
}

function validateMeld(m: Meld): string | null {
  const kinds = m.tiles.map((t) => t.kind).sort((a, b) => a - b)
  const same = kinds.every((k) => k === kinds[0])
  if (m.type === 'chi') {
    const ok =
      kinds.length === 3 &&
      kinds[0] < 27 &&
      kinds[0] % 9 <= 6 &&
      kinds[1] === kinds[0] + 1 &&
      kinds[2] === kinds[0] + 2
    return ok ? null : 'チーの構成牌が不正です'
  }
  if (m.type === 'pon') return kinds.length === 3 && same ? null : 'ポンの構成牌が不正です'
  return kinds.length === 4 && same ? null : 'カンの構成牌が不正です'
}

// ---------------------------------------------------------------------------
// 和了牌の取り方

function placements(d: Decomposition, winKind: TileKind): Placement[] {
  const out: Placement[] = []
  const seen = new Set<string>()
  const add = (p: Placement, key: string) => {
    if (!seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  if (d.pair === winKind) add({ wait: 'tanki', setIndex: -1 }, 'tanki')
  d.sets.forEach((s, i) => {
    if (s.type === 'koutsu') {
      if (s.kind === winKind) add({ wait: 'shanpon', setIndex: i }, `k${s.kind}`)
      return
    }
    const pos = winKind - s.kind
    if (pos < 0 || pos > 2) return
    const rank = s.kind % 9
    let wait: WaitType
    if (pos === 1) wait = 'kanchan'
    else if ((pos === 0 && rank === 6) || (pos === 2 && rank === 0)) wait = 'penchan'
    else wait = 'ryanmen'
    add({ wait, setIndex: i }, `s${s.kind}:${pos}`)
  })
  return out
}

function meldToBlock(m: Meld): Block {
  const kind = Math.min(...m.tiles.map((t) => t.kind))
  if (m.type === 'chi') return { type: 'shuntsu', kind, open: true }
  if (m.type === 'pon') return { type: 'koutsu', kind, open: true }
  return { type: 'kantsu', kind, open: m.type !== 'ankan' }
}

// ---------------------------------------------------------------------------
// 一般形の評価

function evaluateRegular(d: Decomposition, p: Placement, ctx: Context): Candidate {
  const { input, menzen } = ctx
  const concealed: Block[] = d.sets.map((s, i) => ({
    type: s.type,
    kind: s.kind,
    // ロンで完成させた刻子は明刻扱い
    open: s.type === 'koutsu' && i === p.setIndex && p.wait === 'shanpon' && !input.isTsumo,
  }))
  const blocks = [...concealed, ...ctx.meldBlocks]
  const pair = d.pair

  const { fu, rawFu, details, extra } = calculateFu(blocks, pair, p.wait, ctx)
  const triplets = blocks.filter((b) => b.type !== 'shuntsu')
  const shuntsu = blocks.filter((b) => b.type === 'shuntsu')
  const concealedTriplets = triplets.filter((b) => !b.open).length
  const kantsu = blocks.filter((b) => b.type === 'kantsu').length
  const tripletKinds = new Set(triplets.map((b) => b.kind))

  // --- 役満
  const yakuman: YakuId[] = []
  pushSituationalYakuman(yakuman, ctx)
  if (DRAGONS.every((k) => tripletKinds.has(k))) yakuman.push('daisangen')
  const windTriplets = WINDS.filter((k) => tripletKinds.has(k)).length
  if (windTriplets === 4) yakuman.push('daisuushii')
  else if (windTriplets === 3 && WINDS.includes(pair)) yakuman.push('shousuushii')
  pushTileSetYakuman(yakuman, ctx)
  if (input.melds.length === 0 && isChuurenShape(ctx.allCounts)) {
    const n = ctx.allCounts[ctx.winKind]
    yakuman.push(n === 2 || n === 4 ? 'junseiChuuren' : 'chuuren')
  }
  if (menzen && concealedTriplets === 4) yakuman.push(p.wait === 'tanki' ? 'suuankouTanki' : 'suuankou')
  if (kantsu === 4) yakuman.push('suukantsu')
  if (yakuman.length > 0) return yakumanCandidate(yakuman, ctx, fu, rawFu, details, p.wait)

  // --- 通常役
  const ids: YakuId[] = []
  pushCommonYaku(ids, ctx)
  if (menzen && extra === 0) ids.push('pinfu')
  if (isTanyao(ctx)) ids.push('tanyao')
  if (menzen) {
    const seqCount = new Map<number, number>()
    for (const s of shuntsu) seqCount.set(s.kind, (seqCount.get(s.kind) ?? 0) + 1)
    let peiko = 0
    for (const n of seqCount.values()) peiko += Math.floor(n / 2)
    if (peiko >= 2) ids.push('ryanpeikou')
    else if (peiko === 1) ids.push('iipeikou')
  }
  if (tripletKinds.has(31)) ids.push('haku')
  if (tripletKinds.has(32)) ids.push('hatsu')
  if (tripletKinds.has(33)) ids.push('chun')
  if (tripletKinds.has(input.seatWind)) ids.push('seatWind')
  if (tripletKinds.has(input.roundWind)) ids.push('roundWind')
  pushFlushYaku(ids, ctx)

  if (shuntsu.length > 0) {
    const blockHasYaochu = (b: Block) =>
      b.type === 'shuntsu' ? b.kind % 9 === 0 || b.kind % 9 === 6 : isTerminalOrHonor(b.kind)
    if (blocks.every(blockHasYaochu) && isTerminalOrHonor(pair)) {
      const hasHonor = ctx.allCounts.slice(27).some((n) => n > 0)
      ids.push(hasHonor ? 'chanta' : 'junchan')
    }
    const seqKinds = new Set(shuntsu.map((b) => b.kind))
    if ([0, 9, 18].some((s) => seqKinds.has(s) && seqKinds.has(s + 3) && seqKinds.has(s + 6))) {
      ids.push('ittsu')
    }
    for (let r = 0; r < 7; r++) {
      if (seqKinds.has(r) && seqKinds.has(r + 9) && seqKinds.has(r + 18)) {
        ids.push('sanshoku')
        break
      }
    }
  }
  if (triplets.length === 4) ids.push('toitoi')
  if (concealedTriplets === 3) ids.push('sanankou')
  for (let r = 0; r < 9; r++) {
    if (tripletKinds.has(r) && tripletKinds.has(r + 9) && tripletKinds.has(r + 18)) {
      ids.push('sanshokuDoukou')
      break
    }
  }
  if (kantsu === 3) ids.push('sankantsu')
  if (DRAGONS.filter((k) => tripletKinds.has(k)).length === 2 && DRAGONS.includes(pair)) {
    ids.push('shousangen')
  }
  if (isHonroutou(ctx)) ids.push('honroutou')

  return normalCandidate(ids, ctx, fu, rawFu, details, p.wait)
}

// ---------------------------------------------------------------------------
// 七対子・国士

function evaluateChiitoitsu(ctx: Context): Candidate {
  const details = [{ reason: '七対子', fu: 25 }]
  const yakuman: YakuId[] = []
  pushSituationalYakuman(yakuman, ctx)
  pushTileSetYakuman(yakuman, ctx)
  if (yakuman.length > 0) return yakumanCandidate(yakuman, ctx, 25, 25, details, 'tanki')

  const ids: YakuId[] = ['chiitoitsu']
  pushCommonYaku(ids, ctx)
  if (isTanyao(ctx)) ids.push('tanyao')
  pushFlushYaku(ids, ctx)
  if (isHonroutou(ctx)) ids.push('honroutou')
  return normalCandidate(ids, ctx, 25, 25, details, 'tanki')
}

function evaluateKokushi(ctx: Context): Candidate {
  const yakuman: YakuId[] = []
  pushSituationalYakuman(yakuman, ctx)
  yakuman.push(ctx.allCounts[ctx.winKind] === 2 ? 'kokushi13' : 'kokushi')
  return yakumanCandidate(yakuman, ctx, 0, 0, [], 'tanki')
}

// ---------------------------------------------------------------------------
// 役の判定ヘルパー

/** 立直・一発・ツモ・海底などの状況役 */
function pushCommonYaku(ids: YakuId[], ctx: Context): void {
  const { input, menzen } = ctx
  if (input.riichi === 'riichi') ids.push('riichi')
  if (input.riichi === 'double') ids.push('doubleRiichi')
  if (input.isIppatsu) ids.push('ippatsu')
  if (menzen && input.isTsumo) ids.push('menzenTsumo')
  if (input.isHaitei) ids.push('haitei')
  if (input.isHoutei) ids.push('houtei')
  if (input.isRinshan) ids.push('rinshan')
  if (input.isChankan) ids.push('chankan')
}

function pushSituationalYakuman(ids: YakuId[], ctx: Context): void {
  if (ctx.input.isTenhou) ids.push('tenhou')
  if (ctx.input.isChiihou) ids.push('chiihou')
}

/** 字一色・緑一色・清老頭（牌の種類だけで決まる役満） */
function pushTileSetYakuman(ids: YakuId[], ctx: Context): void {
  const kinds = presentKinds(ctx)
  if (kinds.every(isHonor)) ids.push('tsuuiisou')
  if (kinds.every((k) => GREEN.has(k))) ids.push('ryuuiisou')
  if (kinds.every(isTerminal)) ids.push('chinroutou')
}

function pushFlushYaku(ids: YakuId[], ctx: Context): void {
  const kinds = presentKinds(ctx)
  const suits = new Set(kinds.filter((k) => k < 27).map((k) => Math.floor(k / 9)))
  if (suits.size !== 1) return
  ids.push(kinds.some(isHonor) ? 'honitsu' : 'chinitsu')
}

function isTanyao(ctx: Context): boolean {
  if (!ctx.menzen && !ctx.rules.kuitan) return false
  return presentKinds(ctx).every((k) => !isTerminalOrHonor(k))
}

function isHonroutou(ctx: Context): boolean {
  const kinds = presentKinds(ctx)
  return kinds.every(isTerminalOrHonor) && kinds.some(isHonor) && kinds.some(isTerminal)
}

function isChuurenShape(counts: readonly number[]): boolean {
  const suits = [0, 9, 18].filter((s) => counts.slice(s, s + 9).some((n) => n > 0))
  if (suits.length !== 1 || counts.slice(27).some((n) => n > 0)) return false
  const base = [3, 1, 1, 1, 1, 1, 1, 1, 3]
  return base.every((need, r) => counts[suits[0] + r] >= need)
}

function presentKinds(ctx: Context): TileKind[] {
  const out: TileKind[] = []
  ctx.allCounts.forEach((n, k) => {
    if (n > 0) out.push(k)
  })
  return out
}

// ---------------------------------------------------------------------------
// 候補の組み立て

function yakumanCandidate(
  ids: YakuId[],
  ctx: Context,
  fu: number,
  rawFu: number,
  fuDetails: FuDetail[],
  wait: WaitType,
): Candidate {
  let multiplier = 0
  const yaku = ids.map((id) => {
    const def = YAKU[id] as { name: string; yakuman: number }
    const mult = ctx.rules.doubleYakuman ? def.yakuman : 1
    multiplier += mult
    return { id, name: def.name, han: 13 * mult }
  })
  return { yaku, han: 13 * multiplier, fu, rawFu, fuDetails, yakumanMultiplier: multiplier, wait }
}

function normalCandidate(
  ids: YakuId[],
  ctx: Context,
  fu: number,
  rawFu: number,
  fuDetails: FuDetail[],
  wait: WaitType,
): Candidate {
  const yaku: YakuResult[] = ids.map((id) => {
    const def = YAKU[id]
    return { id, name: def.name, han: ctx.menzen ? def.closed : def.open }
  })
  let han = yaku.reduce((n, y) => n + y.han, 0)
  // 役がなければドラは数えない（呼び出し側で役なし扱い）
  if (han > 0) {
    const bonus: [YakuId, number][] = [
      ['dora', ctx.dora],
      ['akaDora', ctx.aka],
      ['uraDora', ctx.ura],
    ]
    for (const [id, n] of bonus) {
      if (n > 0) {
        yaku.push({ id, name: YAKU[id].name, han: n })
        han += n
      }
    }
  }
  return { yaku, han, fu, rawFu, fuDetails, yakumanMultiplier: 0, wait }
}

// ---------------------------------------------------------------------------
// 符計算

function calculateFu(
  blocks: Block[],
  pair: TileKind,
  wait: WaitType,
  ctx: Context,
): { fu: number; rawFu: number; details: FuDetail[]; extra: number } {
  const { input, menzen } = ctx
  const details: FuDetail[] = []
  let extra = 0
  const add = (reason: string, fu: number) => {
    details.push({ reason, fu })
    extra += fu
  }

  if (wait === 'kanchan') add('嵌張待ち', 2)
  if (wait === 'penchan') add('辺張待ち', 2)

  let valued = DRAGONS.includes(pair) ? 1 : 0
  if (pair === input.seatWind) valued++
  if (pair === input.roundWind) valued++
  if (valued === 1) add('役牌の雀頭', 2)
  else if (valued >= 2) add('連風牌の雀頭', 4)

  if (wait === 'tanki') add('単騎待ち', 2)

  for (const b of blocks) {
    if (b.type === 'shuntsu') continue
    const yaochu = isTerminalOrHonor(b.kind)
    let fu = b.type === 'kantsu' ? 8 : 2
    if (yaochu) fu *= 2
    if (!b.open) fu *= 2
    const label = `${b.open ? '明' : '暗'}${b.type === 'kantsu' ? '槓' : '刻'}${yaochu ? '（么九）' : ''}`
    add(label, fu)
  }

  if (input.isTsumo && extra > 0) add('ツモ', 2)
  // 喰い平和形（副露して符がない）は 30符にする
  if (!menzen && extra === 0) add('副露・符なし', 2)

  const base = !menzen || input.isTsumo ? 20 : 30
  details.unshift({ reason: base === 30 ? '副底（門前ロン）' : '副底', fu: base })
  const rawFu = base + extra
  // extra === 0（門前で副底以外の符がない）なら平和形。ツモ符は付加符がある時だけ付くので判定に影響しない。
  return { fu: Math.ceil(rawFu / 10) * 10, rawFu, details, extra }
}

// ---------------------------------------------------------------------------
// 点数

function computePayment(c: Candidate, ctx: Context): { payment: Payment; level: LimitLevel } {
  const { rules, isDealer, input } = ctx
  let base: number
  let level: LimitLevel = ''
  if (c.yakumanMultiplier > 0) {
    base = 8000 * Math.min(c.yakumanMultiplier, 6)
    level = 'yakuman'
  } else if (c.han >= 13 && rules.kazoeYakuman) {
    base = 8000
    level = 'kazoeYakuman'
  } else if (c.han >= 11) {
    base = 6000
    level = 'sanbaiman'
  } else if (c.han >= 8) {
    base = 4000
    level = 'baiman'
  } else if (c.han >= 6) {
    base = 3000
    level = 'haneman'
  } else if (c.han >= 5) {
    base = 2000
    level = 'mangan'
  } else {
    base = c.fu * 2 ** (c.han + 2)
    const kiriage = rules.kiriageMangan && ((c.han === 4 && c.fu === 30) || (c.han === 3 && c.fu === 60))
    if (base > 2000 || kiriage) {
      base = 2000
      level = 'mangan'
    }
  }

  const up = (x: number) => Math.ceil(x / 100) * 100
  const honba = input.honba ?? 0
  let main: number
  let additional: number
  let mainBonus: number
  let additionalBonus: number
  if (input.isTsumo) {
    main = up(base * 2)
    additional = isDealer ? main : up(base)
    mainBonus = 100 * honba
    additionalBonus = 100 * honba
  } else {
    main = up(base * (isDealer ? 6 : 4))
    additional = 0
    mainBonus = 300 * honba
    additionalBonus = 0
  }
  const kyoutakuBonus = 1000 * (input.kyoutaku ?? 0)
  const total = main + mainBonus + 2 * (additional + additionalBonus) + kyoutakuBonus
  return { payment: { main, additional, mainBonus, additionalBonus, kyoutakuBonus, total }, level }
}

/** 高い方を正とする比較: 点数 → 役満優先 → 翻 → 符 → 切り上げ前の符 */
function compare(a: Candidate, pa: Payment, b: Candidate, pb: Payment): number {
  return (
    pa.total - pb.total ||
    Number(a.yakumanMultiplier > 0) - Number(b.yakumanMultiplier > 0) ||
    a.han - b.han ||
    a.fu - b.fu ||
    a.rawFu - b.rawFu
  )
}

function countDora(tiles: PhysicalTile[], indicators: TileKind[]): number {
  let n = 0
  for (const ind of indicators) {
    const dora = doraFromIndicator(ind)
    for (const t of tiles) if (t.kind === dora) n++
  }
  return n
}
