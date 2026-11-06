/**
 * Python `mahjong`（MIT, 天鳳牌譜で検証済み）との点数計算照合。
 * データ再生成: npm run golden:score
 */
import { describe, expect, it } from 'vitest'
import golden from './__fixtures__/score-golden.json'
import { actualCellId, allCells, basePayment, paymentLabel, scoreTableFor } from '../coach/scoreQuiz'
import { calculateHandValue } from './score'
import { countsOfTiles, countsToNotation, createTileSet, type PhysicalTile } from './tile'
import type { MeldType, WinInput } from './types'
import type { YakuId } from './yaku'

interface GoldenCase {
  input: Omit<WinInput, 'hand' | 'winTile' | 'melds'> & {
    hand: number[]
    winTile: number
    melds: { type: MeldType; ids: number[] }[]
  }
  expected: {
    error: string | null
    han?: number
    fu?: number
    yaku?: string[]
    cost?: Record<string, number>
  }
}

const PY_YAKU: Record<string, YakuId> = {
  Riichi: 'riichi',
  'Double Riichi': 'doubleRiichi',
  Ippatsu: 'ippatsu',
  'Menzen Tsumo': 'menzenTsumo',
  Pinfu: 'pinfu',
  Tanyao: 'tanyao',
  Iipeiko: 'iipeikou',
  'Yakuhai (haku)': 'haku',
  'Yakuhai (hatsu)': 'hatsu',
  'Yakuhai (chun)': 'chun',
  'Haitei Raoyue': 'haitei',
  'Houtei Raoyui': 'houtei',
  'Rinshan Kaihou': 'rinshan',
  Chankan: 'chankan',
  Chiitoitsu: 'chiitoitsu',
  'Sanshoku Doujun': 'sanshoku',
  Ittsu: 'ittsu',
  Chantai: 'chanta',
  Toitoi: 'toitoi',
  'San Ankou': 'sanankou',
  'Sanshoku Doukou': 'sanshokuDoukou',
  'San Kantsu': 'sankantsu',
  'Shou Sangen': 'shousangen',
  Honroutou: 'honroutou',
  Honitsu: 'honitsu',
  Junchan: 'junchan',
  Ryanpeikou: 'ryanpeikou',
  Chinitsu: 'chinitsu',
  Dora: 'dora',
  'Aka Dora': 'akaDora',
  'Ura Dora': 'uraDora',
  'Kokushi Musou': 'kokushi',
  'Kokushi Musou Juusanmen Matchi': 'kokushi13',
  'Suu Ankou': 'suuankou',
  'Suu Ankou Tanki': 'suuankouTanki',
  Daisangen: 'daisangen',
  Shousuushii: 'shousuushii',
  'Dai Suushii': 'daisuushii',
  'Tsuu Iisou': 'tsuuiisou',
  Ryuuiisou: 'ryuuiisou',
  Chinroutou: 'chinroutou',
  'Chuuren Poutou': 'chuuren',
  'Daburu Chuuren Poutou': 'junseiChuuren',
  'Suu Kantsu': 'suukantsu',
  Tenhou: 'tenhou',
  Chiihou: 'chiihou',
}

function mapPyYaku(name: string): YakuId {
  if (name.startsWith('Yakuhai (seat wind')) return 'seatWind'
  if (name.startsWith('Yakuhai (round wind')) return 'roundWind'
  const id = PY_YAKU[name]
  if (!id) throw new Error(`未対応の役名: ${name}`)
  return id
}

const TILES = createTileSet()
const byId = (id: number): PhysicalTile => TILES[id]

function toInput(g: GoldenCase['input']): WinInput {
  return {
    ...g,
    hand: g.hand.map(byId),
    winTile: byId(g.winTile),
    melds: g.melds.map((m) => ({ type: m.type, tiles: m.ids.map(byId) })),
  }
}

const cases = (golden as unknown as { cases: GoldenCase[] }).cases

describe(`点数計算ゴールデン照合（${cases.length}件）`, () => {
  it('翻・符・役・支払いが Python mahjong と一致する', () => {
    const mismatches: string[] = []
    for (const g of cases) {
      const input = toInput(g.input)
      const r = calculateHandValue(input)
      const label =
        `${countsToNotation(countsOfTiles(input.hand))} 和了${g.input.winTile >> 2} ` +
        `副露[${g.input.melds.map((m) => `${m.type}:${countsToNotation(countsOfTiles(m.ids.map(byId)))}`).join(',')}] ` +
        `${g.input.isTsumo ? 'ツモ' : 'ロン'} 自風${g.input.seatWind} 場風${g.input.roundWind}`
      const e = g.expected
      if (e.error) {
        if (r.ok || r.reason !== e.error) {
          mismatches.push(`${label}: 期待 error=${e.error} 実際 ${r.ok ? `${r.han}翻` : r.reason}`)
        }
        continue
      }
      if (!r.ok) {
        mismatches.push(`${label}: 期待 ${e.han}翻${e.fu}符 実際 error=${r.reason} ${r.message}`)
        continue
      }
      const expYaku = e.yaku!.map(mapPyYaku).sort()
      const actYaku = r.yaku.map((y) => y.id).sort()
      const costOk = Object.entries(e.cost!).every(
        ([k, v]) => r.payment[k as keyof typeof r.payment] === v,
      )
      // 点数計算テストの点数表に使う計算（翻・符からの支払い）も一致すること
      const bp = basePayment(r.han, r.fu, r.isDealer, g.input.isTsumo, r.yakumanMultiplier)
      if (bp.main !== r.payment.main || bp.additional !== r.payment.additional) {
        mismatches.push(`${label}: 翻・符からの支払い ${JSON.stringify(bp)} / 実際 ${r.payment.main}/${r.payment.additional}`)
      }
      // 点数計算テストの点数表で、実際の和了のマスが正解の点数になっていること
      const cell = allCells(scoreTableFor(r, g.input.isTsumo)).find((c) => c.id === actualCellId(r))
      const ans = paymentLabel(r.payment.main, r.payment.additional, r.isDealer, g.input.isTsumo)
      if (!cell || !cell.valid || cell.label !== ans) {
        mismatches.push(`${label}: 点数表のマス ${actualCellId(r)} ${cell?.label}${cell?.valid ? '' : '（選べない）'} / 正解 ${ans}`)
      }
      // 役満は符が点数に影響しないので比較しない
      const fuOk = r.yakumanMultiplier > 0 || r.fu === e.fu
      if (r.han !== e.han || !fuOk || !costOk || expYaku.join() !== actYaku.join()) {
        mismatches.push(
          `${label}: 期待 ${e.han}翻${e.fu}符 [${expYaku}] ${JSON.stringify(e.cost)} / ` +
            `実際 ${r.han}翻${r.fu}符 [${actYaku}] ${JSON.stringify(r.payment)}`,
        )
      }
    }
    expect(mismatches.slice(0, 15)).toEqual([])
    expect(mismatches.length).toBe(0)
  })
})
