/**
 * 麻雀卓（河・副露・他家の手牌・中央の局情報）
 *
 * 各席の河は「卓と同じ大きさのレイヤー」を席の向きに回転させて置く。
 * 自分（席0）が下、下家（席1）が右、対面（席2）が上、上家（席3）が左。
 */
import type { CalledMeld, RiverTile, Seat } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'
import { Tile, type TileSize } from './Tile'
import { roundLabel, seatWind } from './labels'
import type { PlayerInfo } from './useGame'

interface Props {
  view: PlayerView
  players: PlayerInfo[]
  /** 手番の席 */
  activeSeat: Seat | null
}

export function Board({ view, players, activeSeat }: Props) {
  const r = view.round
  return (
    <div className="board" aria-label="麻雀卓">
      {view.players.map((p) => {
        const pos = (p.seat - view.seat + 4) % 4
        return (
          <div key={p.seat} className={`board__layer board__layer--${pos}`}>
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
        <div className="center__round">{roundLabel(r.wind, r.dealer, r.honba)}</div>
        <div className="center__sticks" aria-label={`供託 ${r.kyoutaku}本`}>
          供託 {r.kyoutaku} ・ 残り {view.wallRemaining}
        </div>
        <div className="center__dora">
          <span className="center__dora-label">ドラ表示</span>
          {view.doraIndicators.map((k, i) => (
            <Tile key={i} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
          ))}
        </div>
        {view.players.map((p) => {
          const pos = (p.seat - view.seat + 4) % 4
          return (
            <div
              key={p.seat}
              className={`seat-plate seat-plate--${pos} ${activeSeat === p.seat ? 'is-active' : ''} ${p.riichi ? 'is-riichi' : ''}`}
            >
              <span className="seat-plate__wind">{seatWind(p.seat, r.dealer)}</span>
              <span className="seat-plate__name">{players[p.seat].name}</span>
              <span className="seat-plate__points">{p.points.toLocaleString()}</span>
              {p.riichi && <span className="seat-plate__riichi">立直</span>}
            </div>
          )
        })}
      </div>
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
