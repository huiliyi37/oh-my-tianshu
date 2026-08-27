/**
 * Rewind control (P2④): the trajectory toolbar's entry into the web mirror of
 * the TUI's `/rewind` — pick a user-message checkpoint, choose the scope
 * (conversation truncation / file restore / both), execute through the host
 * `session.rewind` call, and read the restore counts off the panel.
 *
 * Pure presentational state machine: checkpoints and the host call arrive as
 * props from the assembling view (the trajectory plugin's inject closure owns
 * the connection face).
 */

import { useMemo, useState } from 'react'
import type { RewindMode } from '@huiliyi37/dsh-host-apiproxy/api'
import css from './RewindControl.module.css'

/** One selectable checkpoint (a user message the log can be cut back to). */
export interface RewindCheckpoint {
  /** The user/message event seq (inclusive rewind boundary). */
  readonly seq: number
  /** Display snippet folded from the message's text blocks. */
  readonly text: string
}

/** Host rewind result (session.rewind response value). */
export interface RewindResult {
  filesChanged: number
  filesSkipped?: number
  truncatedTo?: number
}

/** RewindControl props: checkpoint list + the host-bound executor. */
export interface RewindControlProps {
  /** User-message checkpoints, oldest first. */
  readonly checkpoints: readonly RewindCheckpoint[]
  /** Execute the rewind; throws the host's own error text on rejection. */
  readonly onRewind: (atSeq: number, mode: RewindMode) => Promise<RewindResult>
}

const MODES: readonly { value: RewindMode; label: string }[] = [
  { value: 'convo', label: 'Conversation' },
  { value: 'code', label: 'Code' },
  { value: 'both', label: 'Both' },
]

const SNIPPET_LIMIT = 64

/** Fold one checkpoint's display snippet. */
function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return '(empty message)'
  return collapsed.length > SNIPPET_LIMIT ? `${collapsed.slice(0, SNIPPET_LIMIT - 1)}…` : collapsed
}

/**
 * Render the rewind button + checkpoint/mode/execute panel.
 * @param props - checkpoints and the host-bound executor.
 * @returns the control element.
 */
export function RewindControl({ checkpoints, onRewind }: RewindControlProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<RewindMode>('both')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  const checkpoint = useMemo(() =>
    selected === null ? undefined : checkpoints[selected], [checkpoints, selected])

  const execute = (): void => {
    if (checkpoint === undefined || busy) return
    setBusy(true)
    setOutcome(null)
    void onRewind(checkpoint.seq, mode).then((result) => {
      const parts = [`${result.filesChanged} file(s) restored`]
      if (result.filesSkipped !== undefined && result.filesSkipped > 0) parts.push(`${result.filesSkipped} snapshot(s) missing`)
      if (result.truncatedTo !== undefined) parts.push(`conversation truncated to seq ${result.truncatedTo}`)
      setOutcome(parts.join(' · '))
    }, (error: unknown) => {
      setOutcome(error instanceof Error ? error.message : String(error))
    }).finally(() => { setBusy(false) })
  }

  return (
    <div className={css.root}>
      <button
        type="button"
        className={css.toggle}
        aria-pressed={open}
        title="Rewind to a checkpoint"
        onClick={() => {
          setOpen(!open)
          if (!open) setOutcome(null)
        }}
      >
        ⟲ Rewind
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-label="Rewind">
          {checkpoints.length === 0 ? (
            <div className={css.empty}>No user checkpoints yet — send a message first.</div>
          ) : (
            <>
              <div className={css.list} role="listbox" aria-label="Checkpoints">
                {checkpoints.map((item, index) => (
                  <button
                    key={item.seq}
                    type="button"
                    role="option"
                    aria-selected={selected === index}
                    className={css.item}
                    onClick={() => { setSelected(index) }}
                  >
                    <span className={css.seq}>#{item.seq}</span>
                    <span className={css.snippet}>{snippetOf(item.text)}</span>
                  </button>
                ))}
              </div>
              <div className={css.modes} role="radiogroup" aria-label="Rewind scope">
                {MODES.map(entry => (
                  <button
                    key={entry.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === entry.value}
                    className={css.mode}
                    onClick={() => { setMode(entry.value) }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className={css.actions}>
                <button type="button" className={css.execute} disabled={checkpoint === undefined || busy} onClick={execute}>
                  {busy ? 'Rewinding…' : 'Rewind'}
                </button>
                {outcome !== null && <div className={css.outcome} role="status">{outcome}</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
