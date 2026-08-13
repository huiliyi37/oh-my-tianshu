// Regression drive for the unified hero composer (0729-0357-hero-unify):
// cold start with zero workspaces -> create a workspace -> type. Asserts the
// composer textarea is the SAME DOM node across the disabled->live flip (a
// remount drops the __heroMark marker property) — the session-maybe
// composer.bar contract.
//
// Prereqs: `pnpm run build`, then a fresh server against empty state:
//   rm -rf .storages && DSH_HOME=$(mktemp -d) node --experimental-transform-types \
//     --import ./scripts/tspath-loader.ts apps/cli/src/bin.ts web --port 44285 \
//     --workspace-root $(mktemp -d)
// Run: node scripts/hero-composer-dom-continuity.mjs
// (BASE_URL overrides the target; screenshots land in .artifacts/.)
import { createRequire } from 'node:module'

// playwright is a devDependency of apps/web only — resolve through its tree.
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:44285'
const SHOTS = new URL('../.artifacts/screenshots/0729-0357-hero-unify/', import.meta.url).pathname

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', msg => { if (msg.type() === 'error') console.log('[console.error]', msg.text()) })
page.on('pageerror', err => { console.log('[pageerror]', err.message) })

await page.goto(BASE)
await page.waitForSelector('textarea', { timeout: 20000 })
await page.screenshot({ path: SHOTS + '01-cold-start.png' })

const initial = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('textarea')]
  boxes.forEach((b, i) => { b.__heroMark = 'alive-' + i })
  return boxes.map(b => ({ disabled: b.disabled, placeholder: b.placeholder }))
})
console.log('cold-start textareas:', JSON.stringify(initial))

// Open the picker and create a workspace by name (typed-input flow). The name
// must be unique per registry; keystrokes go through pressSequentially so the
// dialog's React onChange enables the submit button.
await page.getByRole('button', { name: 'Choose workspace' }).click()
await page.getByText('Create a new workspace').click()
await page.screenshot({ path: SHOTS + '03-create-form.png' })
const nameBox = page.getByPlaceholder('Workspace name')
await nameBox.click()
const wsName = 'proj-' + Date.now().toString(36)
await nameBox.pressSequentially(wsName, { delay: 30 })
await page.locator('button:text-is("Create workspace")').click()

// Wait for the composer to go live (placeholder flips, textarea enabled).
await page.waitForFunction(() => {
  const box = document.querySelector('textarea')
  return box !== null && !box.disabled
}, { timeout: 20000 })
await page.screenshot({ path: SHOTS + '04-live.png' })

const after = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('textarea')]
  return boxes.map(b => ({
    mark: b.__heroMark ?? 'REMOUNTED',
    disabled: b.disabled,
    placeholder: b.placeholder,
  }))
})
console.log('post-pick textareas:', JSON.stringify(after))

// Type into the live composer.
await page.locator('textarea').first().fill('hello from acceptance run')
const typed = await page.evaluate(() => document.querySelector('textarea')?.value)
console.log('typed value:', JSON.stringify(typed))
await page.screenshot({ path: SHOTS + '05-typed.png' })

const survived = after.length === 1 && after[0].mark === 'alive-0'
console.log(survived
  ? 'DOM-CONTINUITY: PASS (same textarea node across cold-start -> live)'
  : 'DOM-CONTINUITY: FAIL ' + JSON.stringify(after))
await browser.close()
process.exit(survived && typed === 'hello from acceptance run' ? 0 : 1)
