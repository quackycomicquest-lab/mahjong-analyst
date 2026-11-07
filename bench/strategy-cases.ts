/**
 * 定石・統計との照合に使う局面（docs/strategy-check.md）
 *
 * 局面はすべて自作。期待する判断は、麻雀の統計研究・戦術書で広く知られている結論を自分の言葉でまとめたもの。
 * 「必ずこれが最善」と言えるものは best、評価が割れうるものは「大きな減点にしない（minScore）」で確かめる。
 */
import type { Action, CalledMeld, Seat } from '../src/engine/game/types'
import type { PlayerView } from '../src/engine/game/view'
import { parseHand, type PhysicalTile } from '../src/engine/rules/tile'
import { makeView, type ViewSpec } from '../src/engine/testing/makeView'

export interface StrategyCase {
  id: string
  category: '立直判断' | '押し引き' | '安全牌' | '鳴き' | '牌効率'
  /** 何を確かめるか（根拠となる定石・統計の要約） */
  claim: string
  view: () => PlayerView
  /** 評価する行動（この行動を選んだとして評価し、最善手・評価点を見る） */
  action: (v: PlayerView) => Action
  /** 最善手として許すラベル（どれか。末尾の * は前方一致） */
  best?: string[]
  /** 最善手の条件（ラベル以外） */
  bestCheck?: { shanten?: number; immediateDealIn?: number }
  /** 評価する行動の評価点の下限・上限 */
  minScore?: number
  maxScore?: number
}

/** 打牌の行動（牌の記法で指定、立直つきも） */
export const discardOf = (notation: string, riichi = false) => (v: PlayerView): Action => {
  const { kind, red } = parseHand(notation)[0]
  const pick = (exactRed: boolean) =>
    v.legalActions.find((a) => {
      if (a.type !== 'discard' || !!a.riichi !== riichi) return false
      const t = v.hand.find((h) => h.id === a.tileId)!
      return t.kind === kind && (!exactRed || t.red === red)
    })
  const a = pick(true) ?? pick(false)
  if (!a) throw new Error(`${notation}${riichi ? '（立直）' : ''} を切る行動がありません`)
  return a
}

const kindOf = (n: string) => parseHand(n)[0].kind
/** 東場・親は席 dealer の局にする（既定は席1が親＝自分は北家） */
const withRound = (v: PlayerView, dealer: Seat, wind = 27): PlayerView => {
  v.round = { ...v.round, wind, dealer }
  return v
}
const build = (spec: ViewSpec, dealer: Seat = 1) => () => withRound(makeView(spec), dealer)

/** 立直者（席2）の河：東・9萬・2筒を切って 5索で立直。現物は 東・9萬・2筒・5索 */
const RIICHI_EARLY = { 2: ['1z', '9m', '2p', '5s*'] }
/** 現物を多めに：東・9萬・2筒・5索・中・西 */
const RIICHI_MID = { 2: ['1z', '9m', '2p', '5s*', '7z', '3z'] }

export const STRATEGY_CASES: StrategyCase[] = [
  // ---------------------------------------------------------------- 立直判断
  {
    id: 'R1',
    category: '立直判断',
    claim: '先制・役なしの嵌張聴牌は立直する（ダマではロン和了できない。愚形でも先制立直の収支はダマを大きく上回る）',
    view: build({ hand: '234m567p789s13s55m9p', riichiAllowed: true, wallRemaining: 45 }),
    action: discardOf('9p', true),
    best: ['9筒（立直）'],
  },
  {
    id: 'R2',
    category: '立直判断',
    claim: '先制・断幺九平和の両面聴牌（安手）は立直する（ダマの安手より立直の打点上昇と和了率の両立が得）',
    view: build({ hand: '234m567p234s67s55m9p', riichiAllowed: true, wallRemaining: 45 }),
    action: discardOf('9p', true),
    best: ['9筒（立直）'],
  },
  {
    id: 'R3',
    category: '立直判断',
    claim: '他家の先制立直に、現物を切って両面で聴牌したら追いかけ立直する（良形の追いかけ立直は押しが得）',
    view: build({ hand: '234m567p789s23s55m9m', riichiAllowed: true, wallRemaining: 40, rivers: RIICHI_EARLY }),
    action: discardOf('9m', true),
    best: ['9萬（立直）'],
  },

  // ---------------------------------------------------------------- 押し引き
  {
    id: 'P1',
    category: '押し引き',
    claim: '先制立直に対して、両面聴牌なら無スジでも押す（良形聴牌の押しは降りより収支が高い）',
    view: build({ hand: '23499m678p34556s4m', riichiAllowed: true, wallRemaining: 40, rivers: RIICHI_EARLY }),
    action: discardOf('4m'),
    bestCheck: { shanten: 0 },
  },
  {
    id: 'P2',
    category: '押し引き',
    claim: '先制立直に対して、打点のない1向聴は、向聴数を保つ牌が無スジなら現物を切って降りる',
    view: build({ hand: '235m46p7p456s789s99m', wallRemaining: 30, rivers: RIICHI_MID }),
    action: discardOf('9m'),
    bestCheck: { immediateDealIn: 0 },
  },
  {
    id: 'P3',
    category: '押し引き',
    claim: '先制立直に対して、2向聴以上の手は現物で降りる',
    view: build({ hand: '45m79m24p68p159s136z', wallRemaining: 45, rivers: { 2: ['2z', '5m*'] }, dora: '9p' }),
    action: discardOf('5m'),
    bestCheck: { immediateDealIn: 0 },
  },
  {
    id: 'P4',
    category: '押し引き',
    claim: '先制立直に対して、満貫以上が見える1向聴（序盤）は、無スジを押して1向聴を保つ（打点があれば押しが降りに勝る）',
    // ドラ9萬（表示8萬）の対子と赤5萬：立直・ツモ・ドラ3で満貫以上。4筒を切ると 67筒の両面が残る
    view: build({ hand: '230m46p7p456s789s99m', wallRemaining: 55, rivers: RIICHI_EARLY, dora: '8m' }),
    action: discardOf('4p'),
    bestCheck: { shanten: 1 },
    minScore: 70,
  },

  // ---------------------------------------------------------------- 安全牌
  {
    id: 'S1',
    category: '安全牌',
    claim: '降りるときは現物を切る。中張牌の無スジ（5）は最も危険で、大きく減点する',
    view: build({ hand: '15699m37p28s2467z1p', wallRemaining: 50, rivers: { 2: ['1z', '9m', '4p', '5s*'] } }),
    action: discardOf('5m'),
    bestCheck: { immediateDealIn: 0 },
    maxScore: 60,
  },

  // ---------------------------------------------------------------- 鳴き
  {
    id: 'C1',
    category: '鳴き',
    claim: '序盤の役牌（白）の対子は、1枚目からポンする（役が確定し、和了率が大きく上がる）',
    view: build({
      hand: '55z234m57p13s689s9m',
      wallRemaining: 60,
      response: {
        from: 3,
        tile: '5z',
        actions: (_t, hand) => {
          const ids = hand.filter((h) => h.kind === kindOf('5z')).map((h) => h.id)
          return [{ type: 'pon', seat: 0, tileIds: [ids[0], ids[1]] }]
        },
      },
    }),
    action: (v) => ({ type: 'pass', seat: v.seat }),
    best: ['ポン（白白＋白）*'],
  },
  {
    id: 'C2',
    category: '鳴き',
    claim: '終盤、役（白のポン）がある1向聴なら、チーで聴牌に取る（流局の聴牌料と和了の両方が得られる）',
    view: () => {
      const v = build({
        hand: '23m57p456s99m1z',
        wallRemaining: 8,
        response: {
          from: 3,
          tile: '1m',
          actions: (_t, hand) => {
            const a = hand.find((h) => h.kind === kindOf('2m'))!
            const b = hand.find((h) => h.kind === kindOf('3m'))!
            return [{ type: 'chi', seat: 0, tileIds: [a.id, b.id] }]
          },
        },
      })()
      const white: PhysicalTile[] = [900, 901, 902].map((id) => ({ id, kind: kindOf('5z'), red: false }))
      const meld: CalledMeld = { type: 'pon', tiles: white, from: 2, calledTile: white[2] }
      v.players[0] = { ...v.players[0], melds: [meld] }
      return v
    },
    action: (v) => ({ type: 'pass', seat: v.seat }),
    best: ['チー（2萬3萬＋1萬）*'],
  },

  // ---------------------------------------------------------------- 牌効率
  {
    id: 'E1',
    category: '牌効率',
    claim: '序盤、孤立したドラは孤立した端牌より残す（ドラは打点に直結し、受け入れの差は小さい）',
    view: build({ hand: '9m1p234m56p789s23s34z', wallRemaining: 66, dora: '8m' }),
    action: discardOf('9m'),
    maxScore: 90,
  },
]
