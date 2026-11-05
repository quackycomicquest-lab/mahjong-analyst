/**
 * 牌モデル（仕様 §6-3）
 *
 * - TileKind  : 牌の「種類」。0〜33 の整数。
 *     0-8   = 1萬〜9萬
 *     9-17  = 1筒〜9筒
 *     18-26 = 1索〜9索
 *     27-33 = 東 南 西 北 白 發 中
 * - PhysicalTile : 136枚それぞれの「個体」。id は 0〜135 で一意。
 *     同じ5萬でも個体ごとに id が異なり、赤ドラかどうかも個体が持つ。
 *
 * 計算（シャンテン数など）は種類ベースの34要素カウント配列で行い、
 * 打牌・履歴・表示は個体IDで扱う。
 */

export type TileKind = number

export interface PhysicalTile {
  /** 0〜135 の個体ID。卓上で一意。 */
  readonly id: number
  readonly kind: TileKind
  /** 赤ドラ（赤5）かどうか */
  readonly red: boolean
}

export type Suit = 'm' | 'p' | 's' | 'z'

export const KIND_COUNT = 34
export const COPIES_PER_KIND = 4

export const isHonor = (k: TileKind): boolean => k >= 27
export const isNumber = (k: TileKind): boolean => k < 27
export const isTerminal = (k: TileKind): boolean => k < 27 && (k % 9 === 0 || k % 9 === 8)
export const isTerminalOrHonor = (k: TileKind): boolean => isHonor(k) || isTerminal(k)

/** 么九牌13種（国士無双判定用） */
export const YAOCHU_KINDS: readonly TileKind[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]

export function suitOf(k: TileKind): Suit {
  if (k < 9) return 'm'
  if (k < 18) return 'p'
  if (k < 27) return 's'
  return 'z'
}

/** 数牌なら1〜9、字牌なら1〜7 */
export function rankOf(k: TileKind): number {
  return k < 27 ? (k % 9) + 1 : k - 27 + 1
}

export function kindOf(suit: Suit, rank: number): TileKind {
  const base = { m: 0, p: 9, s: 18, z: 27 }[suit]
  const max = suit === 'z' ? 7 : 9
  if (!Number.isInteger(rank) || rank < 1 || rank > max) {
    throw new Error(`不正な牌: ${rank}${suit}`)
  }
  return base + rank - 1
}

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中']
const SUIT_NAMES: Record<Exclude<Suit, 'z'>, string> = { m: '萬', p: '筒', s: '索' }

/** 表示用の日本語名（例: "5萬", "東"） */
export function kindName(k: TileKind): string {
  const s = suitOf(k)
  return s === 'z' ? HONOR_NAMES[k - 27] : `${rankOf(k)}${SUIT_NAMES[s]}`
}

export function tileName(t: PhysicalTile): string {
  return t.red ? `赤${kindName(t.kind)}` : kindName(t.kind)
}

/** 赤ドラの設定。各色の5のうち何枚を赤にするか（標準は各1枚）。 */
export interface RedFiveConfig {
  m: number
  p: number
  s: number
}

export const STANDARD_RED_FIVES: RedFiveConfig = { m: 1, p: 1, s: 1 }

/**
 * 136枚の牌セットを生成する（並びは id 順。シャッフルは呼び出し側で行う）。
 * id = kind * 4 + copy。赤は各5の copy 0 から順に割り当てる。
 */
export function createTileSet(red: RedFiveConfig = STANDARD_RED_FIVES): PhysicalTile[] {
  const tiles: PhysicalTile[] = []
  for (let kind = 0; kind < KIND_COUNT; kind++) {
    for (let copy = 0; copy < COPIES_PER_KIND; copy++) {
      const suit = suitOf(kind)
      const isRed = suit !== 'z' && rankOf(kind) === 5 && copy < red[suit]
      tiles.push({ id: kind * COPIES_PER_KIND + copy, kind, red: isRed })
    }
  }
  return tiles
}

/** 種類ごとの枚数（長さ34の配列） */
export function toCounts(kinds: Iterable<TileKind>): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0)
  for (const k of kinds) c[k]++
  return c
}

export function countsOfTiles(tiles: Iterable<PhysicalTile>): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0)
  for (const t of tiles) c[t.kind]++
  return c
}

/**
 * 牌姿記法をパースする。例: "123m406p789s11z"
 * 数字の後ろのアルファベットが色を表す（m=萬, p=筒, s=索, z=字牌 1-7=東南西北白發中）。
 * "0" は赤5を表す（種類としては5）。
 */
export function parseHand(notation: string): { kind: TileKind; red: boolean }[] {
  const out: { kind: TileKind; red: boolean }[] = []
  let pending: string[] = []
  for (const ch of notation.replace(/\s+/g, '')) {
    if (/[0-9]/.test(ch)) {
      pending.push(ch)
    } else if (ch === 'm' || ch === 'p' || ch === 's' || ch === 'z') {
      if (pending.length === 0) throw new Error(`色 "${ch}" の前に数字がありません: ${notation}`)
      for (const d of pending) {
        const red = d === '0'
        if (red && ch === 'z') throw new Error(`字牌に赤はありません: ${notation}`)
        out.push({ kind: kindOf(ch, red ? 5 : Number(d)), red })
      }
      pending = []
    } else {
      throw new Error(`不正な文字 "${ch}": ${notation}`)
    }
  }
  if (pending.length > 0) throw new Error(`色の指定がない数字があります: ${notation}`)
  return out
}

/** 牌姿記法 → 34カウント配列 */
export function parseCounts(notation: string): number[] {
  return toCounts(parseHand(notation).map((t) => t.kind))
}

/** 34カウント配列 → 牌姿記法（赤の情報は持たない） */
export function countsToNotation(counts: readonly number[]): string {
  let out = ''
  const suits: Suit[] = ['m', 'p', 's', 'z']
  suits.forEach((suit, si) => {
    const size = suit === 'z' ? 7 : 9
    let digits = ''
    for (let r = 0; r < size; r++) digits += String(r + 1).repeat(counts[si * 9 + r])
    if (digits) out += digits + suit
  })
  return out
}
