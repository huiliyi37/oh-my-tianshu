/**
 * LspBridge 集成测试——假 LSP server（PassThrough 流 + JSON-RPC 帧）注入，
 * 不真 spawn 任何进程。覆盖：触发/缓存/并发合并/冷却/未安装/超时/dispose。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createLspBridge, officialLspSource, type LspBridge } from '../src/lsp/lsp-bridge.js'
import type { LspServerDef } from '../src/lsp/server-registry.js'
import { decodeMessages, encodeMessage } from '../src/lsp/rpc.js'
import type { LspDiagnostic } from '../src/lsp/manager.js'

/** 假 LSP server：解析请求并同步响应（PassThrough 同步转发）。 */
class FakeLspServer {
  readonly proc: FakeProc
  diagnosticItems: LspDiagnostic[] = []
  /** 是否响应 diagnostic 请求（false = 模拟超时）。 */
  respondDiagnostic = true
  private readonly log: string[] = []

  constructor() {
    this.proc = new FakeProc()
    // client 请求写在 stdin 上；server 响应写回 stdout。
    this.proc.stdin.on('data', (chunk: Buffer) => {
      const { messages } = decodeMessages(chunk)
      for (const msg of messages) {
        if (!('id' in msg) || 'result' in msg || 'error' in msg) continue
        const req = msg as { id: number; method: string }
        this.log.push(req.method)
        if (req.method === 'initialize') {
          this.respond(req.id, { capabilities: { diagnosticProvider: {} } })
        } else if (req.method === 'textDocument/diagnostic') {
          if (this.respondDiagnostic) this.respond(req.id, { items: this.diagnosticItems })
          // 不响应 = 拉取超时
        } else {
          this.respond(req.id, null)
        }
      }
    })
  }

  private respond(id: number, result: unknown): void {
    this.proc.stdout.write(encodeMessage({ jsonrpc: '2.0', id, result }))
  }

  requestLog(): string[] {
    return [...this.log]
  }
}

/** 假子进程：PassThrough 流 + kill 记录。 */
class FakeProc {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  on(): void { /* 事件注册忽略 */ }
  kill(): void { this.killed = true }
}

function tsError(message: string, line = 2): LspDiagnostic {
  return {
    range: { start: { line: line - 1, character: 3 }, end: { line: line - 1, character: 9 } },
    severity: 1,
    message,
  }
}

describe('LspBridge', () => {
  const cwd = '/work'
  let server: FakeLspServer
  let spawnFor: (def: LspServerDef, cwd: string) => ChildProcess
  let bridge: LspBridge
  let onUpdate: () => void

  beforeEach(() => {
    server = new FakeLspServer()
    spawnFor = vi.fn<(def: LspServerDef, cwd: string) => ChildProcess>(() => server.proc as unknown as ChildProcess)
    bridge = createLspBridge({ cwd, spawnFor, timeoutMs: 200 })
    onUpdate = vi.fn<() => void>(() => {})
    bridge.onUpdate(onUpdate)
  })

  afterEach(() => {
    bridge.dispose()
  })

  it('touchFile 拉取诊断入缓存并触发 onUpdate（1-based 行列、相对路径）', async () => {
    server.diagnosticItems = [tsError('类型不匹配'), tsError('未使用的变量', 9)]
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalled()
    })
    const diags = bridge.diagnosticsFor('src/a.ts')
    expect(diags).toHaveLength(2)
    expect(diags?.[0]).toMatchObject({ file: 'src/a.ts', line: 2, character: 4, severity: 1, message: '类型不匹配' })
    expect(diags?.[1]?.line).toBe(9)
    expect(spawnFor).toHaveBeenCalledTimes(1)
    expect(server.requestLog()).toContain('textDocument/diagnostic')
  })

  it('同文件并发 touch 合并：单次 spawn + 单次拉取', async () => {
    server.diagnosticItems = [tsError('e')]
    bridge.touchFile('src/a.ts')
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')).toHaveLength(1)
    })
    expect(spawnFor).toHaveBeenCalledTimes(1)
    expect(server.requestLog().filter(m => m === 'textDocument/diagnostic')).toHaveLength(1)
  })

  it('冷却期内重复 touch 不重拉', async () => {
    server.diagnosticItems = [tsError('e')]
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')).toHaveLength(1)
    })
    bridge.touchFile('src/a.ts')
    // 等一拍确认没有第二次 diagnostic 请求
    await new Promise(r => setTimeout(r, 50))
    expect(server.requestLog().filter(m => m === 'textDocument/diagnostic')).toHaveLength(1)
  })

  it('无诊断文件缓存空数组（已拉取）', async () => {
    server.diagnosticItems = []
    bridge.touchFile('src/clean.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/clean.ts')).toEqual([])
    })
    expect(bridge.unsupported('src/clean.ts')).toBe(false)
  })

  it('server 不响应（超时）→ 空缓存写入，不抛错', async () => {
    server.respondDiagnostic = false
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')).toEqual([])
    }, { timeout: 3_000 })
    expect(spawnFor).toHaveBeenCalledTimes(1)
  })

  it('未知扩展名 → unsupported 标记，不 spawn', async () => {
    bridge.touchFile('notes.xyz')
    expect(spawnFor).not.toHaveBeenCalled()
    expect(bridge.unsupported('notes.xyz')).toBe(true)
    expect(onUpdate).toHaveBeenCalled()
  })

  it('server 未安装（which 全 false）→ 非 always-available 语言 unsupported', async () => {
    // typescript 经 npx alwaysAvailable（不探测）；pyright 需 PATH 有
    // pyright-langserver——which 全 false 时 .py 文件无可用 server。
    // isAvailable 仍为 true（typescript 经 npx 恒可用），语义是「至少一个
    // server 可能可用」，面板空态文案据此区分。
    const noServer = createLspBridge({ cwd, which: () => false, timeoutMs: 200 })
    noServer.touchFile('src/a.py')
    expect(noServer.unsupported('src/a.py')).toBe(true)
    expect(noServer.isAvailable()).toBe(true)
    noServer.dispose()
  })

  it('entries() 返回全量诊断（多文件折叠）', async () => {
    server.diagnosticItems = [tsError('e1')]
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')).toHaveLength(1)
    })
    server.diagnosticItems = [tsError('e2'), tsError('e3')]
    bridge.touchFile('src/b.ts')
    await vi.waitFor(() => {
      expect(bridge.entries().length).toBe(3)
    })
    expect(bridge.entries().map(d => d.file)).toEqual(['src/a.ts', 'src/b.ts', 'src/b.ts'])
  })

  it('dispose 杀 server、清缓存，之后 touch 不再生效', async () => {
    server.diagnosticItems = [tsError('e')]
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')).toHaveLength(1)
    })
    bridge.dispose()
    expect(server.proc.killed).toBe(true)
    expect(bridge.entries()).toEqual([])
    bridge.touchFile('src/a.ts')
    expect(spawnFor).toHaveBeenCalledTimes(1) // dispose 后不再新增 spawn
  })

  it('绝对路径与相对路径等价查询', async () => {
    server.diagnosticItems = [tsError('e')]
    bridge.touchFile('/work/src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('/work/src/a.ts')).toHaveLength(1)
    })
    // 同一文件，相对路径读到同一缓存（显示为相对路径）
    expect(bridge.diagnosticsFor('src/a.ts')?.[0]?.file).toBe('src/a.ts')
  })
})

describe('LspBridge 外部源（伴生插件 provide lsp 服务）', () => {
  const cwd = '/work'

  it('source 存在时消费服务而非内置 manager（不 spawn）', async () => {
    const sourceDispose = vi.fn()
    const source = {
      getDiagnostics: vi.fn(async (_path: string) => [
        { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }, severity: 2 as const, message: '服务诊断' },
      ]),
      isAvailable: vi.fn(() => true),
      dispose: sourceDispose,
    }
    const bridge = createLspBridge({ cwd, timeoutMs: 200, source })
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')?.length).toBe(1)
    })
    expect(source.getDiagnostics).toHaveBeenCalledWith('/work/src/a.ts', 200)
    expect(bridge.diagnosticsFor('src/a.ts')?.[0]?.message).toBe('服务诊断')
    expect(bridge.diagnosticsFor('src/a.ts')?.[0]?.file).toBe('src/a.ts')
    // 外部源所有权归提供方：bridge.dispose 不 dispose source，只解绑
    bridge.dispose()
    expect(sourceDispose).not.toHaveBeenCalled()
  })

  it('isAvailable 转发外部源（内置 manager 未创建）', () => {
    const source = {
      getDiagnostics: vi.fn(async () => []),
      isAvailable: vi.fn(() => false),
      dispose: vi.fn(),
    }
    const bridge = createLspBridge({ cwd, timeoutMs: 200, source })
    expect(bridge.isAvailable()).toBe(false)
    bridge.dispose()
  })
})

describe('officialLspSource（官方 ctx.lsp 服务适配）', () => {
  const cwd = '/work'

  it('把官方 query(getDiagnostics) 结果适配为诊断源', async () => {
    const query = vi.fn(async () => ({
      kind: 'diagnostics',
      diagnostics: [
        { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 7 } }, severity: 1 as const, message: '官方诊断' },
      ],
    }))
    const source = officialLspSource({ query }, cwd)
    const diags = await source.getDiagnostics('src/a.ts', 500)
    expect(query).toHaveBeenCalledWith(
      { operation: 'getDiagnostics', filePath: 'src/a.ts', workspaceRoot: cwd },
      expect.any(AbortSignal),
    )
    expect(diags).toEqual([
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 7 } }, severity: 1, message: '官方诊断' },
    ])
    // 所有权归官方服务：适配器 dispose 是 no-op
    source.dispose()
    expect(source.isAvailable()).toBe(true)
  })

  it('官方服务错误（无 provider / 不支持 / 超时）静默返回空', async () => {
    const query = vi.fn(async () => { throw new Error('LSP_UNAVAILABLE') })
    const source = officialLspSource({ query }, cwd)
    await expect(source.getDiagnostics('src/a.ts', 500)).resolves.toEqual([])
  })

  it('非 diagnostics kind 的结果返回空', async () => {
    const query = vi.fn(async () => ({ kind: 'hover', hover: null }))
    const source = officialLspSource({ query }, cwd)
    await expect(source.getDiagnostics('src/a.ts', 500)).resolves.toEqual([])
  })

  it('与 LspBridge 组合：官方服务作为 source 消费', async () => {
    const query = vi.fn(async () => ({
      kind: 'diagnostics',
      diagnostics: [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }, severity: 2 as const, message: 'warn' }],
    }))
    const bridge = createLspBridge({
      cwd, timeoutMs: 200,
      source: officialLspSource({ query }, cwd),
    })
    bridge.touchFile('src/a.ts')
    await vi.waitFor(() => {
      expect(bridge.diagnosticsFor('src/a.ts')?.length).toBe(1)
    })
    expect(bridge.diagnosticsFor('src/a.ts')?.[0]).toMatchObject({ severity: 2, message: 'warn', line: 3 })
    bridge.dispose()
  })
})
