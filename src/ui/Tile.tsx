/**
 * 牌の表示（仕様 §8-1：白い牌・高い視認性）
 *
 * 表向きの牌は public/tiles/ の画像（m1〜m9・p1〜p9・s1〜s9・z1〜z7、赤5は m0・p0・s0）。
 * z1〜z7 はアプリの字牌の並び（東南西北白發中）。裏向きの牌は CSS で描く。
 */
import { kindName, rankOf, suitOf, type PhysicalTile } from '../engine/rules/tile'

export type TileSize = 'hand' | 'river' | 'meld' | 'mini'

/** 牌画像のパス（公開先のサブパスにも対応） */
function tileImageUrl(tile: PhysicalTile): string {
  const suit = suitOf(tile.kind)
  const rank = tile.red ? 0 : rankOf(tile.kind)
  return `${import.meta.env.BASE_URL}tiles/${suit}${rank}.png`
}

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
    tile ? 'tile--face' : 'tile--back',
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
  const content = tile ? <img className="tile__img" src={tileImageUrl(tile)} alt="" draggable={false} /> : null
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
