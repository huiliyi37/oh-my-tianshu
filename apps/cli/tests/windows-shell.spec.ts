/**
 * The `minimal` preset's persistent shell stack gates itself by platform with
 * `disabled: !!js` interpolation, so exactly one persistent shell mounts per
 * host: the bash rows on POSIX, the pwsh twin (pty-local with shellDialect
 * pwsh + the persistent pwsh tool) on win32. The spec parses the shipped
 * preset and evaluates each row's gate against a platform-scoped `process`,
 * pinning both outcomes on any host. The one-shot shell tools are out of
 * scope: standard/code/cordis mount `tool-bash`/`tool-pwsh` unconditionally by
 * design (platform absence is the executors' concern).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { entryListSchema } from '@huiliyi37/cordis-plugin-include'
import { evaluate } from '@huiliyi37/cordis-plugin-loader'

/**
 * The effective disabled state of one row on one platform: a `!!js` expression
 * evaluates with a platform-scoped `process` so both outcomes pin on any host.
 */
function disabledOn(row: { disabled?: unknown }, platform: 'win32' | 'linux'): boolean {
  const value = row.disabled
  if (value !== null && typeof value === 'object' && '__jsExpr' in value) {
    return Boolean(evaluate({ process: { platform } }, (value as { __jsExpr: string }).__jsExpr))
  }
  return value === true
}

describe('minimal preset gates its persistent shell stack by platform', () => {
  const presetRoot = resolve(fileURLToPath(new URL('../package.json', import.meta.url)), '..', 'config', 'agent-presets')

  it('minimal mounts no one-shot shell tool row and gates its persistent shell stack by platform', () => {
    const entries: unknown = yaml.load(
      readFileSync(resolve(presetRoot, 'minimal', 'agent.cordis.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(entries)) throw new TypeError('minimal preset must parse to an entry array')
    for (const id of ['tool-bash', 'tool-pwsh']) {
      expect(entries.some(entry => (
        typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === id
      )), `${id} must be absent from minimal`).toBe(false)
    }
    const group = entries.find((entry): entry is Record<string, unknown> => (
      typeof entry === 'object' && entry !== null && (entry as Record<string, unknown>).id === 'persistent-shell'
    ))
    if (group === undefined) throw new TypeError('minimal preset must mount persistent-shell')
    const rows = group.config as unknown[]
    if (!Array.isArray(rows)) throw new TypeError('persistent-shell must carry a row list')
    const byId = new Map(rows
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map(entry => [entry.id, entry]))
    // The bash stack (terminal-bash + persistent-bash) mounts on POSIX only; the
    // pwsh twin (terminal-bash with shellDialect pwsh + persistent-pwsh) mounts on
    // win32 only — exactly one persistent shell per host.
    for (const id of ['terminal-bash', 'persistent-bash']) {
      expect(disabledOn(byId.get(id)!, 'win32'), `${id} on win32`).toBe(true)
      expect(disabledOn(byId.get(id)!, 'linux'), `${id} on linux`).toBe(false)
    }
    for (const id of ['terminal-pwsh', 'persistent-pwsh']) {
      expect(disabledOn(byId.get(id)!, 'win32'), `${id} on win32`).toBe(false)
      expect(disabledOn(byId.get(id)!, 'linux'), `${id} on linux`).toBe(true)
    }
    expect(byId.get('terminal-pwsh')?.config).toMatchObject({ shellDialect: 'pwsh' })
    // The launcher's cold-start module fallback links the apps/cli dependency
    // closure, so every bare plugin name in the preset must resolve from there.
    const cliManifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { dependencies?: Record<string, string> }
    expect(cliManifest.dependencies?.['@huiliyi37/dsh-tool-pwsh-persistent'],
      'cold-start closure must reach @huiliyi37/dsh-tool-pwsh-persistent').toBeDefined()
  })
})
