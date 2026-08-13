/**
 * Package-owned tool-git invariants：git_commit 的结果渲染必须携带合法 hash
 * （commit 的 canonical 值经 render 进入 tool/result——hash 是可重建性的锚点）。
 * @module @huiliyi37/dsh-tool-git/invariant
 */

import type { Context } from '@huiliyi37/cordis'
import type { Session, SessionEvent } from '@huiliyi37/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@huiliyi37/dsh-invariants'

const PACKAGE_NAME = '@huiliyi37/dsh-tool-git'
const COMMIT_RENDER_PREFIX = 'committed '

/** Cordis companion plugin name. */
export const name = 'tool-git-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one git_commit result render: the summary must carry a hash. */
function validateCommitRender(event: SessionEvent<'tool/result'>, fail: InvariantFailure): void {
  // tool/result 的 message.content 是 ToolResultBlock 元组；渲染文本在其子块。
  const blocks = event.data.message.content.flatMap(block => block.type === 'tool-result' ? block.content : [])
  const text = blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('')
  if (!text.startsWith(COMMIT_RENDER_PREFIX)) return
  // `committed <hash> <subject>` — hash 是 7+ 位十六进制
  if (!/^committed [0-9a-f]{7,} /.test(text)) {
    fail(`tool-git commit result must render a hash-bearing summary, got ${JSON.stringify(text)}`)
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned tool results already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    validateCommitRender(event, fail)
  }
}

/** Install validation for loaded and newly appended tool results. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type !== 'tool/result') return
    validateCommitRender(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the tool-git invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
