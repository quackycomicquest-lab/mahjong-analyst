/**
 * 自分の手牌と操作ボタン（仕様 §2-3）
 *
 * - Mac：クリックで即打牌。←→ で牌を選び Enter で打牌、Esc で取り消し／スキップ。
 * - iPhone：1回目のタップで牌を選び、もう一度タップで打牌（誤操作防止）。
 * - 立直・カン・九種九牌は確認してから実行する。
 * 自分が判断する場面ごとに key で作り直すので、選択状態は場面が変わると自然に戻る。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Action, Seat } from '../engine/game/types'
import type { PlayerView } from '../engine/game/view'
import type { PhysicalTile } from '../engine/rules/tile'
import { Melds } from './Board'
import { Tile } from './Tile'
import { tileLabel } from './labels'
import type { PlayerInfo } from './useGame'

interface Props {
  view: PlayerView
  players: PlayerInfo[]
  activeSeat: Seat | null
  onAct: (a: Action) => void
}

interface Choice {
  label: string
  tiles: PhysicalTile[]
  action: Action
}

type Dialog =
  | { kind: 'confirm'; message: string; tiles: PhysicalTile[]; action: Action }
  | { kind: 'pick'; title: string; choices: Choice[] }

const isCoarsePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

export function Controls({ view, players, activeSeat, onAct }: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [riichiMode, setRiichiMode] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const coarse = useMemo(() => isCoarsePointer(), [])
  const acts = view.legalActions
  const byId = useCallback((id: number) => view.hand.find((t) => t.id === id)!, [view.hand])

  const discardIds = new Set(acts.flatMap((a) => (a.type === 'discard' && !a.riichi ? [a.tileId] : [])))
  const riichiIds = new Set(acts.flatMap((a) => (a.type === 'discard' && a.riichi ? [a.tileId] : [])))
  const myTurn = discardIds.size > 0
  const clickable = riichiMode ? riichiIds : discardIds

  // 表示順：理牌した手牌 → ツモ牌
  const drawn = view.drawn
  const sorted = view.hand
    .filter((t) => t.id !== drawn?.id)
    .sort((a, b) => a.kind - b.kind || Number(b.red) - Number(a.red))
  const ordered = drawn ? [...sorted, drawn] : sorted
  const order = ordered.filter((t) => clickable.has(t.id)).map((t) => t.id)

  const discard = useCallback(
    (id: number) => {
      if (riichiMode) {
        setDialog({
          kind: 'confirm',
          message: `${tileLabel(byId(id))}を切って立直します。よろしいですか？`,
          tiles: [byId(id)],
          action: { type: 'discard', seat: view.seat, tileId: id, riichi: true },
        })
        return
      }
      onAct({ type: 'discard', seat: view.seat, tileId: id })
    },
    [riichiMode, byId, onAct, view.seat],
  )

  const onTile = (id: number) => {
    if (!clickable.has(id)) return
    if (coarse && selected !== id) {
      setSelected(id)
      return
    }
    discard(id)
  }

  const pass = acts.find((a) => a.type === 'pass')

  // キーボード操作（Mac）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) {
        if (e.key === 'Escape') setDialog(null)
        if (e.key === 'Enter' && dialog.kind === 'confirm') {
          onAct(dialog.action)
          setDialog(null)
        }
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (order.length === 0) return
        e.preventDefault()
        const i = selected === null ? -1 : order.indexOf(selected)
        const next = e.key === 'ArrowRight' ? (i + 1) % order.length : (i - 1 + order.length) % order.length
        setSelected(order[i === -1 && e.key === 'ArrowLeft' ? order.length - 1 : next])
      } else if (e.key === 'Enter' && selected !== null && clickable.has(selected)) {
        e.preventDefault()
        discard(selected)
      } else if (e.key === 'Escape') {
        if (riichiMode) setRiichiMode(false)
        else if (pass) onAct(pass)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- ボタン
  const buttons: { key: string; label: string; tone?: 'win' | 'call' | 'riichi' | 'plain'; onClick: () => void }[] = []
  const tsumo = acts.find((a) => a.type === 'tsumo')
  const ron = acts.find((a) => a.type === 'ron')
  if (tsumo) buttons.push({ key: 'tsumo', label: 'ツモ', tone: 'win', onClick: () => onAct(tsumo) })
  if (ron) buttons.push({ key: 'ron', label: 'ロン', tone: 'win', onClick: () => onAct(ron) })
  if (riichiIds.size > 0 && !riichiMode) {
    buttons.push({ key: 'riichi', label: '立直', tone: 'riichi', onClick: () => setRiichiMode(true) })
  }
  if (riichiMode) buttons.push({ key: 'cancel', label: '立直をやめる', tone: 'plain', onClick: () => setRiichiMode(false) })

  const kanChoices: Choice[] = acts.flatMap((a): Choice[] => {
    if (a.type === 'ankan') {
      const tiles = view.hand.filter((t) => t.kind === a.kind)
      return [{ label: `暗槓 ${tileLabel(tiles[0])}`, tiles, action: a }]
    }
    if (a.type === 'kakan') return [{ label: `加槓 ${tileLabel(byId(a.tileId))}`, tiles: [byId(a.tileId)], action: a }]
    if (a.type === 'daiminkan') {
      const t = view.lastDiscard!.tile
      return [{ label: `大明槓 ${tileLabel(t)}`, tiles: [...view.hand.filter((h) => h.kind === t.kind), t], action: a }]
    }
    return []
  })
  if (kanChoices.length > 0) {
    buttons.push({
      key: 'kan',
      label: 'カン',
      tone: 'call',
      onClick: () =>
        kanChoices.length === 1
          ? setDialog({ kind: 'confirm', message: `${kanChoices[0].label}をします。よろしいですか？`, tiles: kanChoices[0].tiles, action: kanChoices[0].action })
          : setDialog({ kind: 'pick', title: 'カンする牌', choices: kanChoices }),
    })
  }
  for (const type of ['pon', 'chi'] as const) {
    const choices: Choice[] = acts.flatMap((a): Choice[] =>
      a.type === type ? [{ label: a.tileIds.map((id) => tileLabel(byId(id))).join('・'), tiles: a.tileIds.map(byId), action: a }] : [],
    )
    if (choices.length === 0) continue
    buttons.push({
      key: type,
      label: type === 'pon' ? 'ポン' : 'チー',
      tone: 'call',
      onClick: () =>
        choices.length === 1 ? onAct(choices[0].action) : setDialog({ kind: 'pick', title: type === 'pon' ? 'ポンの組み合わせ' : 'チーの組み合わせ', choices }),
    })
  }
  const kyuushu = acts.find((a) => a.type === 'kyuushu')
  if (kyuushu) {
    buttons.push({
      key: 'kyuushu',
      label: '九種九牌',
      tone: 'plain',
      onClick: () => setDialog({ kind: 'confirm', message: '九種九牌で流局にします。よろしいですか？', tiles: [], action: kyuushu }),
    })
  }
  if (pass) buttons.push({ key: 'pass', label: 'スキップ', tone: 'plain', onClick: () => onAct(pass) })

  let status = ''
  if (riichiMode) status = '立直する牌を選んでください'
  else if (myTurn) status = coarse ? '切る牌をタップ（もう一度タップで確定）' : '切る牌をクリック（←→で選択・Enterで確定）'
  else if (pass) status = `${players[view.lastDiscard?.seat ?? 0].name}の打牌に応答できます`
  else if (activeSeat !== null && activeSeat !== view.seat) status = `${players[activeSeat].name}の手番`

  const me = view.players[view.seat]
  return (
    <div className="controls">
      <div className="action-bar">
        <span className="action-bar__status" aria-live="polite">
          {status}
        </span>
        <div className="action-bar__buttons">
          {buttons.map((b) => (
            <button key={b.key} type="button" className={`btn btn--${b.tone ?? 'plain'}`} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hand-row">
        <div className={`hand ${myTurn ? 'is-active' : ''}`} aria-label="自分の手牌">
          {ordered.map((t) => (
            <span key={t.id} className={drawn && t.id === drawn.id ? 'hand__drawn' : undefined}>
              <Tile
                tile={t}
                size="hand"
                selected={selected === t.id}
                disabled={myTurn && !clickable.has(t.id)}
                highlight={riichiMode && riichiIds.has(t.id)}
                onClick={myTurn ? () => onTile(t.id) : undefined}
              />
            </span>
          ))}
        </div>
        {me.melds.length > 0 && (
          <div className="my-melds">
            <Melds melds={me.melds} owner={view.seat} size="meld" />
          </div>
        )}
      </div>

      {dialog && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__card modal__card--small">
            {dialog.kind === 'confirm' ? (
              <>
                <p className="modal__message">{dialog.message}</p>
                {dialog.tiles.length > 0 && (
                  <div className="modal__tiles">
                    {dialog.tiles.map((t) => (
                      <Tile key={t.id} tile={t} size="meld" />
                    ))}
                  </div>
                )}
                <div className="modal__buttons">
                  <button type="button" className="btn btn--plain" onClick={() => setDialog(null)}>
                    やめる
                  </button>
                  <button
                    type="button"
                    className="btn btn--riichi"
                    autoFocus
                    onClick={() => {
                      onAct(dialog.action)
                      setDialog(null)
                    }}
                  >
                    決定
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal__message">{dialog.title}</p>
                <div className="modal__choices">
                  {dialog.choices.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className="choice"
                      onClick={() => {
                        onAct(c.action)
                        setDialog(null)
                      }}
                    >
                      <span className="choice__tiles">
                        {c.tiles.map((t) => (
                          <Tile key={t.id} tile={t} size="mini" />
                        ))}
                      </span>
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
                <div className="modal__buttons">
                  <button type="button" className="btn btn--plain" onClick={() => setDialog(null)}>
                    やめる
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
