/**
 * The tui bundle's shipped substance is its patch file: the `dsh.bundle.patch`
 * manifest field must name a real, parseable patch list, and the tianshu-side
 * capability roster must stay mounted (dropping a row silently un-ships the
 * capability while the TUI command surface keeps probing for it).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@huiliyi37/cordis-plugin-include'
import { BASH_OVERLAP_TOOLS } from '@huiliyi37/dsh-zen'

describe('dsh-tui bundle', () => {
  it('declares a parseable patch list mounting the runner and the tianshu-side roster', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as Array<{ insert?: { id?: string; config?: Record<string, unknown> }[] }>)
      .flatMap(patch => patch.insert ?? [])
    const ids = rows.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining([
      'tui-runner', 'spark-anchors', 'vision-bridge',
      'fs-snapshot', 'memory', 'tool-memory', 'tool-session-query', 'tool-memory-recall',
      'evidence-gate', 'zen', 'task-card', 'agent-router', 'agent-presets',
      'cache-diagnostic',
    ]))
    expect(ids).not.toContain('command-memory')
    // The intent-bridge row ships both routes on the out-of-box DeepSeek
    // adapter (same key as /model); resolveConfig fails loud at load without
    // them. MiniMax remains a deployment overlay, not the shipped default.
    const intentBridge = rows.find(row => row.id === 'intent-bridge')?.config
    expect(intentBridge).toMatchObject({
      alignProvider: 'deepseek-official',
      alignModel: 'deepseek-v4-flash',
      execProvider: 'deepseek-official',
      execModel: 'deepseek-v4-flash',
    })
    // agent-router 以 turn-end 影子决策重挂：shadow 只记录不派发（标准起步），
    // provider/model 缺省时 execute 本就短路——闭环验证后产品定夺切 auto。
    expect(rows.find(row => row.id === 'agent-router')?.config).toEqual({
      trigger: { mode: 'shadow', onTurnEnd: true },
    })
    // The shared base bundle owns this row; the TUI layer must not duplicate it.
    expect(ids).not.toContain('next-workflow')
    // The shipped read-only preset root is injected by composeProfile keyed on
    // this exact row id; the row itself carries only the default preset.
    expect(rows.find(row => row.id === 'agent-presets')?.config).toEqual({ default: 'standard' })
    // The zen row must ship its policy section (resolveConfig rejects a blank
    // one at load) and leave the face/predicates on package defaults.
    const zen = rows.find(row => row.id === 'zen')?.config
    expect(typeof zen?.section).toBe('string')
    expect((zen?.section as string).length).toBeGreaterThan(0)
    expect(zen?.face).toEqual(['bash', 'str_replace_editor', 'todo_write', 'subagent'])
    expect(zen?.promoteDeny).toEqual([...BASH_OVERLAP_TOOLS])
    expect(zen?.diet).toEqual({ maxDescriptionChars: 80 })
    expect(Object.keys(zen ?? {}).sort()).toEqual(['diet', 'face', 'promoteDeny', 'section'])
    // The task-card row ships template mode: the bundle has no provider
    // default, so llm mode would fail loud at load; deployments opt in.
    const taskCard = rows.find(row => row.id === 'task-card')?.config
    expect(taskCard).toEqual({ mode: 'template' })
  })
})
