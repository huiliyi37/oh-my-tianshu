/**
 * The web-app bundle's shipped substance is its patch file: the
 * `dsh.bundle.patch` manifest field must name a real, parseable patch list,
 * and the host-side `/remember` `/memory` roster must stay mounted.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@huiliyi37/cordis-plugin-include'

describe('dsh-web-app bundle', () => {
  it('declares a parseable patch list mounting memory and command-memory', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as Array<{ insert?: { id?: string }[] }>)
      .flatMap(patch => patch.insert ?? [])
    const ids = rows.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining(['memory', 'command-memory']))
    expect(ids.indexOf('memory')).toBeLessThan(ids.indexOf('command-memory'))
    // The shared base bundle owns this row; the Web layer must not duplicate it.
    expect(ids).not.toContain('next-workflow')
  })
})
