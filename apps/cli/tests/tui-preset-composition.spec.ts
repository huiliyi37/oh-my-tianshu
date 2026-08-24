/**
 * tui-preset-composition.spec.ts — 出厂 TUI 组合的真实装载回归。
 *
 * 自 a56b89bc54 起每个出厂 agent 工厂在 setup 里挂载默认预设。该提交落地时
 * 出厂组合（dsh-base + dsh-tui roster）有两处欠账同时在首次挂载时爆出：公开
 * 基线迁移丢了 `cordis:group` 的 loader builtin（组行应用崩溃），且 base 的
 * agent 面行与 standard 预设逐行重复（skill 提供方名 "local" 二次注册）。
 *
 * 本套件以 launcher 同款路径组合真实 profile——`prepareProfile` 建立的
 * `$DSH_HOME/profiles` 几何与扁平模块回退、真实 bundle patch 层、shipped
 * preset root——只禁掉 TUI 渲染器与 HMR 两个进程副作用行，然后走出厂工厂
 * 同款 setup 挂载创建会话，钉住三层事实：挂载成功、目录无跨层重复、preset
 * 拥有的工具不再出现在全局层。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import type { PatchOptions } from '@huiliyi37/cordis-plugin-include'
import { boot, composeEntries, loadLayeredEnv } from '@huiliyi37/dsh-app-boot'
import { DSH_ENVIRONMENT_KEY } from '@huiliyi37/dsh-environment'
import { SessionId } from '@huiliyi37/dsh-session'
import type { Agent } from '@huiliyi37/dsh-agent'
import { prepareProfile, PROFILE_ROOT_FILENAME } from '../src/profile-boot.ts'

/** composeProfile 注入的 shipped 只读根（apps/cli/config/agent-presets）。 */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

let ctx: Context
let homeDir: string
const previousHome = process.env.DSH_HOME

/**
 * Compose the real tui profile: bundle layers in order, no user layers
 * (`userLayer: false` keeps a developer's local `cordis.patch.yml` out of the
 * result), then the two process-side-effect disables and the shipped roster
 * root, applied exactly as `composeProfile` applies its overlays.
 */
async function bootTuiProfile(): Promise<Context> {
  const profile = prepareProfile('tui', false)
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const patches: PatchOptions[] = [
    ...bundlePatches,
    // 进程副作用行：渲染器要 TTY，HMR 开文件监听。
    { id: 'tui-runner', disabled: true },
    { id: 'hmr', disabled: true },
    // 与 composeProfile 相同的 shipped-root 注入：行 id 为 agent-presets 时
    // 叠加只读根（本测试不给用户可写根留影响结果的余地）。
    { id: 'agent-presets', config: { default: 'standard', roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }] } },
  ]
  const rows = composeEntries([patches])
  expect(rows.some(row => row.id === 'tui-runner')).toBe(true)
  return await boot('tui-composition-test', join(profile.dir, PROFILE_ROOT_FILENAME), patches, (hostCtx) => {
    hostCtx.provide(DSH_ENVIRONMENT_KEY, loadLayeredEnv('dsh'))
  })
}

const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()

beforeAll(async () => {
  homeDir = mkdtempSync(join(tmpdir(), 'omts-tui-preset-'))
  process.env.DSH_HOME = homeDir
  try {
    ctx = await bootTuiProfile()
  } catch (error) {
    rmSync(homeDir, { recursive: true, force: true })
    throw error
  }
}, 180_000)

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await ctx.fiber.dispose()
  rmSync(homeDir, { recursive: true, force: true })
})

describe('the shipped TUI composition with default-preset mounting', () => {
  it('boots the roster with standard as the default', async () => {
    expect(ctx.agentPresets.defaultId).toBe('standard')
    const ids = (await ctx.agentPresets.list()).map(preset => preset.id).sort()
    expect(ids).toContain('standard')
    expect(ids).toContain('taiyi')
  })

  it('keeps the preset-owned tools out of the global layer', () => {
    // 预设拥有的面（base 的重复行已禁用）不得出现在无 agent 的全局层；
    // str_replace_editor 等 base 独有面照常全局可见。
    const global = toolNames(ctx)
    for (const name of ['bash', 'read', 'write', 'edit', 'grep', 'glob', 'todo_write',
      'web_search', 'skill', 'subagent', 'exit_plan_mode', 'create_goal', 'workflow']) {
      expect(global, `global layer must not carry preset-owned ${name}`).not.toContain(name)
    }
    expect(global).toContain('str_replace_editor')
    expect(global).toContain('git')
  })

  it('composes a session from the default preset through the factory mount path', async () => {
    // 与出厂工厂（TuiApp/intent-bridge/headless/scaffold）同款：setup 内挂载
    // 默认预设。挂载失败即本回归（PresetMountError）在此处先炸。
    const handle = await ctx.agents.create({
      sessionId: SessionId('tui-preset-standard'),
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx),
    })
    try {
      const names = toolNames(ctx, handle.agent)
      // 跨层重复是本 bug 的静默形态：同名工具在 preset 层与全局层各注册一次。
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
      expect(duplicates, 'no tool may be registered by two layers').toEqual([])
      // 新顶层会话先进禅相：精确断言锚定面。bash/subagent/todo_write 只存在于
      // standard 预设的 standing 层（base 重复行已禁用），它们出现即证明预设
      // 组装真正抵达了 agent 视图；str_replace_editor/zen_anchor 来自全局层。
      // 修复前该面是 ['str_replace_editor','zen_anchor']——preset 层不可达。
      expect(names).toEqual(['bash', 'str_replace_editor', 'subagent', 'todo_write', 'zen_anchor'])
    } finally {
      await handle.dispose()
    }
  })

  it('switches a blank session to taiyi while standard stays mounted — same-named providers coexist', async () => {
    // /preset taiyi 的路径：先有会话挂在 standard 上,再显式挂载 taiyi——两个
    // standing 组装并存,各自携带同名 skill-filesystem(dsh-skill-local)提供方。
    // 修复前第二个挂载即抛 "a skill provider named \"local\" is already registered"。
    const standardHandle = await ctx.agents.create({
      sessionId: SessionId('tui-preset-coexist-standard'),
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx),
    })
    const taiyiHandle = await ctx.agents.create({
      sessionId: SessionId('tui-preset-coexist-taiyi'),
      setup: async agentCtx => void await ctx.agentPresets.mount(agentCtx, 'taiyi'),
    })
    try {
      const taiyiNames = toolNames(ctx, taiyiHandle.agent)
      const duplicates = taiyiNames.filter((name, index) => taiyiNames.indexOf(name) !== index)
      expect(duplicates, 'no tool may be registered by two layers').toEqual([])
      // taiyi = standard 工具面 + persona,禅锚定面与 standard 相同。
      expect(taiyiNames).toEqual(['bash', 'str_replace_editor', 'subagent', 'todo_write', 'zen_anchor'])
      // standard 会话的面不受 taiyi 挂载影响。
      expect(toolNames(ctx, standardHandle.agent)).toEqual(['bash', 'str_replace_editor', 'subagent', 'todo_write', 'zen_anchor'])
    } finally {
      await taiyiHandle.dispose()
      await standardHandle.dispose()
    }
  })
})
