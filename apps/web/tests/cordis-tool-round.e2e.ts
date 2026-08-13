// Web e2e scenario for the opt-in Cordis tools. Record mode drives a real
// model through inspect, mount, and unmount; replay pins the same shipped Web
// composition, durable calls, generic rows, highlighted Plugin source, and
// conversation accessibility tree.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/cordis-tool-round/session.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/cordis-tool-round/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const CORDIS_TOOLS = ['cordis_inspect', 'cordis_mount', 'cordis_unmount'] as const
const MOUNT_CODE = 'return { name: "snapshot-noop", apply(ctx) {} }'
const PROMPT = 'Use only Cordis tools. First call cordis_inspect with what "temporary". '
  + `Then call cordis_mount with this exact code: ${JSON.stringify(MOUNT_CODE)}. `
  + 'Read its returned id and call cordis_unmount with that exact id. '
  + 'After all three calls succeed, reply exactly CORDIS_UI_DONE and stop.'

function assertCompleteCordisLifecycle(events: readonly SessionEvent[]): void {
  const turnEnd = events.findLast(
    (event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end',
  )
  const reason = turnEnd?.data.reason
  const reasonSummary = { kind: reason?.kind }
  expect(reasonSummary).toEqual({ kind: 'completed' })

  const calls = events.filter(
    (event): event is Extract<SessionEvent, { type: 'tool/call' }> => event.type === 'tool/call',
  )
  expect(calls.map(event => event.data.name)).toEqual(CORDIS_TOOLS)

  const callIds = new Set(calls.map(event => String(event.data.callId)))
  const results = events.filter(
    (event): event is Extract<SessionEvent, { type: 'tool/result' }> =>
      event.type === 'tool/result' && callIds.has(String(event.data.message.source.callId)),
  )
  expect(results).toHaveLength(CORDIS_TOOLS.length)
  expect(results.every(event => !event.data.message.content[0].isError)).toBe(true)
}

describe('web e2e: Cordis tools use the generic row variants', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      cordisTools: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded Cordis lifecycle to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-drive'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    if (MODE === 'record') {
      assertCompleteCordisLifecycle(sessionEvents)
      await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries one complete Cordis lifecycle', () => {
    assertCompleteCordisLifecycle(sessionEvents)
  })

  it.skipIf(MODE === 'record')('renders Cordis lifecycle titles over the generic row mechanics', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-rows'))
    await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)

    const inspectRow = page.locator('[data-tool="cordis_inspect"]').filter({ hasText: 'Inspect' }).first()
    await inspectRow.waitFor({ timeout: 10_000 })

    const mountRow = page.locator('[data-tool="cordis_mount"]').filter({ hasText: 'Mount temporary Plugin' }).first()
    await mountRow.waitFor({ timeout: 10_000 })
    // The whole summary row is the expand toggle (unified tool-row interaction).
    await mountRow.locator('[aria-expanded]').first().click()
    await expect.poll(() => mountRow.locator('pre.shiki').textContent(), { timeout: 10_000 })
      .toContain(MOUNT_CODE)

    const unmountRow = page.locator('[data-tool="cordis_unmount"]').filter({ hasText: 'Unmount temporary Plugin' }).first()
    await unmountRow.waitFor({ timeout: 10_000 })
    await expect.poll(() => unmountRow.textContent()).toContain('dyn-')
    await expect(unmountRow.getAttribute('data-state')).resolves.toBe('ok')
  })

  it.skipIf(MODE === 'record')('matches the conversation aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-aria'))
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors or reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
