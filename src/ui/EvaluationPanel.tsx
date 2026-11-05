/**
 * AI評価パネル（仕様 §3-2）
 *
 * レベル1（簡易評価）を常に表示し、レベル2（詳細）・レベル3（専門分析）は展開して見る。
 * 評価点は色だけでなく言葉と数値でも示す（仕様 §8-1）。
 */
import { useState } from 'react'
import type { CandidateEvaluation, Evaluation } from '../engine/evaluator/types'
import { kindName } from '../engine/rules/tile'
import { DECISION_NAMES, pct, scoreGrade } from './labels'
import type { EvalEntry, PlayerInfo } from './useGame'

interface Props {
  evals: EvalEntry[]
  players: PlayerInfo[]
  /** iPhone の下部パネルで折りたたまれているか */
  collapsed: boolean
  onToggle: () => void
}

export function EvaluationPanel({ evals, players, collapsed, onToggle }: Props) {
  const [pick, setPick] = useState<{ id: number; latestAtPick: number } | null>(null)
  const [level, setLevel] = useState<1 | 2 | 3>(1)
  const latest = evals[evals.length - 1]
  // 過去の評価を選んでいても、新しい判断をしたら最新の評価に戻る
  const pickedId = pick && pick.latestAtPick === latest?.decisionId ? pick.id : null
  const entry = evals.find((e) => e.decisionId === pickedId) ?? latest
  const ev = entry?.evaluation ?? null

  return (
    <section className={`eval ${collapsed ? 'is-collapsed' : ''}`} aria-label="AI評価">
      <button type="button" className="eval__handle" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="eval__title">AI評価</span>
        <Summary entry={entry} />
        <span className="eval__chevron" aria-hidden>
          {collapsed ? '▲' : '▼'}
        </span>
      </button>

      <div className="eval__body">
        {!entry && <p className="eval__empty">牌を切る・鳴く・見送るなどの判断をすると、その評価がここに表示されます。</p>}
        {entry && !ev && !entry.error && <p className="eval__pending">「{entry.label}」を評価しています…</p>}
        {entry?.error && <p className="eval__error">評価できませんでした：{entry.error}</p>}
        {ev && <EvaluationDetail ev={ev} label={entry.label} players={players} level={level} setLevel={setLevel} />}

        {evals.length > 1 && (
          <div className="eval__history" aria-label="これまでの判断">
            {evals
              .slice(-24)
              .reverse()
              .map((e) => {
                const s = e.evaluation?.score
                const tone = s == null ? 'none' : scoreGrade(s).tone
                return (
                  <button
                    key={e.decisionId}
                    type="button"
                    className={`chip chip--${tone} ${e === entry ? 'is-current' : ''}`}
                    onClick={() => setPick({ id: e.decisionId, latestAtPick: latest.decisionId })}
                  >
                    {e.label} {s ?? '…'}
                  </button>
                )
              })}
          </div>
        )}
      </div>
    </section>
  )
}

function Summary({ entry }: { entry: EvalEntry | undefined }) {
  const s = entry?.evaluation?.score
  if (!entry) return <span className="eval__summary">—</span>
  if (s == null) return <span className="eval__summary">{entry.evaluation ? '評価不能' : '評価中…'}</span>
  const g = scoreGrade(s)
  return (
    <span className={`eval__summary tone--${g.tone}`}>
      {entry.label}：{s}点 {g.label}
    </span>
  )
}

export function EvaluationDetail({
  ev,
  label,
  players,
  level,
  setLevel,
}: {
  ev: Evaluation
  label: string
  players: PlayerInfo[]
  level: 1 | 2 | 3
  setLevel: (l: 1 | 2 | 3) => void
}) {
  if (ev.status === 'unavailable' || ev.score == null) {
    return <p className="eval__empty">評価不能：{ev.statusReason}</p>
  }
  const g = scoreGrade(ev.score)
  const chosen = ev.chosen!
  const best = ev.best!
  return (
    <div className="eval__detail">
      {/* レベル1：簡易評価 */}
      <div className="eval__score-row">
        <div className={`score tone--${g.tone}`}>
          <span className="score__value">{ev.score}</span>
          <span className="score__max">/ 100</span>
        </div>
        <div className="eval__headline">
          <div className={`grade tone--${g.tone}`}>{g.label}</div>
          <div className="eval__badges">
            <span className="badge badge--kind">{DECISION_NAMES[ev.decision ?? 'discard']}</span>
            {ev.status === 'provisional' && <span className="badge">暫定評価</span>}
          </div>
          <div className="eval__choice">
            あなた：<b>{label}</b>　最善：<b>{best.label}</b>
          </div>
          <div className="eval__loss">
            判断損失 {ev.loss === 0 ? 'なし' : `−${ev.loss}点`}
            {ev.loss !== 0 && <span className="muted">（誤差 ±{ev.lossStdError}点）</span>}
          </div>
        </div>
      </div>
      {ev.analysis.riichi && <RiichiLine r={ev.analysis.riichi} />}
      {ev.good.length > 0 && (
        <ul className="notes notes--good">
          {ev.good.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {ev.improve.length > 0 && (
        <ul className="notes notes--improve">
          {ev.improve.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      <div className="tabs" role="tablist">
        {([1, 2, 3] as const).map((l) => (
          <button key={l} type="button" role="tab" aria-selected={level === l} className="tab" onClick={() => setLevel(l)}>
            {l === 1 ? '概要' : l === 2 ? '詳細' : '専門分析'}
          </button>
        ))}
      </div>

      {level === 2 && <Level2 chosen={chosen} best={best} candidates={ev.candidates} />}
      {level === 3 && <Level3 ev={ev} players={players} />}

      <p className="eval__meta">
        {ev.statusReason}。{ev.mode === 'full' ? '高精度' : '軽量'}評価（候補ごと{ev.simulations}回試行・{ev.elapsedMs}ms）・信頼度 {pct(ev.confidence)}・{ev.engineVersion}
      </p>
    </div>
  )
}

function RiichiLine({ r }: { r: NonNullable<Evaluation['analysis']['riichi']> }) {
  const ok = r.recommended === r.chosen
  return (
    <div className={`riichi-line ${ok ? 'is-ok' : 'is-ng'}`}>
      <span className="riichi-line__title">立直判断</span>
      <span>
        立直 <b>{r.riichiEv}点</b> ／ ダマ <b>{r.damaEv}点</b>
      </span>
      <span>
        おすすめ：{r.recommended === 'riichi' ? '立直' : 'ダマ'}
        {ok ? '（一致）' : `（あなたは${r.chosen === 'riichi' ? '立直' : 'ダマ'}）`}
      </span>
    </div>
  )
}

function Level2({ chosen, best, candidates }: { chosen: CandidateEvaluation; best: CandidateEvaluation; candidates: CandidateEvaluation[] }) {
  const rows: [string, (c: CandidateEvaluation) => string][] = [
    ['シャンテン数', (c) => (c.shanten === 0 ? '聴牌' : `${c.shanten}向聴`)],
    ['受け入れ枚数', (c) => `${c.ukeire}枚`],
    ['有効牌', (c) => c.effectiveKinds.map(kindName).join(' ') || '—'],
    ['和了率（推定）', (c) => pct(c.winRate)],
    ['和了時の平均点', (c) => (c.winValue ? `${c.winValue.toLocaleString()}点` : '—')],
    ['この牌の放銃率', (c) => pct(c.immediateDealIn)],
    ['局の放銃率（推定）', (c) => pct(c.dealInRate)],
    ['局の収支期待値', (c) => `${c.ev}点`],
  ]
  return (
    <div className="level">
      <table className="compare">
        <thead>
          <tr>
            <th></th>
            <th>あなた（{chosen.label}）</th>
            <th>最善（{best.label}）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, f]) => (
            <tr key={name}>
              <th>{name}</th>
              <td>{f(chosen)}</td>
              <td>{f(best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="level__title">全候補（期待値の高い順）</h4>
      <table className="candidates">
        <thead>
          <tr>
            <th>候補</th>
            <th>期待値</th>
            <th>和了率</th>
            <th>放銃率</th>
            <th>向聴</th>
            <th>受入</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.label} className={c.label === chosen.label ? 'is-chosen' : c.label === best.label ? 'is-best' : ''}>
              <td>{c.label}</td>
              <td>{c.ev}</td>
              <td>{pct(c.winRate)}</td>
              <td>{pct(c.dealInRate)}</td>
              <td>{c.shanten}</td>
              <td>{c.ukeire}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Level3({ ev, players }: { ev: Evaluation; players: PlayerInfo[] }) {
  const a = ev.analysis
  return (
    <dl className="level analysis">
      <dt>押し引き判断</dt>
      <dd>{a.stance === null ? '脅威なし（自分の手を進める局面）' : a.stance === 'push' ? '押し（手を進める方が期待値が高い）' : '引き（降りる方が期待値が高い）'}</dd>
      <dt>相手の立直・仕掛け</dt>
      <dd>
        {a.threats.length === 0
          ? 'なし'
          : a.threats.map((t) => `${players[t.seat].name}（${t.riichi ? '立直' : '副露'}）`).join('、')}
      </dd>
      <dt>安全牌の選択</dt>
      <dd>
        {a.safest
          ? `最も安全なのは ${a.safest.label}（放銃率 ${pct(a.safest.immediateDealIn)}）。あなたの選択は ${pct(ev.chosen!.immediateDealIn)}`
          : '—'}
      </dd>
      <dt>順位期待値</dt>
      <dd className="muted">未対応（今後の版で追加）</dd>
      <dt>立直判断</dt>
      <dd>
        {ev.analysis.riichi
          ? `${ev.analysis.riichi.tile}切りで 立直 ${ev.analysis.riichi.riichiEv}点 ／ ダマ ${ev.analysis.riichi.damaEv}点（おすすめ：${ev.analysis.riichi.recommended === 'riichi' ? '立直' : 'ダマ'}）`
          : '—（この判断では立直を選べませんでした）'}
      </dd>
      <dt>局面全体の期待値</dt>
      <dd>
        最善 {ev.best!.ev}点 ／ あなた {ev.chosen!.ev}点
      </dd>
    </dl>
  )
}
