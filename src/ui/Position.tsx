/**
 * 評価した局面の表示（振り返り・要検証の画面で共通）
 * 判断直前の手牌に、選んだ牌と最善の牌の印をつけ、その下に最善と自分の選択の「切った後の牌姿」を並べる
 */
import { handAfter, type HandAfter } from '../engine/coach/handAfter'
import type { CandidateEvaluation } from '../engine/evaluator/types'
import type { StoredEvaluation } from '../storage/db'
import { Tile } from './Tile'

export type PositionRecord = Pick<StoredEvaluation, 'snapshot' | 'action' | 'evaluation' | 'roundLabel'>

/** 評価した局面（判断直前の手牌）。打牌なら選んだ牌と最善の牌に印を付ける */
export function Position({ record }: { record: PositionRecord }) {
  const v = record.snapshot
  const a = record.action
  const chosenId = a.type === 'discard' ? a.tileId : -1
  const ev = record.evaluation
  const bestKind = ev.best?.kind
  const hand = [...v.hand].sort((x, y) => x.kind - y.kind || Number(y.red) - Number(x.red))
  // 最善を選んだ場合と、実際に選んだ場合の牌姿
  const chosenCand = ev.chosen ?? null
  const bestCand = ev.best ?? null
  const chosenAfter = handAfter(v, chosenCand?.action ?? a, chosenCand?.kind ?? null)
  const sameAsBest = !!bestCand && !!chosenCand && bestCand.label === chosenCand.label
  const bestAfter = bestCand && !sameAsBest ? handAfter(v, bestCand.action, bestCand.kind) : null
  return (
    <div className="position">
      <div className="position__meta">
        {record.roundLabel}・残り{v.wallRemaining}枚・ドラ表示
        {v.doraIndicators.map((k, i) => (
          <Tile key={i} tile={{ id: -1 - i, kind: k, red: false }} size="mini" />
        ))}
        {v.players.some((p) => p.seat !== v.seat && p.riichi) && <span className="badge">他家立直あり</span>}
      </div>
      <div className="position__hand">
        {hand.map((t) => (
          <span key={t.id} className="position__tile">
            <Tile tile={t} size="meld" selected={t.id === chosenId} highlight={t.kind === bestKind && t.id !== chosenId} />
          </span>
        ))}
        {v.responseTo && (
          <span className="position__called">
            <span className="muted">他家の打牌</span>
            <Tile tile={v.responseTo.tile} size="meld" highlight />
          </span>
        )}
      </div>
      <p className="position__legend muted">黄色の枠：あなたの打牌 ／ 枠線：最善の打牌</p>
      {(bestAfter || chosenAfter) && (
        <div className="after-hands">
          {bestAfter && bestCand && <AfterHand title="最善" cand={bestCand} after={bestAfter} tone="best" />}
          {chosenAfter && (
            <AfterHand
              title={sameAsBest ? 'あなた（最善と同じ）' : 'あなた'}
              cand={chosenCand}
              after={chosenAfter}
              tone={sameAsBest ? 'best' : 'chosen'}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** 行動した後の牌姿と、その形の向聴数・受け入れ */
function AfterHand({
  title,
  cand,
  after,
  tone,
}: {
  title: string
  cand: CandidateEvaluation | null
  after: HandAfter
  tone: 'best' | 'chosen'
}) {
  const kinds = cand?.effectiveKinds ?? []
  return (
    <div className={`after-hand after-hand--${tone}`}>
      <div className="after-hand__head">
        <b>{title}</b>
        <span>{cand?.label ?? ''}</span>
        {cand && (
          <span className="muted">
            {cand.shanten <= 0 ? '聴牌' : `${cand.shanten}向聴`}・{cand.shanten <= 0 ? '待ち' : '受け入れ'} {cand.ukeire}枚
          </span>
        )}
      </div>
      <div className="after-hand__tiles">
        {after.tiles.map((t) => (
          <Tile key={t.id} tile={t} size="meld" />
        ))}
        {after.meld && (
          <span className="after-hand__meld">
            {after.meld.map((t) => (
              <Tile key={t.id} tile={t} size="meld" />
            ))}
          </span>
        )}
        {after.discarded && (
          <span className="after-hand__cut">
            <span className="muted">切り</span>
            <Tile tile={after.discarded} size="meld" />
          </span>
        )}
      </div>
      {kinds.length > 0 && (
        <div className="after-hand__waits">
          <span className="muted">{cand!.shanten <= 0 ? '待ち' : '有効牌'}</span>
          {kinds.map((k) => (
            <Tile key={k} tile={{ id: -100 - k, kind: k, red: false }} size="mini" />
          ))}
        </div>
      )}
    </div>
  )
}
