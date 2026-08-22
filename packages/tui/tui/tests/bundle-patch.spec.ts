/**
 * The tui bundle's shipped substance is its patch file: the `dsh.bundle.patch`
 * manifest field must name a real, parseable patch list, and the tianshu-side
 * capability roster must stay mounted (dropping a row silently un-ships the
 * capability while the TUI command surface keeps probing for it).
 *
 * The disable patches carry a second obligation. `applyEntryPatches` only warns
 * and skips when an id misses, so a base rename would silently re-mount a row
 * the TUI deliberately dropped; the base-side pairing is asserted here to make
 * that rename fail in CI instead of on a user's token bill.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@huiliyi37/cordis-plugin-include'
import { BASH_OVERLAP_TOOLS } from '@huiliyi37/dsh-zen'

/** One row of a patch list, narrowed to the fields these assertions read. */
interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

/** One top-level patch: either an insert block or an id-keyed override. */
type Patch = PatchRow & { insert?: PatchRow[] }

/**
 * Parse a patch list from disk under the loader's own YAML schema.
 * @param path - absolute path to a `cordis.patch.yml`.
 * @returns the parsed top-level patch list.
 */
function loadPatch(path: string): Patch[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as Patch[]
}

const tuiRoot = fileURLToPath(new URL('..', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../bundle/base/cordis.patch.yml', import.meta.url))

/** Base rows the TUI drops, paired with the package each id must still name. */
const DISABLED_BASE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['tool-run-tests', '@huiliyi37/dsh-tool-run-tests'],
  ['tool-workflow', '@huiliyi37/dsh-tool-workflow'],
  ['tool-ralph', '@huiliyi37/dsh-tool-ralph'],
  ['tool-subagent-fork', '@huiliyi37/dsh-tool-subagent'],
  ['tool-meridian', '@huiliyi37/dsh-tool-meridian'],
  ['tool-skill', '@huiliyi37/dsh-tool-skill'],
]

/** TUI-owned tool rows kept in the patch for documentation but not mounted. */
const DISABLED_TUI_ROWS = ['tool-memory', 'tool-session-query', 'tool-memory-recall']

describe('dsh-tui bundle', () => {
  it('declares a parseable patch list mounting the runner and the tianshu-side roster', () => {
    const manifest = JSON.parse(readFileSync(resolve(tuiRoot, 'package.json'), 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const rows = loadPatch(resolve(tuiRoot, manifest.dsh!.bundle!.patch!)).flatMap(patch => patch.insert ?? [])
    const ids = rows.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining([
      'tui-runner', 'spark-anchors', 'vision-bridge',
      'fs-snapshot', 'memory', 'tool-memory', 'tool-session-query', 'tool-memory-recall',
      'evidence-gate', 'zen', 'task-card', 'agent-router', 'agent-presets',
    ]))
    expect(ids).not.toContain('command-memory')
    // 直连进禅：intent-bridge 行注释保留在 patch 里、默认不挂载——triage 负责
    // 短消息跳过，/fast 是用户显式跳过；重新启用 = 取消注释该行。
    expect(ids).not.toContain('intent-bridge')
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
    // The task-card row ships template mode: the bundle has no provider
    // default, so llm mode would fail loud at load; deployments opt in.
    expect(rows.find(row => row.id === 'task-card')?.config).toEqual({ mode: 'template' })
  })

  it('anchors zen on a minimal probe face whose tools the prompt already prefers', () => {
    const rows = loadPatch(resolve(tuiRoot, 'cordis.patch.yml')).flatMap(patch => patch.insert ?? [])
    const zen = rows.find(row => row.id === 'zen')?.config
    // resolveConfig rejects a blank section at load.
    expect(typeof zen?.section).toBe('string')
    expect((zen?.section as string).length).toBeGreaterThan(0)
    // 极简两件：read 是 tool:read 段落点名的读文件工具，bash 覆盖其余一切只读
    // 查证；两者都不写盘——「锚定前不修改」由工具面保证，而非靠模型自觉。
    expect(zen?.face).toEqual(['bash', 'read'])
    // promoteDeny 是「与 bash 抢意图的栈」减去已在 face 上的，再加两个零调用项；
    // 派生写法让来源可读，也让 BASH_OVERLAP_TOOLS 的改动在这里显形。
    const face = zen?.face as string[]
    expect(zen?.promoteDeny).toEqual(
      [...BASH_OVERLAP_TOOLS.filter(name => !face.includes(name)), 'interrupt_agent', 'semantic_search'].sort(),
    )
    // resolveConfig fails at load when the two lists overlap; keep them disjoint
    // here so the failure surfaces as a diff rather than a boot crash.
    expect((zen?.promoteDeny as string[]).filter(name => face.includes(name))).toEqual([])
    expect(zen?.diet).toEqual({ maxDescriptionChars: 80 })
    expect(Object.keys(zen ?? {}).sort()).toEqual(['diet', 'face', 'promoteDeny', 'section'])
  })

  it('drops the unused tool rows and keeps every disable pointed at a live base id', () => {
    const patches = loadPatch(resolve(tuiRoot, 'cordis.patch.yml'))
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    // TUI 自有行：留在 patch 里当文档，删掉 disabled 即恢复。
    for (const id of DISABLED_TUI_ROWS) {
      expect(inserted.find(row => row.id === id)?.disabled).toBe(true)
    }
    // memory 服务本身仍挂载：/remember 与 /memory 斜杠命令不受工具行停用影响。
    expect(inserted.find(row => row.id === 'memory')?.disabled).toBeUndefined()

    const overrides = patches.filter(patch => patch.insert === undefined)
    const baseRows = loadPatch(basePatchPath).flatMap(patch => patch.insert ?? [])
    for (const [id, name] of DISABLED_BASE_ROWS) {
      expect(overrides.find(patch => patch.id === id)).toEqual({ id, name, disabled: true })
      // The rename guard: a miss on either side degrades to a loader warning,
      // so the base row must still exist under exactly this id and name.
      expect(baseRows.find(row => row.id === id)?.name).toBe(name)
    }
    // Every override this patch carries is one of the audited disables.
    expect(overrides.map(patch => patch.id).sort())
      .toEqual(DISABLED_BASE_ROWS.map(([id]) => id).sort())
  })
})
