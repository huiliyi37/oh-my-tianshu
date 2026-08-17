/**
 * tool-meridian 单测。
 *
 * mock ctx：tools.register 捕获 defineTool 定义、systemPrompt.context 捕获
 * 摘要注册。行为契约：repo_graph 三模式（graph/impact/flow）、首次执行触发
 * on-demand backfill、索引为空提示、root 缺失 fail loud、摘要走动态区
 * （context 而非 section）。
 *
 * @module @huiliyi37/dsh-tool-meridian/tests/tool
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@huiliyi37/cordis'
import { apply } from '../src/index.ts'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>
}

function resolvedConfig(root: string): Record<string, unknown> {
  return { root, backfillOnDemand: true, backfillMaxFiles: 500, backfillOnStart: false }
}

function makeCtx(): {
  ctx: Context
  tools: CapturedTool[]
  contexts: Array<{ name: string; order: number; text: unknown }>
} {
  const tools: CapturedTool[] = []
  const contexts: Array<{ name: string; order: number; text: unknown }> = []
  const ctx = {
    tools: {
      register: vi.fn((tool: CapturedTool) => { tools.push(tool) }),
    },
    systemPrompt: {
      context: vi.fn((section: { name: string; order: number; text: unknown }) => {
        contexts.push(section)
      }),
    },
  } as unknown as Context
  return { ctx, tools, contexts }
}

async function runTool(
  tools: CapturedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<{ mode: string; content: string }> {
  const tool = tools.find(t => t.name === name)
  if (tool === undefined) throw new Error(`tool not registered: ${name}`)
  return tool.execute(args, { signal: new AbortController().signal }) as Promise<{ mode: string; content: string }>
}

describe('tool-meridian', () => {
  let root: string

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tool-meridian-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('注册 repo_graph 工具 + 动态 context 摘要（非 section）', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function alpha() { return 1 }', 'utf-8')
    const { ctx, tools, contexts } = makeCtx()
    apply(ctx, resolvedConfig(root))
    expect(tools.map(t => t.name)).toEqual(['repo_graph'])
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.name).toBe('meridian:index')
    expect(contexts[0]?.order).toBe(120)
    expect(typeof contexts[0]?.text).toBe('function')
  })

  it('同目录天枢 meridian.db schema 2 时动态 context 不抛', () => {
    mkdirSync(join(root, '.rivet'), { recursive: true })
    const tianshu = new DatabaseSync(join(root, '.rivet', 'meridian.db'))
    tianshu.exec('PRAGMA user_version = 2')
    tianshu.close()
    const { ctx, contexts } = makeCtx()
    apply(ctx, resolvedConfig(root))
    const text = contexts[0]?.text
    expect(typeof text).toBe('function')
    expect(() => (text as () => string)()).not.toThrow()
  })

  it('root 缺失 fails loud', () => {
    const { ctx } = makeCtx()
    expect(() => {
      apply(ctx, { root: join(root, 'missing'), backfillOnDemand: true, backfillMaxFiles: 500, backfillOnStart: false })
    }).toThrow(/does not exist/)
  })

  it('graph 模式：首次执行触发 backfill 后返回相关文件排名', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'b.ts'), 'export function helper() { return 1 }', 'utf-8')
    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b'\nexport function run() { return helper() }", 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))

    // 首次调用触发 on-demand backfill（fire-and-forget）——轮询直到符号索引就绪
    await vi.waitFor(async () => {
      const res = await runTool(tools, 'repo_graph', { from_file: 'src/a.ts' })
      expect(res.content).toContain('run')
    }, { timeout: 10_000, interval: 200 })

    const res = await runTool(tools, 'repo_graph', { from_file: 'src/a.ts' })
    expect(res.mode).toBe('graph')
    expect(res.content).toContain('索引：')
    expect(res.content).toContain('run')
  })

  it('impact 模式：返回直接依赖方与应运行测试', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'foo.ts'), 'export function foo() { return 1 }', 'utf-8')
    writeFileSync(join(root, 'src', 'bar.ts'), "import { foo } from './foo'\nexport function bar() { return foo() }", 'utf-8')
    writeFileSync(join(root, 'src', 'foo.test.ts'), "import { foo } from './foo'\n", 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))

    await vi.waitFor(async () => {
      const res = await runTool(tools, 'repo_graph', { from_file: 'src/foo.ts', mode: 'impact' })
      expect(res.content).toContain('影响分析')
    }, { timeout: 10_000, interval: 200 })

    const res = await runTool(tools, 'repo_graph', { from_file: 'src/foo.ts', mode: 'impact' })
    expect(res.mode).toBe('impact')
    expect(res.content).toContain('src/bar.ts')
    expect(res.content).toContain('src/foo.test.ts')
  })

  it('flow 模式：symbol 必填校验 + 命中列表', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export function seed() {}\nexport function caller() { seed() }', 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))

    // 无 symbol → 校验提示
    const missing = await runTool(tools, 'repo_graph', { from_file: 'src/a.ts', mode: 'flow' })
    expect(missing.content).toContain('需要 symbol 参数')

    await vi.waitFor(async () => {
      const res = await runTool(tools, 'repo_graph', { from_file: 'src/a.ts', mode: 'flow', symbol: 'seed' })
      expect(res.content).toContain('数据流')
    }, { timeout: 10_000, interval: 200 })

    const res = await runTool(tools, 'repo_graph', { from_file: 'src/a.ts', mode: 'flow', symbol: 'seed' })
    expect(res.content).toContain('seed')
    expect(res.content).toContain('caller')
  })

  it('索引为空时输出空索引信号（seed 文件 1.0 分，stats 为 0）', async () => {
    writeFileSync(join(root, 'empty.txt'), 'not indexable', 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))
    const res = await runTool(tools, 'repo_graph', { from_file: 'nope.ts' })
    expect(res.content).toContain('索引：0 个文件，0 个符号')
  })

  it('无 root 配置时缺省为 deployment workdir（装配不抛）', () => {
    // 真实装配路径：cordis.patch.yml 仅登记 id/name 无 config →
    // schemastery Config({}) 解析后 root 为 undefined（无 schema 默认值）。
    // 回归：apply 必须显式缺省 process.cwd()，不得 resolve(undefined) 抛 TypeError
    // （曾致 loader include apply 失败 → 插件树回滚）。
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, { backfillOnDemand: true, backfillMaxFiles: 500, backfillOnStart: false }) }).not.toThrow()
  })
})
