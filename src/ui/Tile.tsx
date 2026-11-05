/**
 * 牌の表示（画像を使わず文字で描く。白い牌・高い視認性：仕様 §8-1）
 */
import { kindName, rankOf, suitOf, type PhysicalTile } from '../engine/rules/tile'

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const HONORS = ['東', '南', '西', '北', '白', '發', '中']

export type TileSize = 'hand' | 'river' | 'meld' | 'mini'

interface Props {
  tile: PhysicalTile | null // null は裏向き
  size?: TileSize
  selected?: boolean
  disabled?: boolean
  highlight?: boolean
  /** 横向き（鳴いた牌・立直宣言牌） */
  sideways?: boolean
  /** 鳴かれて河から消えた牌 */
  ghost?: boolean
  onClick?: () => void
  onPointerEnter?: () => void
}

export function Tile({ tile, size = 'hand', selected, disabled, highlight, sideways, ghost, onClick, onPointerEnter }: Props) {
  const cls = [
    'tile',
    `tile--${size}`,
    tile ? `tile--${suitOf(tile.kind)}` : 'tile--back',
    tile?.red ? 'tile--red' : '',
    tile && tile.kind === 31 ? 'tile--haku' : '',
    tile && tile.kind === 32 ? 'tile--hatsu' : '',
    tile && tile.kind === 33 ? 'tile--chun' : '',
    selected ? 'is-selected' : '',
    disabled ? 'is-disabled' : '',
    highlight ? 'is-highlight' : '',
    sideways ? 'is-sideways' : '',
    ghost ? 'is-ghost' : '',
    onClick && !disabled ? 'is-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = tile ? (tile.red ? '赤' : '') + kindName(tile.kind) : '裏向きの牌'
  const content = tile ? <Face tile={tile} /> : null
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
      >
        {content}
      </button>
    )
  }
  return (
    <span className={cls} role="img" aria-label={label}>
      {content}
    </span>
  )
}

function Face({ tile }: { tile: PhysicalTile }) {
  const suit = suitOf(tile.kind)
  const rank = rankOf(tile.kind)
  if (suit === 'z') {
    return <span className="tile__honor">{tile.kind === 31 ? '' : HONORS[rank - 1]}</span>
  }
  const top = suit === 'm' ? KANJI_NUM[rank - 1] : String(rank)
  const bottom = suit === 'm' ? '萬' : suit === 'p' ? '筒' : '索'
  return (
    <>
      <span className="tile__num">{top}</span>
      <span className="tile__suit">{bottom}</span>
    </>
  )
}
