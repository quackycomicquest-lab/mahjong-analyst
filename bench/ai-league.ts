/**
 * AIリーグ戦：打ち筋の違いと強さを数字で確認する（npm run league）
 *
 * 4人の席を半荘ごとに入れ替えながら対局し、和了率・放銃率・副露率・立直率・平均順位を集計する。
 *   npm run league -- 40        … 40半荘（既定 24）
 */
import { createAiBot } from '../src/engine/ai/player'
import { makeProfile, type AiProfile } from '../src/engine/ai/profile'
import { MahjongGame } from '../src/engine/game/game'
import { efficiencyBot, type Bot } from '../src/engine/game/simpleBots'
import { playToEnd } from '../src/engine/game/testUtils'
import type { Seat } from '../src/engine/game/types'
import { createRng } from '../src/engine/game/wall'

interface Entry {
  name: string
  make: (rand: () => number) => Bot
}

const ai = (p: AiProfile, label?: string): Entry => ({
  name: label ?? `${p.name}(強さ${p.strength})`,
  make: (r) => createAiBot(p, r),
})
const baseline: Entry = { name: '牌効率のみ(比較用)', make: () => efficiencyBot }

function league(title: string, entries: Entry[], games: number) {
  const stat = entries.map(() => ({ rounds: 0, wins: 0, dealIns: 0, dealInsRiichi: 0, called: 0, riichi: 0, winPoints: 0, rankSum: 0, pointSum: 0 }))
  const t0 = performance.now()
  for (let g = 0; g < games; g++) {
    const rand = createRng(1000 + g)
    // 席の入れ替え：g ごとにずらす
    const seatOf = entries.map((_, i) => ((i + g) % 4) as Seat)
    const bots = {} as Record<Seat, Bot>
    entries.forEach((e, i) => (bots[seatOf[i]] = e.make(rand)))
    const game = new MahjongGame({ seed: 5000 + g })
    playToEnd(game, bots)

    let calledThisRound = new Set<Seat>()
    let riichiThisRound = new Set<Seat>()
    for (const e of game.state.log) {
      if (e.type === 'roundStart') {
        calledThisRound = new Set()
        riichiThisRound = new Set()
      }
      if (e.type === 'call' || (e.type === 'kan' && e.meld.type === 'minkan')) calledThisRound.add(e.seat)
      if (e.type === 'riichiAccepted') riichiThisRound.add(e.seat)
      if (e.type === 'roundEnd') {
        entries.forEach((_, i) => {
          const s = seatOf[i]
          const st = stat[i]
          st.rounds++
          if (calledThisRound.has(s)) st.called++
          if (riichiThisRound.has(s)) st.riichi++
          if (e.result.type === 'agari') {
            for (const w of e.result.wins) {
              if (w.seat === s) {
                st.wins++
                st.winPoints += w.value.payment.total
              }
              if (w.from === s) {
                st.dealIns++
                if (w.value.yaku.some((y) => y.id === 'riichi' || y.id === 'doubleRiichi')) st.dealInsRiichi++
              }
            }
          }
        })
      }
      if (e.type === 'gameEnd') {
        entries.forEach((_, i) => {
          stat[i].rankSum += e.result.ranks[seatOf[i]] + 1
          stat[i].pointSum += e.result.finalPoints[seatOf[i]]
        })
      }
    }
  }
  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`.padStart(6)
  console.log(`\n■ ${title}（${games}半荘、${((performance.now() - t0) / games / 1000).toFixed(1)}秒/半荘）`)
  console.log('名前                    和了率  放銃率 (対立直)  副露率  立直率  平均打点  平均順位  平均持ち点')
  entries.forEach((e, i) => {
    const s = stat[i]
    console.log(
      `${e.name.padEnd(16, '　')}  ${pct(s.wins, s.rounds)}  ${pct(s.dealIns, s.rounds)} (${pct(s.dealInsRiichi, s.rounds)})  ${pct(s.called, s.rounds)}  ${pct(s.riichi, s.rounds)}  ${String(Math.round(s.winPoints / Math.max(1, s.wins))).padStart(7)}  ${(s.rankSum / games).toFixed(2).padStart(7)}  ${String(Math.round(s.pointSum / games)).padStart(9)}`,
    )
  })
}

const games = Number(process.argv[2] ?? 24)
league(
  '性格の比較（全員 強さ2）',
  [ai(makeProfile('speed', 2)), ai(makeProfile('defense', 2)), ai(makeProfile('value', 2)), baseline],
  games,
)
league(
  '強さの比較（全員 守備型）',
  [ai(makeProfile('defense', 1)), ai(makeProfile('defense', 2)), ai(makeProfile('defense', 3)), baseline],
  games,
)
