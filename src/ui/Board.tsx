/**
 * 麻雀卓（雀魂の画面構成を参考にしたレイアウト）
 *
 * - 中央の局情報パネル：各辺にその席の風と点数を、その席の向きで表示。手番の席の辺が光る
 * - 各席の河・立直棒・他家の手牌・副露は「卓と同じ大きさのレイヤー」を席の向きに回転させて置く
 * - 卓の四隅にプレイヤー表示（自分は左下、下家は右下、対面は右上、上家は左上）
 * 自分（席0）が下、下家（席1）が右、対面（席2）が上、上家（席3）が左。
 */
import type { CalledMeld, RiverTile, Seat } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'
import { Tile, type TileSize } from './Tile'
import { seatWind } from './labels'
import type { PlayerInfo } from './useGame'

interface Props {
  view: PlayerView
  players: PlayerInfo[]
  /** 手番の席 */
  activeSeat: Seat | null
}

const RIICHI_STICK = `${import.meta.env.BASE_URL}tiles/riichi-stick.png`

export function Board({ view, players, activeSeat }: Props) {
  const r = view.round
  return (
    <div className="board" aria-label="麻雀卓">
      <div className="board__felt" aria-hidden />
      {view.players.map((p) => {
        const pos = (p.seat - view.seat + 4) % 4
        const wind = seatWind(p.seat, r.dealer)
        return (
          <div key={p.seat} className={`board__layer board__layer--${pos}`}>
            {/* 中央パネルのこの席の辺：風と点数 */}
            <div className={`center-side ${activeSeat === p.seat ? 'is-active' : ''}`}>
              <span className={`center-side__wind ${p.seat === r.dealer ? 'is-dealer' : ''}`}>{wind}</span>
              <span className="center-side__points">{p.points.toLocaleString()}</span>
            </div>
            {p.riichi && <img className="riichi-stick" src={RIICHI_STICK} alt="立直棒" />}
            <River river={p.river} last={view.lastDiscard?.seat === p.seat} />
            {pos !== 0 && (
              <div className="board__edge">
                <div className="opp-hand" aria-label={`${players[p.seat].name}の手牌 ${p.handCount}枚`}>
                  {Array.from({ length: p.handCount }, (_, i) => (
                    <Tile key={i} tile={null} size="mini" />
                  ))}
                </div>
                <Melds melds={p.melds} owner={p.seat} size="mini" />
              </div>
            )}
          </div>
        )
      })}

      <div className="board__center">
        <div className="center__round">
          {['東', '南', '西', '北'][r.wind - 27]}
          {r.dealer + 1}局
        </div>
        <div className="center__wall" aria-label={`山の残り ${view.wallRemaining}枚`}>
          残 <b>{view.wallRemaining}</b>
        </div>
        <div className="center__sticks">
          <span title="本場">◆{r.honba}</span>
          <span title="供託">┃{r.kyoutaku}</span>
        </div>
      </div>

      {view.players.map((p) => {
        const pos = (p.seat - view.seat + 4) % 4
        const info = players[p.seat]
        return (
          <div
            key={p.seat}
            className={`player-plate player-plate--${pos} ${activeSeat === p.seat ? 'is-active' : ''} ${p.riichi ? 'is-riichi' : ''}`}
          >
            <span className={`avatar avatar--${p.seat}`} aria-hidden>
              {info.name.slice(0, 1)}
            </span>
            <span className="player-plate__text">
              <span className="player-plate__name">{info.name}</span>
              {p.riichi && <span className="player-plate__riichi">立直</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function River({ river, last }: { river: RiverTile[]; last: boolean }) {
  return (
    <div className="river">
      {river.map((rt, i) => (
        <Tile
          key={rt.tile.id}
          tile={rt.tile}
          size="river"
          sideways={rt.riichi}
          ghost={rt.calledBy !== null}
          highlight={last && i === river.length - 1}
        />
      ))}
    </div>
  )
}

export function Melds({ melds, owner, size }: { melds: CalledMeld[]; owner: Seat; size: TileSize }) {
  return (
    <div className="melds">
      {melds.map((m, i) => {
        const tiles = [...m.tiles]
        if (m.type === 'ankan') {
          return (
            <div key={i} className="meld" aria-label="暗槓">
              <Tile tile={null} size={size} />
              <Tile tile={tiles[1]} size={size} />
              <Tile tile={tiles[2]} size={size} />
              <Tile tile={null} size={size} />
            </div>
          )
        }
        // 鳴いた牌を、鳴いた相手の方向に横向きで置く（上家=左、対面=中央、下家=右）
        const called = m.calledTile!
        const rest = tiles.filter((t) => t.id !== called.id)
        const rel = m.from === null ? 0 : (m.from - owner + 4) % 4
        const at = rel === 3 ? 0 : rel === 2 ? 1 : rest.length
        const ordered = [...rest]
        ordered.splice(at, 0, called)
        return (
          <div key={i} className="meld" aria-label={m.type}>
            {ordered.map((t) => (
              <Tile key={t.id} tile={t} size={size} sideways={t.id === called.id} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
