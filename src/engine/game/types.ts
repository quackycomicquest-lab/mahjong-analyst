/**
 * 対局進行エンジンの型（仕様 §2 対局システム）
 *
 * 状態はすべてプレーンなデータ（JSON化可能）。同じ seed と同じ行動列からは
 * 必ず同じ対局が再現されるので、履歴は「seed + 行動列」で保存できる。
 */

import type { HandValue } from '../rules/score'
import type { PhysicalTile, RedFiveConfig, TileKind } from '../rules/tile'
import type { Meld, RuleConfig } from '../rules/types'

export type Seat = 0 | 1 | 2 | 3
export const SEATS: readonly Seat[] = [0, 1, 2, 3]

// ---------------------------------------------------------------------------
// 設定

export interface GameConfig {
  /** 東風戦 / 東南戦 */
  length: 'tonpuu' | 'hanchan'
  startingPoints: number
  /** 返し点。オーラス終了時に誰も届いていなければ延長戦（東風→南入、東南→西入） */
  returnPoints: number
  /** 点数計算ルール */
  scoring: RuleConfig
  redFives: RedFiveConfig
  /** 0点未満で終了（飛び） */
  tobi: boolean
  /** オーラスで親がトップかつ返し点以上なら和了・聴牌で終了 */
  agariYame: boolean
  /** ダブロン（2人同時ロン）を認める。false なら頭ハネ */
  doubleRon: boolean
  /** 3人同時ロンは流局（三家和） */
  sanchahouDraw: boolean
}

export const DEFAULT_GAME_CONFIG: Omit<GameConfig, 'scoring' | 'redFives'> = {
  length: 'hanchan',
  startingPoints: 25000,
  returnPoints: 30000,
  tobi: true,
  agariYame: true,
  doubleRon: true,
  sanchahouDraw: true,
}

// ---------------------------------------------------------------------------
// プレイヤー状態

export interface RiverTile {
  tile: PhysicalTile
  /** ツモ切り */
  tsumogiri: boolean
  /** 立直宣言牌 */
  riichi: boolean
  /** 他家に鳴かれた（河から消えた）。フリテン判定には残る */
  calledBy: Seat | null
  /** 局内の全員通しの打牌順（0 から）。立直後に通った牌の判定などに使う */
  seq: number
}

export interface CalledMeld extends Meld {
  /** 鳴いた相手（暗槓は null） */
  from: Seat | null
  /** 鳴いた牌（暗槓は null） */
  calledTile: PhysicalTile | null
}

export interface RiichiState {
  double: boolean
  /** 一発の権利が残っているか */
  ippatsu: boolean
  /** 宣言牌の河 index */
  riverIndex: number
}

export interface PlayerState {
  hand: PhysicalTile[]
  melds: CalledMeld[]
  river: RiverTile[]
  points: number
  riichi: RiichiState | null
  /** 同巡内フリテン（自分の次の打牌で解除） */
  temporaryFuriten: boolean
  /** 立直後に和了牌を見逃した（その局ずっとフリテン） */
  riichiFuriten: boolean
  /** この局で打牌した回数 */
  discardCount: number
}

// ---------------------------------------------------------------------------
// 局面のフェーズ

export type CallKind = 'none' | 'chi' | 'pon'

export interface TurnPhase {
  type: 'turn'
  seat: Seat
  /** ツモってきた牌（鳴いた直後は null） */
  drawn: PhysicalTile | null
  /** 直前の行動が鳴きなら打牌のみ可 */
  afterCall: CallKind
  /** 嶺上牌をツモった直後 */
  rinshan: boolean
  /** 喰い替えで切れない牌の種類 */
  kuikaeForbidden: TileKind[]
}

export type ResponseKind = 'discard' | 'chankan' | 'ankanChankan'

export interface ResponsePhase {
  type: 'response'
  kind: ResponseKind
  /** 打牌・加槓・暗槓をした人 */
  actor: Seat
  tile: PhysicalTile
  /** 応答できる人と、その人の選択肢 */
  options: Partial<Record<Seat, ResponseAction[]>>
  /** 決定済みの応答 */
  decisions: Partial<Record<Seat, ResponseAction>>
}

export interface RoundEndPhase {
  type: 'roundEnd'
  result: RoundResult
  /** 次の局（対局終了なら null） */
  next: RoundInfo | null
}

export interface GameEndPhase {
  type: 'gameEnd'
  result: GameResult
}

export type Phase = TurnPhase | ResponsePhase | RoundEndPhase | GameEndPhase

// ---------------------------------------------------------------------------
// 行動

export type TurnAction =
  | { type: 'discard'; seat: Seat; tileId: number; riichi?: boolean }
  | { type: 'tsumo'; seat: Seat }
  | { type: 'ankan'; seat: Seat; kind: TileKind }
  | { type: 'kakan'; seat: Seat; tileId: number }
  | { type: 'kyuushu'; seat: Seat }

export type ResponseAction =
  | { type: 'ron'; seat: Seat }
  | { type: 'pon'; seat: Seat; tileIds: [number, number] }
  | { type: 'chi'; seat: Seat; tileIds: [number, number] }
  | { type: 'daiminkan'; seat: Seat }
  | { type: 'pass'; seat: Seat }

export type Action = TurnAction | ResponseAction | { type: 'nextRound' }

// ---------------------------------------------------------------------------
// 結果

export interface WinRecord {
  seat: Seat
  /** 放銃者（ツモなら null） */
  from: Seat | null
  value: HandValue
  hand: PhysicalTile[]
  winTile: PhysicalTile
  melds: CalledMeld[]
}

export type DrawReason =
  | 'exhaustive' // 荒牌流局
  | 'kyuushu' // 九種九牌
  | 'suufon' // 四風連打
  | 'suucha' // 四家立直
  | 'suukan' // 四開槓
  | 'sanchahou' // 三家和

export type RoundResult =
  | {
      type: 'agari'
      wins: WinRecord[]
      deltas: [number, number, number, number]
      uraDoraIndicators: TileKind[]
    }
  | {
      type: 'draw'
      reason: DrawReason
      tenpai: [boolean, boolean, boolean, boolean]
      /** 流し満貫を達成した人 */
      nagashi: Seat[]
      deltas: [number, number, number, number]
    }

export interface GameResult {
  finalPoints: [number, number, number, number]
  /** 順位（0 = 1位）。同点は起家に近い方が上 */
  ranks: [number, number, number, number]
}

// ---------------------------------------------------------------------------
// 局と対局の状態

export interface RoundInfo {
  /** 場風（27=東 28=南 29=西 30=北） */
  wind: TileKind
  dealer: Seat
  honba: number
  /** 供託（立直棒）の本数 */
  kyoutaku: number
}

export interface RoundState extends RoundInfo {
  /** 山（先頭からツモる） */
  wall: PhysicalTile[]
  /** 王牌14枚: [0..3] 嶺上牌, [4..8] ドラ表示牌, [9..13] 裏ドラ表示牌 */
  deadWall: PhysicalTile[]
  /** めくれているドラ表示牌の枚数 */
  doraRevealed: number
  /** 打牌後にめくる槓ドラ（明槓・加槓） */
  pendingKanDora: number
  /** 嶺上牌を取った枚数 */
  rinshanUsed: number
  players: [PlayerState, PlayerState, PlayerState, PlayerState]
  /** この局でまだ誰も鳴いていない（暗槓含む） */
  noCallsYet: boolean
  /** 槓をした人の記録（四開槓判定用） */
  kanBy: Seat[]
  /** 四開槓の判定待ち（4つ目の槓の後の打牌が通ったら流局） */
  suukanPending: boolean
  /** 次の打牌に付ける通し番号 */
  discardSeq: number
  /** 立直宣言牌が通るのを待っている人（ロンされたら立直不成立） */
  pendingRiichi: { seat: Seat; double: boolean } | null
  phase: Phase
}

export interface GameState {
  config: GameConfig
  seed: number
  round: RoundState
  /** 局番号（東1局0本場 = 0 から、局が変わるたびに +1） */
  roundIndex: number
  /** 行動ごとに +1。評価結果と局面を結び付ける ID（仕様 §5-3） */
  decisionId: number
  /** すべての行動（seed とあわせて再現に使う） */
  actions: Action[]
  /** 局ごとのイベント記録 */
  log: GameEvent[]
}

// ---------------------------------------------------------------------------
// イベント（履歴保存・表示用）

export type GameEvent =
  | { type: 'roundStart'; roundIndex: number; info: RoundInfo; points: number[]; doraIndicator: TileKind }
  | { type: 'draw'; seat: Seat; tile: PhysicalTile; rinshan: boolean }
  | { type: 'discard'; seat: Seat; tile: PhysicalTile; tsumogiri: boolean; riichi: boolean }
  | { type: 'riichiAccepted'; seat: Seat }
  | { type: 'call'; seat: Seat; meld: CalledMeld }
  | { type: 'kan'; seat: Seat; meld: CalledMeld }
  | { type: 'doraReveal'; indicator: TileKind }
  | { type: 'roundEnd'; result: RoundResult }
  | { type: 'gameEnd'; result: GameResult }
