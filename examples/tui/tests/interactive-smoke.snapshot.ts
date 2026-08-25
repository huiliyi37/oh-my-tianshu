/**
 * Keyless interactive TUI acceptance smoke (P0): boots the fixture composition
 * (`tests/fixtures/interactive-smoke.cordis.yml` — the examples/tui spine plus
 * the confining bash stack and the approval seam) through the real Loader
 * inside a 100×40 PTY, with the loopback mock LLM standing in for the model.
 *
 * One scenario drives the full interactive spine: settled welcome → a user
 * message whose mocked reply carries a bash sandbox escalation → the approval
 * card → `y` settle → the tool result → the mocked assistant reply →
 * `/rewind` (list → granularity → done) → `/theme` switch → clean Ctrl+Q
 * exit. A second scenario exits with Ctrl+Q while the approval card is still
 * pending — the teardown path that used to leak pending state — and requires
 * a clean exit there too.
 *
 * Every marker waits on the parsed terminal buffer, never on raw bytes, so
 * ANSI framing or redraw order cannot fake a pass.
 *
 * @module examples/tui/tests/interactive-smoke.snapshot
 */

import { fileURLToPath } from 'node:url'
import { startMockLlmServer, type MockLlmBehavior } from '@huiliyi37/dsh-llm-mock-server'
import { resolveExampleLaunch, resolveExampleMode } from '@huiliyi37/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'
import {
  formatPtyFailure,
  startPtySession,
  type PtySession,
} from './helpers/pty-harness.ts'

const driverPath = fileURLToPath(new URL('./fixtures/interactive-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/interactive-smoke.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

const FAKE_API_KEY = 'interactive-smoke-placeholder-not-a-secret'
const SMOKE_MESSAGE = 'please run the escalation probe'
const SMOKE_TOOL_COMMAND = 'echo TUI_SMOKE_ESCALATION_OK'
const SMOKE_ASSISTANT_REPLY = 'smoke turn complete'
const ESCALATION_JUSTIFICATION = 'P0 interactive smoke: verify the approval card settle path'

/** Settled-welcome markers (the append-only band the welcome snapshot also pins). */
const WELCOME_MARKERS = ['Tip:', '< Harness >', '❯'] as const
/** Approval card markers: rail title, prompt, and the key-hint row. */
const APPROVAL_MARKERS = ['审批 · bash', '允许执行 bash', '[y] 允许'] as const
/** Rewind overlay markers per stage. */
const REWIND_LIST_MARKERS = ['⟲ rewind 回退', '选检查点'] as const
const REWIND_MODE_MARKERS = ['选择粒度'] as const
const REWIND_DONE_MARKERS = ['回退完成', '会话截断到 seq'] as const
/** /permissions bare list marker (approval-rules echo, scenario 3). */
const PERMISSIONS_RULE_MARKER = 'bash' as const

/** Theme switch echo marker. */
const THEME_SWITCH_MARKER = '主题已切换: '
/** Theme picker markers: overlay title + key-hint row (never the slash-suggest menu). */
const THEME_PICKER_MARKERS = ['选择主题', 'Enter 确认'] as const

interface SmokeModel {
  readonly sequence: readonly MockLlmBehavior[]
}

/**
 * Boot one smoke scenario: mock LLM on loopback, PTY child on the fixture
 * composition. Returns the session; the caller drives and stops it.
 *
 * @param model - the mock behavior script for this scenario.
 * @returns the live PTY session with the mock server attached for teardown.
 */
async function bootSmoke(model: SmokeModel): Promise<PtySession> {
  const mock = await startMockLlmServer({
    sequence: model.sequence,
    successText: SMOKE_ASSISTANT_REPLY,
    toolName: 'bash',
    toolArguments: JSON.stringify({
      command: SMOKE_TOOL_COMMAND,
      description: 'P0 interactive smoke escalation probe',
      sandbox_permissions: 'danger-full-access',
      justification: ESCALATION_JUSTIFICATION,
    }),
  })
  const session = await startPtySession({
    driverPath,
    configPath,
    tsconfigPath,
    launch: resolveExampleLaunch({
      srcBin: driverPath,
      libBin: driverPath,
      configArgs: [configPath],
      mode: resolveExampleMode(),
      tsconfigPath,
      env: {
        DEEPSEEK_API_KEY: FAKE_API_KEY,
        DEEPSEEK_BASE_URL: mock.baseURL,
      },
    }),
  })
  const originalStop = session.stop.bind(session)
  return {
    ...session,
    stop: async () => {
      try {
        await originalStop()
      } finally {
        await mock.close()
      }
    },
  }
}

/** Type the message and submit it with Enter. */
function submitMessage(session: PtySession, message: string): void {
  session.send(message)
  session.send('\r')
}

describe.skipIf(process.platform === 'win32')('examples/tui interactive smoke', () => {
  it('drives welcome → approval settle → tool result → rewind → theme through a 100×40 PTY', async () => {
    const session = await bootSmoke({
      sequence: ['tool_call_success', 'success'],
    })
    try {
      // 1. Settled welcome card on the normal buffer.
      await session.waitForMarkers(WELCOME_MARKERS, 'settled welcome')

      // 2. User message → mocked tool call → approval card raises in the live band.
      submitMessage(session, SMOKE_MESSAGE)
      await session.waitForMarkers(APPROVAL_MARKERS, 'approval card')
      expect(session.activeBufferType()).toBe('normal')

      // 3. Settle with `y` (allowed-once): the command runs and its output lands
      //    in the transcript; the mocked follow-up reply ends the turn.
      session.send('y')
      await session.waitForMarkers([SMOKE_TOOL_COMMAND, 'TUI_SMOKE_ESCALATION_OK'], 'approved bash result')
      await session.waitForMarkers([SMOKE_ASSISTANT_REPLY], 'assistant reply')
      // The card must be gone once settled.
      await session.waitForMarkerGone('允许执行 bash', 'approval card teardown')

      // 4. /rewind: list stage → granularity stage → convo rewind → done stage.
      submitMessage(session, '/rewind')
      await session.waitForMarkers(REWIND_LIST_MARKERS, 'rewind list')
      expect(session.activeBufferType()).toBe('alternate')
      session.send('\r')
      await session.waitForMarkers(REWIND_MODE_MARKERS, 'rewind granularity')
      session.send('1')
      await session.waitForMarkers(REWIND_DONE_MARKERS, 'rewind done')
      session.send('x')
      await session.waitForMarkerGone('⟲ rewind 回退', 'rewind overlay close')
      expect(session.activeBufferType()).toBe('normal')

      // 5. /theme: picker opens, one step down, confirm lands the echo line.
      submitMessage(session, '/theme')
      await session.waitForMarkers(THEME_PICKER_MARKERS, 'theme picker')
      expect(session.activeBufferType()).toBe('alternate')
      session.send('j')
      session.send('\r')
      await session.waitForMarkerGone('选择主题', 'theme picker close')
      expect(session.activeBufferType()).toBe('normal')
      await session.waitForMarkers([THEME_SWITCH_MARKER], 'theme switch echo')

      // 6. Clean Ctrl+Q exit — the crash-regression assertion for the whole flow.
      session.send('\x11')
      const exit = await session.waitForExit(10_000)
      expect(exit.exitCode).toBe(0)
      expect(exit.signal ?? 0).toBe(0)
      expect(session.rawOutput()).not.toContain(FAKE_API_KEY)
    } catch (error: unknown) {
      throw formatPtyFailure(error, session.rawOutput(), session.exit())
    } finally {
      await session.stop()
    }
  }, 180_000)

  it('exits cleanly with Ctrl+Q while an approval card is pending', async () => {
    const session = await bootSmoke({
      sequence: ['tool_call_success'],
    })
    try {
      await session.waitForMarkers(WELCOME_MARKERS, 'settled welcome')
      submitMessage(session, SMOKE_MESSAGE)
      await session.waitForMarkers(APPROVAL_MARKERS, 'approval card')

      // Ctrl+Q while the card is pending: teardown must settle the approval as
      // cancelled, abort the open turn, and still exit zero.
      session.send('\x11')
      const exit = await session.waitForExit(15_000)
      expect(exit.exitCode).toBe(0)
      expect(exit.signal ?? 0).toBe(0)
      expect(session.rawOutput()).not.toContain(FAKE_API_KEY)
    } catch (error: unknown) {
      throw formatPtyFailure(error, session.rawOutput(), session.exit())
    } finally {
      await session.stop()
    }
  }, 120_000)

  it('settling with p persists an exact-match rule; the identical next call skips the card', async () => {
    const session = await bootSmoke({
      sequence: ['tool_call_success', 'success', 'tool_call_success', 'success'],
    })
    try {
      await session.waitForMarkers(WELCOME_MARKERS, 'settled welcome')

      // Turn 1: the card appears; `p` persists the exact-match rule and
      // settles with the standing grant — the tool runs to completion.
      submitMessage(session, SMOKE_MESSAGE)
      await session.waitForMarkers(APPROVAL_MARKERS, 'approval card')
      session.send('p')
      await session.waitForMarkers([SMOKE_TOOL_COMMAND, 'TUI_SMOKE_ESCALATION_OK'], 'persisted-allow tool result')
      await session.waitForMarkers([SMOKE_ASSISTANT_REPLY], 'assistant reply')

      // The persisted rule is visible through /permissions (project layer).
      submitMessage(session, '/permissions')
      await session.waitForMarkers([PERMISSIONS_RULE_MARKER], 'permissions listing')

      // Turn 2: the identical call must be settled by the rule answerer before
      // the TUI card. Poll until the SECOND assistant reply lands (the first
      // already sits in scrollback); if the card reappears instead, the rule
      // failed to capture the request and the turn would stall on a keypress.
      submitMessage(session, SMOKE_MESSAGE)
      let sawCardAgain = false
      const settleDeadline = Date.now() + 30_000
      while (Date.now() < settleDeadline) {
        const screen = session.activeLines().join('\n')
        if (screen.includes('允许执行 bash')) {
          sawCardAgain = true
          break
        }
        if (screen.split(SMOKE_ASSISTANT_REPLY).length >= 3) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      expect(sawCardAgain).toBe(false)
      await session.waitForMarkers(['TUI_SMOKE_ESCALATION_OK'], 'rule-settled tool result')

      // Clean exit after the rule-driven flow.
      session.send('\x11')
      const exit = await session.waitForExit(10_000)
      expect(exit.exitCode).toBe(0)
      expect(exit.signal ?? 0).toBe(0)
    } catch (error: unknown) {
      throw formatPtyFailure(error, session.rawOutput(), session.exit())
    } finally {
      await session.stop()
    }
  }, 180_000)
})
