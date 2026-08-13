/**
 * tool-memory 单测（P4 Wave 3）。
 *
 * mock ctx：tools.register 捕获 defineTool 定义（取 execute/present 行为验证）、
 * systemPrompt.section 捕获注册、reflect.get('memory') 注入假 memory 服务。
 * 行为契约：memory_save 调 save（scope 校验/来源 agent）、memory_search 调
 * search（limit 透传）、服务缺失 fail loud、system prompt section 注册。
 *
 * @module @deepseek-ai/dsh-tool-memory/tests/tool-memory
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import { apply } from '../src/index.js'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>
  present: (value: unknown) => Array<{ type: 'text'; text: string }>
}

function makeCtx(opts: {
  memory?: {
    save?: ReturnType<typeof vi.fn>
    search?: ReturnType<typeof vi.fn>
    list?: ReturnType<typeof vi.fn>
  }
} = {}): {
  ctx: Context
  tools: CapturedTool[]
  sections: Array<{ name: string; order: number; text: unknown }>
} {
  const tools: CapturedTool[] = []
  const sections: Array<{ name: string; order: number; text: unknown }> = []
  const memory = opts.memory
  const ctx = {
    tools: {
      register: vi.fn((tool: CapturedTool) => { tools.push(tool) }),
    },
    systemPrompt: {
      section: vi.fn((section: { name: string; order: number; text: unknown }) => {
        sections.push(section)
      }),
    },
    reflect: {
      get: vi.fn((key: string) => key === 'memory' ? memory : undefined),
    },
  } as unknown as Context
  return { ctx, tools, sections }
}

/** 执行捕获的工具（按名）。 */
async function runTool(
  tools: CapturedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.find(t => t.name === name)
  if (tool === undefined) throw new Error(`tool not registered: ${name}`)
  return tool.execute(args, { signal: new AbortController().signal })
}

describe('tool-memory', () => {
  it('注册 memory_save / memory_search 工具 + system prompt section', () => {
    const { ctx, tools, sections } = makeCtx({ memory: { save: vi.fn(), search: vi.fn() } })
    apply(ctx)
    expect(tools.map(t => t.name).sort()).toEqual(['memory_save', 'memory_search'])
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('tool:memory')
    expect(sections[0]?.order).toBe(130)
    expect(typeof sections[0]?.text).toBe('function')
  })

  it('memory_save：调 save（来源 agent、scope 缺省 global、tags 透传）', async () => {
    const save = vi.fn(async (entry: unknown) => ({ id: 'm1', text: (entry as { text: string }).text }))
    const { ctx, tools } = makeCtx({ memory: { save, search: vi.fn() } })
    apply(ctx)
    const result = await runTool(tools, 'memory_save', {
      text: '项目使用 pnpm workspace',
      tags: ['tooling'],
    })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      text: '项目使用 pnpm workspace',
      scope: 'global',
      tags: ['tooling'],
      source: 'agent',
    }))
    expect(result).toEqual({ id: 'm1', text: '项目使用 pnpm workspace' })
  })

  it('memory_save：非法 scope 抛错（fail loud，模型友好信息）', async () => {
    const { ctx, tools } = makeCtx({ memory: { save: vi.fn(), search: vi.fn() } })
    apply(ctx)
    await expect(runTool(tools, 'memory_save', { text: 'x', scope: 'bogus' })).rejects.toThrow('invalid scope')
  })

  it('memory_search：调 search（query + limit 透传）并返回条目', async () => {
    const search = vi.fn(async () => [
      { id: 'm1', text: 'pnpm workspace', tags: ['tooling'], createdAt: 1 },
    ])
    const { ctx, tools } = makeCtx({ memory: { save: vi.fn(), search } })
    apply(ctx)
    const result = await runTool(tools, 'memory_search', { query: 'pnpm', limit: 5 })
    expect(search).toHaveBeenCalledWith('pnpm', { limit: 5 })
    expect(result).toEqual({
      entries: [{ id: 'm1', text: 'pnpm workspace', tags: ['tooling'], createdAt: 1 }],
    })
  })

  it('memory 服务缺失：工具执行 fail loud', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(runTool(tools, 'memory_save', { text: 'x' })).rejects.toThrow('memory 服务不可用')
    await expect(runTool(tools, 'memory_search', { query: 'x' })).rejects.toThrow('memory 服务不可用')
  })

  it('system prompt section：text 函数含静态指引与记忆摘要', async () => {
    const list = vi.fn(async () => [{ id: 'm1', text: '摘要行', tags: [], createdAt: 1 }])
    const { ctx, sections } = makeCtx({ memory: { save: vi.fn(), search: vi.fn(), list } })
    apply(ctx)
    const text = (sections[0]?.text as () => string)()
    expect(text).toContain('memory_search')
    expect(text).toContain('memory_save')
    // 摘要异步刷新后（等待 microtask）应含记忆首行
    await vi.waitFor(() => {
      expect((sections[0]?.text as () => string)()).toContain('摘要行')
    })
  })

  it('摘要缓存刷新：save 后 text 函数含新记忆', async () => {
    const saved: Array<{ text: string }> = []
    const save = vi.fn(async (entry: { text: string }) => {
      saved.push(entry)
      return { id: 'm-new', text: entry.text }
    })
    const list = vi.fn(async () => saved.map((s, i) => ({ id: `m${i}`, text: s.text, tags: [], createdAt: i })))
    const { ctx, tools, sections } = makeCtx({ memory: { save, search: vi.fn(), list } })
    apply(ctx)
    await runTool(tools, 'memory_save', { text: '新决策' })
    await vi.waitFor(() => {
      expect((sections[0]?.text as () => string)()).toContain('新决策')
    })
  })
})
