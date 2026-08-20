/**
 * lsp-multi-manager.spec.ts — defaultLspSpawn 的平台派发契约 + manager 进程
 * 早夭防御（移植 dsh-tui e33052c）。
 *
 * 回归目标一（win32 .cmd 启动）：Windows 上 npx 与 npm 全局安装的 langserver
 * 是 .cmd，不经 shell 直接 spawn 抛 EINVAL（Node CVE-2024-27980 后行为）。
 * defaultLspSpawn 在 win32 须经 ComSpec（cmd.exe）/d /c 以 argv 数组派发，
 * shell 保持 false（DEP0190：shell:true + args 数组的弃用警告会经 stderr
 * 渲染进 TUI 输入框区域）。
 *
 * 回归目标二（进程早夭 settle）：rpc.request 无超时，进程在 initialize 应答
 * 前死掉时 pending 请求永不 settle——不竞速的话 ensure() 永久挂起，诊断/
 * 跳转全部卡死。manager.initialize 必须落入 catch 置 ready=false。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'

// 类型化 mock：unknown 参数/返回避免类型感知 lint 的 no-unsafe-*（本仓规则比源仓严）。
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn<(...args: unknown[]) => unknown>() }))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

// 动态 import：确保 child_process mock 生效后再加载被测模块
import { defaultLspSpawn } from '../src/lsp/multi-manager.js'
import { createLspManager } from '../src/lsp/manager.js'
import { LSP_SERVERS } from '../src/lsp/server-registry.js'

function stubProc() {
  return {
    on: vi.fn(),
    kill: vi.fn(),
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }
}

describe('defaultLspSpawn 平台派发', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    spawnMock.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { ...origPlatform })
  })

  function platform(win32: boolean): void {
    Object.defineProperty(process, 'platform', { value: win32 ? 'win32' : 'linux', configurable: true })
  }

  it('win32：npx 经 cmd.exe /d /c 派发，windowsHide 且 shell 不为 true', () => {
    platform(true)
    spawnMock.mockReturnValue(stubProc())
    const tsDef = LSP_SERVERS.find(s => s.id === 'typescript')!

    defaultLspSpawn(tsDef, '/work')

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0]!
    expect(command).toBe(process.env.ComSpec ?? 'cmd.exe')
    expect(args).toEqual(['/d', '/c', 'npx', '-y', 'typescript-language-server', '--stdio'])
    expect(options).toMatchObject({ cwd: '/work', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    expect(options).not.toHaveProperty('shell', true)
  })

  it('win32：非 npx server（pyright 等 .exe/.cmd 通用）同样走 cmd.exe 派发', () => {
    platform(true)
    spawnMock.mockReturnValue(stubProc())
    const pyDef = LSP_SERVERS.find(s => s.id === 'pyright')!

    defaultLspSpawn(pyDef, '/work')

    const [command, args] = spawnMock.mock.calls[0]!
    expect(command).toBe(process.env.ComSpec ?? 'cmd.exe')
    expect(args).toEqual(['/d', '/c', 'pyright-langserver', '--stdio'])
  })

  it('非 win32：直接 spawn def.command，行为不变', () => {
    platform(false)
    spawnMock.mockReturnValue(stubProc())
    const tsDef = LSP_SERVERS.find(s => s.id === 'typescript')!

    defaultLspSpawn(tsDef, '/work')

    const [command, args, options] = spawnMock.mock.calls[0]!
    expect(command).toBe('npx')
    expect(args).toEqual(['-y', 'typescript-language-server', '--stdio'])
    expect(options).toMatchObject({ cwd: '/work', windowsHide: true })
    expect(options).not.toHaveProperty('shell', true)
  })

  it('注入 spawnFn：平台派发对注入缝同样生效（win32）', () => {
    platform(true)
    const spawnFn = vi.fn<(cmd: string, args: string[], opts: Record<string, unknown>) => unknown>().mockReturnValue(stubProc())
    const tsDef = LSP_SERVERS.find(s => s.id === 'typescript')!

    defaultLspSpawn(tsDef, '/work', spawnFn as unknown as (cmd: string, args: string[], opts: Record<string, unknown>) => ChildProcess)

    const [command, args] = spawnFn.mock.calls[0]!
    expect(command).toBe(process.env.ComSpec ?? 'cmd.exe')
    expect(args).toEqual(['/d', '/c', 'npx', '-y', 'typescript-language-server', '--stdio'])
  })
})

describe('manager 进程早夭防御（initialize 竞速）', () => {
  function handlerOf(proc: ReturnType<typeof stubProc>, event: string): (...args: never[]) => void {
    const h = proc.on.mock.calls.find(([ev]) => ev === event)?.[1] as ((...args: never[]) => void) | undefined
    if (!h) throw new Error(`no '${event}' handler registered`)
    return h
  }

  it('error 早于 initialize 应答：initialize 落 catch，不永久挂起，ready=false', async () => {
    const proc = stubProc()
    const mgr = createLspManager(() => proc as unknown as ChildProcess, '/work')

    const init = mgr.initialize()
    // spawn 后、initialize 应答前进程死亡（异步 ENOENT 路径）
    handlerOf(proc, 'error')(new Error('spawn ENOENT') as never)

    await init
    expect(mgr.isReady()).toBe(false)
    expect(proc.kill).toHaveBeenCalled()
  })

  it('close 早于 initialize 应答：同样 settle，不永久挂起', async () => {
    const proc = stubProc()
    const mgr = createLspManager(() => proc as unknown as ChildProcess, '/work')

    const init = mgr.initialize()
    handlerOf(proc, 'close')()

    await init
    expect(mgr.isReady()).toBe(false)
  })

  it('早夭后后续查询返回空数组（不挂死连接）', async () => {
    const proc = stubProc()
    const mgr = createLspManager(() => proc as unknown as ChildProcess, '/work')

    const init = mgr.initialize()
    handlerOf(proc, 'error')(new Error('spawn ENOENT') as never)
    await init

    const defs = await mgr.getFileDiagnostics('/work/a.ts')
    expect(defs).toEqual([])
    const locs = await mgr.gotoDefinition('/work/a.ts', 1, 1)
    expect(locs).toEqual([])
  })
})
