// ProducedFiles: the produced-file row a finished turn ends with. The paths
// come pre-matched by the turn-tail chain from the mutation tools'
// follow-along locations, never from the closing prose. Clicking one goes
// through the same openFile the tool rows use — the Host's own opener, on the
// Host machine.

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Files past this stay counted but unlisted: a refactor turn must not bury the answer. */
const SHOWN = 6

/** Matched paths plus the opener and locale seats needed to present them. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS>

/**
 * Render one turn's produced files as openable chips.
 * @param props - selector-matched paths, the chat view's file opener, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({ matched: paths, openFile, t }: ProducedFilesProps) {
  const shown = paths.slice(0, SHOWN)
  const hidden = paths.length - shown.length
  return (
    <div className={css.root}>
      <span className={css.label}>{t('produced.label')}</span>
      {shown.map(path => (
        <button
          key={path}
          type="button"
          className={css.file}
          // The full path is the disambiguator when two turns produce files
          // that share a basename; the chip itself stays short.
          title={path}
          aria-label={t('produced.open', { name: path })}
          onClick={() => { openFile(path) }}
        >
          {basename(path)}
        </button>
      ))}
      {hidden > 0 && <span className={css.more}>{t('produced.more', { count: String(hidden) })}</span>}
    </div>
  )
}
