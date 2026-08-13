/**
 * tool-file-info 单测：file_info 工具（size/行数/结构骨架/pheromone
 * 按需召回）+ 信号源接线（read_file → entry-point、失败 bash → fragile）。
 *
 * mock ctx：tools.register 捕获工具、ctx.on 捕获 session/event 监听器（手动
 * 触发模拟事件流）；fs 服务 mock 代理真实文件系统（resolve 以 root 为 cwd
 * 解析、stat/readText 走 node:fs），以便断言 file_info 的所有文件访问都
 * 经过 ctx.fs（与 read 工具同级，而非裸 node:fs）。
 *
 * @module @huiliyi37/dsh-tool-file-info/tests/tool-file-info
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockedFunction } from 'vitest'
import type { Context } from '@huiliyi37/cordis'
import { CallId, createToolResultMessage } from '@huiliyi37/dsh-llm'
import { apply } from '../src/index.ts'
import type { SessionEvent } from '@huiliyi37/dsh-session'

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown>
}

interface CapturedListener {
  event: string
  handler: (subject: unknown, event: SessionEvent) => void
}

interface FsMock {
  resolve: MockedFunction<
    (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => Promise<{ targetKey: string; displayPath: string }>
  >
  stat: MockedFunction<
    (target: { targetKey: string }) => Promise<{ version: string; type: 'file' | 'directory'; size: number } | undefined>
  >
  readText: MockedFunction<(target: { targetKey: string }) => Promise<string>>
}

function resolvedConfig(root: string): Record<string, unknown> {
  return { root, timeoutMs: 30_000 }
}

/** fs 服务 mock：代理真实文件系统，resolve 以 root 为 cwd（语义同 fs-local）。 */
function makeFsMock(root: string): FsMock {
  const resolveFn = vi.fn(async (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => {
    const abs = isAbsolute(path) ? path : join(opts?.cwd ?? root, path)
    return { targetKey: abs, displayPath: abs }
  })
  const statFn = vi.fn(async (target: { targetKey: string }) => {
    try {
      const st = statSync(target.targetKey)
      return { version: `${st.mtimeMs}`, type: st.isDirectory() ? ('directory' as const) : ('file' as const), size: st.size }
    } catch {
      return undefined
    }
  })
  const readTextFn = vi.fn(async (target: { targetKey: string }) => readFileSync(target.targetKey, 'utf-8'))
  return { resolve: resolveFn, stat: statFn, readText: readTextFn }
}

function makeCtx(root: string): {
  ctx: Context
  tools: CapturedTool[]
  listeners: CapturedListener[]
  fs: FsMock
} {
  const tools: CapturedTool[] = []
  const listeners: CapturedListener[] = []
  const fs = makeFsMock(root)
  const ctx = {
    tools: {
      register: vi.fn((tool: CapturedTool) => { tools.push(tool) }),
    },
    on: vi.fn((event: string, handler: (subject: unknown, event: SessionEvent) => void) => {
      listeners.push({ event, handler })
    }),
    fs,
    emit: vi.fn(),
  } as unknown as Context
  return { ctx, tools, listeners, fs }
}

/** 失败验证序列：bash call（注册命令）+ result（真实 ToolResultMessage 形状）。 */
function fireFailedRun(listeners: CapturedListener[], command: string, turn = 1, step = 1): void {
  const callId = CallId(`c${turn}-${step}`)
  fire(listeners, { type: 'tool/call', seq: turn * 10 + step, time: Date.now(), data: { turn, step, callId, name: 'bash', arguments: JSON.stringify({ command, cwd: process.cwd() }) } })
  fire(listeners, {
    type: 'tool/result', seq: turn * 10 + step + 1, time: Date.now(),
    data: {
      turn, step,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'Test Files  1 failed | 5 passed' }],
        isError: true,
      }),
    },
  })
}

/** 触发捕获的 session/event 监听器（模拟事件流）。 */
function fire(listeners: CapturedListener[], event: SessionEvent): void {
  for (const l of listeners) {
    if (l.event === 'session/event') l.handler({ id: 'session-1' }, event)
  }
}

async function runTool(tools: CapturedTool[], name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools.find(t => t.name === name)
  if (tool === undefined) throw new Error(`tool not registered: ${name}`)
  return tool.execute(args, { signal: new AbortController().signal })
}

describe('tool-file-info', () => {
  let root: string

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'tool-file-info-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('注册 file_info 工具并监听 session/event', async () => {
    const { ctx, tools, listeners } = makeCtx(root)
    apply(ctx, resolvedConfig(root))
    expect(tools.map(t => t.name)).toEqual(['file_info'])
    expect(listeners.some(l => l.event === 'session/event')).toBe(true)
  })

  it('file_info 返回 size/mtime/行数/结构骨架与 pheromone 信号', async () => {
    const content = [
      'import { x } from "./y"',
      '',
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export class Beta {',
      '  method() {}',
      '}',
    ].join('\n')
    const file = join(root, 'src', 'a.spec.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(file, content, 'utf-8')

    const { ctx, tools, listeners } = makeCtx(root)
    apply(ctx, resolvedConfig(root))

    // 先制造 fragile 信号（模拟一次失败验证事件）。
    fireFailedRun(listeners, 'pnpm vitest run src/a.spec.ts --reporter=verbose')

    const result = await runTool(tools, 'file_info', { path: 'src/a.spec.ts' }) as {
      size: number
      lines: number
      skeleton: string[]
      pheromones: Array<{ signal: string; currentStrength: number }>
    }
    expect(result.size).toBeGreaterThan(0)
    expect(result.lines).toBe(9)
    expect(result.skeleton.length).toBeGreaterThan(0)
    expect(result.pheromones.length).toBeGreaterThan(0)
    expect(result.pheromones[0]?.signal).toBe('fragile')
  })

  it('信号源：read_file 调用沉积 entry-point、失败 bash 沉积 fragile', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'b.spec.ts'), 'export const b = 1', 'utf-8')
    const { ctx, tools, listeners } = makeCtx(root)
    apply(ctx, resolvedConfig(root))

    fire(listeners, { type: 'tool/call', seq: 1, time: Date.now(), data: { turn: 1, step: 0, callId: CallId('c1'), name: 'read_file', arguments: JSON.stringify({ file: 'src/b.spec.ts' }) } })
    fireFailedRun(listeners, 'pnpm vitest run src/b.spec.ts', 1, 1)

    const result = await runTool(tools, 'file_info', { path: 'src/b.spec.ts' }) as { pheromones: Array<{ signal: string }> }
    const signals = result.pheromones.map(p => p.signal)
    expect(signals).toContain('entry-point')
    expect(signals).toContain('fragile')
  })

  it('无 pheromone 文件返回空数组', async () => {
    writeFileSync(join(root, 'plain.txt'), 'no source here', 'utf-8')
    const { ctx, tools } = makeCtx(root)
    apply(ctx, resolvedConfig(root))
    const result = await runTool(tools, 'file_info', { path: 'plain.txt' }) as { pheromones: unknown[]; lines: number }
    expect(result.pheromones).toEqual([])
    expect(result.lines).toBe(1)
  })

  it('root 缺失 fail loud', async () => {
    const { ctx } = makeCtx(root)
    expect(() => { apply(ctx, resolvedConfig(join(root, 'missing'))) }).toThrow(/does not exist/)
  })

  it('文件访问全部经过 ctx.fs 服务（resolve/stat/readText），与 read 工具同级', async () => {
    writeFileSync(join(root, 'f.ts'), 'export const f = 1', 'utf-8')
    const { ctx, tools, fs } = makeCtx(root)
    apply(ctx, resolvedConfig(root))
    await runTool(tools, 'file_info', { path: 'f.ts' })
    expect(fs.resolve).toHaveBeenCalledWith('f.ts', expect.objectContaining({ cwd: root }))
    expect(fs.stat).toHaveBeenCalled()
    expect(fs.readText).toHaveBeenCalled()
  })

  it('fs 服务拒绝时错误上抛（尊重服务层判定，不裸读文件系统）', async () => {
    const { ctx, tools, fs } = makeCtx(root)
    fs.resolve.mockRejectedValueOnce(new Error('resolve aborted'))
    apply(ctx, resolvedConfig(root))
    await expect(runTool(tools, 'file_info', { path: 'x.ts' })).rejects.toThrow('resolve aborted')
    // 服务拒绝后不得继续裸读。
    expect(fs.readText).not.toHaveBeenCalled()
  })

  it('read_file 以绝对路径调用时沉积的 entry-point 可用相对路径查询到', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'c.spec.ts')
    writeFileSync(file, 'export const c = 1', 'utf-8')
    const { ctx, tools, listeners } = makeCtx(root)
    apply(ctx, resolvedConfig(root))

    // 模型以绝对路径调用 read_file。
    fire(listeners, { type: 'tool/call', seq: 1, time: Date.now(), data: { turn: 1, step: 0, callId: CallId('c1'), name: 'read_file', arguments: JSON.stringify({ file: resolve(file) }) } })

    const result = await runTool(tools, 'file_info', { path: 'src/c.spec.ts' }) as { pheromones: Array<{ signal: string }> }
    expect(result.pheromones.map(p => p.signal)).toContain('entry-point')
  })
})
