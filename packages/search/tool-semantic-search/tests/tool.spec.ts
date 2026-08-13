/**
 * tool-semantic-search 单测。
 *
 * mock ctx：tools.register 捕获 defineTool 定义、systemPrompt.context 捕获
 * 摘要注册。行为契约：semantic_search 执行 stale→update→hybrid 检索闭环、
 * root 缺失 fail loud、摘要走动态区（context 而非 section）、摘要确定性
 * 且 ≤2000 字符。
 *
 * @module @huiliyi37/dsh-tool-semantic-search/tests/tool
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import { apply } from '../src/index.ts'
import { INDEX_SUMMARY_MAX_CHARS, renderIndexSummary } from '../src/summary.ts'
import { SemanticIndex } from '@huiliyi37/dsh-semantic-index'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>
  render: (value: unknown) => Array<{ type: 'text'; text: string }>
}

function resolvedConfig(root: string): Record<string, unknown> {
  return { root, maxFiles: 500, staleTtlMs: 30000, timeoutMs: 30000 }
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

describe('tool-semantic-search', () => {
  let root: string

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tool-semantic-search-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('注册 semantic_search 工具 + 动态 context 摘要（非 section）', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function alpha() { return 1 }', 'utf-8')
    const { ctx, tools, contexts } = makeCtx()
    apply(ctx, resolvedConfig(root))
    expect(tools.map(t => t.name)).toEqual(['semantic_search'])
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.name).toBe('semantic:index')
    expect(contexts[0]?.order).toBe(120)
    expect(typeof contexts[0]?.text).toBe('function')
  })

  it('semantic_search 返回相关文件的命中与 backend', async () => {
    writeFileSync(join(root, 'auth.ts'), 'export function requireAuth() { check token }', 'utf-8')
    writeFileSync(join(root, 'theme.ts'), 'export function applyTheme() { colors }', 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))
    const result = await runTool(tools, 'semantic_search', { query: 'requireAuth token' }) as {
      hits: Array<{ file: string; startLine: number; score: number }>
      backend: string
    }
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]?.file).toBe('auth.ts')
    expect(result.backend).toBe('bm25') // 无 embedding provider 时降级
  })

  it('无命中时返回空 hits', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function alpha() { return 1 }', 'utf-8')
    const { ctx, tools } = makeCtx()
    apply(ctx, resolvedConfig(root))
    const result = await runTool(tools, 'semantic_search', { query: 'zzz_no_such_term' }) as { hits: unknown[] }
    expect(result.hits).toEqual([])
  })

  it('root 不存在时 fail loud', async () => {
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, resolvedConfig(join(root, 'missing'))) }).toThrow(/does not exist/)
  })

  it('摘要确定性且不超过注入预算', async () => {
    writeFileSync(join(root, 'a.ts'), 'export function alpha() { return 1 }', 'utf-8')
    writeFileSync(join(root, 'b.py'), 'def helper():\n    return 2', 'utf-8')
    const index = new SemanticIndex(root)
    index.rebuild()
    const first = renderIndexSummary(index)
    const second = renderIndexSummary(index)
    expect(first).toBe(second) // 同一索引状态 → 相同文本
    expect(first.length).toBeLessThanOrEqual(INDEX_SUMMARY_MAX_CHARS)
    expect(first).toContain('a.ts')
    expect(first).toContain('b.py')
  })

  it('无 root 配置时缺省为 deployment workdir（装配不抛）', () => {
    // 真实装配路径：cordis.patch.yml 仅登记 id/name 无 config →
    // schemastery Config({}) 解析后 root 为 undefined（无 schema 默认值）。
    // 回归：apply 必须显式缺省 process.cwd()，不得 resolve(undefined) 抛 TypeError
    // （同 tool-meridian/tool-file-info 模式，曾致 loader include apply 失败）。
    const { ctx } = makeCtx()
    expect(() => { apply(ctx, { maxFiles: 500, staleTtlMs: 300_000, timeoutMs: 15_000 }) }).not.toThrow()
  })
})
