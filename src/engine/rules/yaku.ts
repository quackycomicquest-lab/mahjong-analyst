/**
 * 役の定義（翻数は門前／副露）
 * open = 0 は門前限定。役満は yakuman に倍数を持つ。
 */

export interface YakuDef {
  name: string
  closed: number
  open: number
  yakuman?: number
}

export const YAKU = {
  riichi: { name: '立直', closed: 1, open: 0 },
  doubleRiichi: { name: 'ダブル立直', closed: 2, open: 0 },
  ippatsu: { name: '一発', closed: 1, open: 0 },
  menzenTsumo: { name: '門前清自摸和', closed: 1, open: 0 },
  pinfu: { name: '平和', closed: 1, open: 0 },
  tanyao: { name: '断幺九', closed: 1, open: 1 },
  iipeikou: { name: '一盃口', closed: 1, open: 0 },
  haku: { name: '役牌 白', closed: 1, open: 1 },
  hatsu: { name: '役牌 發', closed: 1, open: 1 },
  chun: { name: '役牌 中', closed: 1, open: 1 },
  seatWind: { name: '自風牌', closed: 1, open: 1 },
  roundWind: { name: '場風牌', closed: 1, open: 1 },
  haitei: { name: '海底摸月', closed: 1, open: 1 },
  houtei: { name: '河底撈魚', closed: 1, open: 1 },
  rinshan: { name: '嶺上開花', closed: 1, open: 1 },
  chankan: { name: '槍槓', closed: 1, open: 1 },
  chiitoitsu: { name: '七対子', closed: 2, open: 0 },
  sanshoku: { name: '三色同順', closed: 2, open: 1 },
  ittsu: { name: '一気通貫', closed: 2, open: 1 },
  chanta: { name: '混全帯幺九', closed: 2, open: 1 },
  toitoi: { name: '対々和', closed: 2, open: 2 },
  sanankou: { name: '三暗刻', closed: 2, open: 2 },
  sanshokuDoukou: { name: '三色同刻', closed: 2, open: 2 },
  sankantsu: { name: '三槓子', closed: 2, open: 2 },
  shousangen: { name: '小三元', closed: 2, open: 2 },
  honroutou: { name: '混老頭', closed: 2, open: 2 },
  honitsu: { name: '混一色', closed: 3, open: 2 },
  junchan: { name: '純全帯幺九', closed: 3, open: 2 },
  ryanpeikou: { name: '二盃口', closed: 3, open: 0 },
  chinitsu: { name: '清一色', closed: 6, open: 5 },
  dora: { name: 'ドラ', closed: 0, open: 0 },
  akaDora: { name: '赤ドラ', closed: 0, open: 0 },
  uraDora: { name: '裏ドラ', closed: 0, open: 0 },
  // 役満
  kokushi: { name: '国士無双', closed: 13, open: 0, yakuman: 1 },
  kokushi13: { name: '国士無双十三面待ち', closed: 13, open: 0, yakuman: 2 },
  suuankou: { name: '四暗刻', closed: 13, open: 0, yakuman: 1 },
  suuankouTanki: { name: '四暗刻単騎', closed: 13, open: 0, yakuman: 2 },
  daisangen: { name: '大三元', closed: 13, open: 13, yakuman: 1 },
  shousuushii: { name: '小四喜', closed: 13, open: 13, yakuman: 1 },
  daisuushii: { name: '大四喜', closed: 13, open: 13, yakuman: 2 },
  tsuuiisou: { name: '字一色', closed: 13, open: 13, yakuman: 1 },
  ryuuiisou: { name: '緑一色', closed: 13, open: 13, yakuman: 1 },
  chinroutou: { name: '清老頭', closed: 13, open: 13, yakuman: 1 },
  chuuren: { name: '九蓮宝燈', closed: 13, open: 0, yakuman: 1 },
  junseiChuuren: { name: '純正九蓮宝燈', closed: 13, open: 0, yakuman: 2 },
  suukantsu: { name: '四槓子', closed: 13, open: 13, yakuman: 1 },
  tenhou: { name: '天和', closed: 13, open: 0, yakuman: 1 },
  chiihou: { name: '地和', closed: 13, open: 0, yakuman: 1 },
} as const satisfies Record<string, YakuDef>

export type YakuId = keyof typeof YAKU
