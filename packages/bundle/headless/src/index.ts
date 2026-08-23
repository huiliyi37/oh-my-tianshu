/**
 * @huiliyi37/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry, drives the task to quiescence,
 * flushes its Session, prints the final assistant text, and exits.
 *
 * @module @huiliyi37/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { installModelSelection } from '@huiliyi37/dsh-agent'
import type { ModelSelectionRef } from '@huiliyi37/dsh-agent'
import type {} from '@huiliyi37/dsh-agent-default-model'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import { SessionId } from '@huiliyi37/dsh-session'
import type { SessionEvent } from '@huiliyi37/dsh-session'
// Empty type import carries the loader Context merge for the settlement await.
import type {} from '@huiliyi37/cordis-plugin-loader'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task, patched in by the launcher. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
  /** Existing persisted session to resume with the task (`run --session <id>`; absent = fresh session). */
  sessionId?: string
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
  // schemastery 对象属性缺省可选：缺省即新建会话。
  sessionId: z.string(),
})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/**
 * Process-facing effects of one run, injectable for tests. The launcher owns
 * bounded tree shutdown and wires `exit()` to it.
 */
export interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

declare module '@huiliyi37/cordis' {
  interface Context {
    /** Process-facing effects provided before the headless tree mounts. */
    headlessIo?: HeadlessIo
  }
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a freshly created or resumed Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param task - one-shot task text.
 * @param sessionId - existing persisted session to resume (undefined = fresh session).
 * @param io - process-facing effects.
 */
async function run(ctx: Context, task: string, sessionId: string | undefined, io: HeadlessIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  const agentOptions = { provider: selection.provider, model: selection.model }
  const presets = ctx.reflect.get('agentPresets', false) as
    | { defaultId?: string; mount?(ctx: Context, id?: string): Promise<unknown> }
    | undefined
  const presetId = presets?.defaultId
  const mountDefaultPreset = async (agentCtx: Context): Promise<void> => {
    if (presets?.mount === undefined) return
    await presets.mount(agentCtx)
  }
  // session-resume 1.4：--session 恢复既有会话（上下文重建）；缺省新建。
  const { agent } = sessionId !== undefined
    ? await agents.resume({
      resumeSessionId: SessionId(sessionId),
      agentOptions,
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    : await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd(), ...(presetId === undefined ? {} : { agentPreset: presetId }) },
      agentOptions,
      setup: async (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
        await mountDefaultPreset(agentCtx)
      },
    })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-owned IO seam.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  const io = ctx.headlessIo
  if (io === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.headlessIo before the tree mounts')
  }
  void run(ctx, config.task, config.sessionId, io).catch((error: unknown) => {
    if (config.sessionId === undefined) {
      fail(io, error)
      return
    }
    // --session 恢复失败（含未知会话 id）fails loud，并给出可用入口指引：
    // 绝不静默降级为新建会话（会话内容会因此丢失上下文）。
    const message = error instanceof Error ? error.message : String(error)
    const hint = message.includes('not found')
      ? 'dsh: session not found — list recoverable sessions with `dsh tui` or `/session list`, then retry with --session <id>'
      : 'dsh: resume failed — the session log stays intact; retry, or drop --session to start fresh'
    io.stderr.write(`dsh: ${message}\n${hint}\n`)
    io.exit(1)
  })
}
