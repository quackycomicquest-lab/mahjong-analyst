/** 打牌評価の処理時間（npm run eval-timing）：実際の対局局面で full / light を計測する */
import { evaluateDecision } from '../src/engine/evaluator/evaluate'
import { MahjongGame } from '../src/engine/game/game'
import { efficiencyBot } from '../src/engine/game/simpleBots'
import { getPlayerView } from '../src/engine/game/view'
const t = { full: [] as number[], light: [] as number[] }
const scores: number[] = []
for (const seed of [11, 12, 13]) {
  const game = new MahjongGame({ seed })
  let n = 0
  while (game.phase.type !== 'gameEnd' && n < 40) {
    if (game.phase.type === 'roundEnd') { game.apply({ type: 'nextRound' }); continue }
    const seat = game.pendingSeats()[0]
    const view = getPlayerView(game, seat)
    const a = efficiencyBot(view)
    if (seat === 0 && a.type === 'discard') {
      const f = evaluateDecision(view, a, { mode: 'full' }); t.full.push(f.elapsedMs); scores.push(f.score!)
      t.light.push(evaluateDecision(view, a, { mode: 'light' }).elapsedMs); n++
    }
    game.apply(a)
  }
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)]
for (const m of ['full', 'light'] as const) console.log(`${m}: 中央値 ${q(t[m], 0.5)}ms / 90% ${q(t[m], 0.9)}ms / 最大 ${Math.max(...t[m])}ms（${t[m].length}局面）`)
console.log(`牌効率ボットの打牌の評価点: 平均 ${(scores.reduce((a, b) => a + b) / scores.length).toFixed(1)} / 90点以上 ${((scores.filter((s) => s >= 90).length / scores.length) * 100).toFixed(0)}%`)
