/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@huiliyi37/cordis-plugin-include'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as Array<{ insert?: { id?: string }[] }>).flatMap(patch => patch.insert ?? [])
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.some(row => row.id === 'command-memory')).toBe(false)
    expect(rows.some(row => row.id === 'next-workflow')).toBe(false)
  })

  it('caps un-roled subagent children at the official-minimal ∪ explore allow list', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    const rows = (parsed as Array<{ insert?: Array<{ id?: string; config?: { toolFilter?: { allow?: string[] } } }> }>)
      .flatMap(patch => patch.insert ?? [])
    const allow = ['bash', 'str_replace_editor', 'todo_write', 'grep', 'read', 'glob', 'semantic_search']
    expect(rows.find(row => row.id === 'tool-subagent')?.config?.toolFilter?.allow).toEqual(allow)
    expect(rows.find(row => row.id === 'tool-subagent-fork')?.config?.toolFilter?.allow).toEqual(allow)
  })
})
