// Web e2e scenario: the produced-files row a finished turn ends with. Cold-seeds
// a recorded write turn (zero model calls). Package tests cover the derivation
// in isolation, but only the assembled application shows that a turn's writes
// reach the transcript as an openable row (docs/testing.md snapshot rule). The
// click itself is not driven here: it hands the path to the Host's opener,
// which would launch a real application on the machine running the suite.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

// Borrowed read-only: this scenario needs any settled turn whose tools WROTE a
// file, not a new recording (the message-actions borrowing pattern).
const SEED = fileURLToPath(new URL('./snapshots/permission-policy-context/session.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'produced-files-web-e2e'

/** The file the borrowed recording's write tool produces. */
const PRODUCED = 'policy-neutral.txt'

describe('web e2e: a finished turn ends with the files it produced', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The seeded Session's cwd is the scaffold workspace; the recording's own
    // nested directory is created too, so its paths stay resolvable.
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await writeFile(join(scaffold.workspaceCwd, PRODUCED), 'neutral\n')
    const raw = await readFile(SEED, 'utf8')
    expect(raw, 'borrowed recording must carry the write this scenario reads').toContain(PRODUCED)
    await seedSession(scaffold, raw, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('lists the written file under the closing message, as an opener', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-produced-files'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // The row the turn ends with — derived from the write call's locations,
    // not from whatever the closing message happened to say.
    const chip = page.getByRole('button', { name: `Open ${PRODUCED}`, exact: true }).first()
    await chip.waitFor({ timeout: 15_000 })
    expect(await chip.innerText()).toBe(PRODUCED)
    // The full path stays reachable for a reader who wants to copy it.
    expect(await chip.getAttribute('title')).toContain(PRODUCED)
    // A turn's produced files are labelled, not left as bare chips.
    expect(await page.getByText('Produced', { exact: true }).count()).toBeGreaterThan(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
