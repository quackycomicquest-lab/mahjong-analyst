/**
 * 「要検証」の印：評価に疑問が残る判断に、振り返り・復習問題の画面から理由とメモをつける。
 * 印をつけた判断は、弱点分析の画面でまとめて再評価・書き出しできる。
 */
import { useState } from 'react'
import { deleteFlag, FLAG_REASONS, saveFlag, type FlagReason, type FlagRecord } from '../storage/db'

export function FlagEditor({
  gameId,
  decisionId,
  flag,
  onChange,
  extra,
  hint = '評価に納得できないときに印をつけ、あとで弱点分析の画面からまとめて再評価できます。',
}: {
  gameId: string
  decisionId: number
  flag: FlagRecord | null
  onChange: (f: FlagRecord | null) => void
  /** 印をつけるときに一緒に保存する項目（復習問題の答えなど） */
  extra?: Pick<FlagRecord, 'answer'>
  hint?: string
}) {
  const [note, setNote] = useState(flag?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const persist = (next: FlagRecord) => {
    onChange(next)
    saveFlag(next).catch((e: Error) => setError(`保存できませんでした（${e.message}）`))
  }

  if (!flag) {
    return (
      <div className="flag">
        <button
          type="button"
          className="btn btn--ghost btn--small flag__add"
          onClick={() => {
            const now = new Date().toISOString()
            setNote('')
            persist({ gameId, decisionId, reasons: [], note: '', createdAt: now, updatedAt: now, ...extra })
          }}
        >
          ⚑ 要検証にする
        </button>
        <span className="muted small">{hint}</span>
        {error && <span className="eval__error small">{error}</span>}
      </div>
    )
  }

  const toggle = (r: FlagReason) => {
    const reasons = flag.reasons.includes(r) ? flag.reasons.filter((x) => x !== r) : [...flag.reasons, r]
    persist({ ...flag, reasons, updatedAt: new Date().toISOString() })
  }

  return (
    <div className="flag is-on">
      <div className="flag__head">
        <span className="flag__title">⚑ 要検証</span>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            onChange(null)
            deleteFlag(gameId, decisionId).catch((e: Error) => setError(`外せませんでした（${e.message}）`))
          }}
        >
          印を外す
        </button>
      </div>
      <div className="flag__reasons" role="group" aria-label="疑問の理由">
        {FLAG_REASONS.map(([r, label]) => (
          <button
            key={r}
            type="button"
            className={`flag__reason ${flag.reasons.includes(r) ? 'is-on' : ''}`}
            aria-pressed={flag.reasons.includes(r)}
            onClick={() => toggle(r)}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="flag__note"
        rows={2}
        placeholder="メモ（例：両面より打点を取るべきでは？）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== flag.note) persist({ ...flag, note, updatedAt: new Date().toISOString() })
        }}
      />
      {error && <span className="eval__error small">{error}</span>}
    </div>
  )
}
