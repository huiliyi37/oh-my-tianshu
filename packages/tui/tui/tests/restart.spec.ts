/**
 * restart.spec.ts — spawnSelfRestart 的 spawn 调用契约。
 *
 * 覆盖（#34）：
 * - argv 无效（<2 项）→ resolve false，不 spawn
 * - POSIX：spawn argv[0] + argv.slice(1)，stdio inherit + detached（新会话防
 *   SIGHUP/SIGTTIN），windowsHide
 * - win32：不用 detached（否则另开控制台窗口），stdio 继承同一控制台
 * - spawn error（ENOENT 等）→ resolve false
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({
  // 显式参数/返回类型：mock.calls 得 unknown[][]（非 any），no-unsafe-* 收窄。
  spawnMock: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

// 动态 import：确保 child_process mock 生效后再加载被测模块
import { spawnSelfRestart } from '../src/restart.js'

function stubChild() {
  return {
    unref: vi.fn(),
    once: vi.fn(),
  }
}

function emitOnce(child: ReturnType<typeof stubChild>, event: string): void {
  const handler = child.once.mock.calls.find(([ev]) => ev === event)?.[1] as (() => void) | undefined
  if (handler === undefined) throw new Error(`no ${event} handler registered`)
  handler()
}

const ARGV = ['/usr/bin/node', '/app/bin/dsh.js', '--profile', 'tui']

describe('spawnSelfRestart', () => {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    spawnMock.mockReset()
  })

  function platform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  afterEach(() => {
    Object.defineProperty(process, 'platform', { ...origPlatform })
  })

  it('argv 不足 2 项 → false，不 spawn', async () => {
    await expect(spawnSelfRestart({ argv: [] })).resolves.toBe(false)
    await expect(spawnSelfRestart({ argv: ['node'] })).resolves.toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('POSIX：spawn argv[0]+slice(1)，stdio inherit + detached + windowsHide', async () => {
    platform('linux')
    const child = stubChild()
    spawnMock.mockReturnValue(child)

    const p = spawnSelfRestart({ argv: ARGV })
    emitOnce(child, 'spawn')
    await expect(p).resolves.toBe(true)

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0]!
    expect(command).toBe('/usr/bin/node')
    expect(args).toEqual(['/app/bin/dsh.js', '--profile', 'tui'])
    expect(options).toMatchObject({ stdio: 'inherit', detached: true, windowsHide: true })
    expect(child.unref).toHaveBeenCalled()
  })

  it('win32：不用 detached（避免另开控制台窗口）', async () => {
    platform('win32')
    const child = stubChild()
    spawnMock.mockReturnValue(child)

    const p = spawnSelfRestart({ argv: ARGV })
    emitOnce(child, 'spawn')
    await expect(p).resolves.toBe(true)

    const [, , options] = spawnMock.mock.calls[0]!
    expect(options).toMatchObject({ stdio: 'inherit', windowsHide: true })
    expect(options).not.toHaveProperty('detached', true)
  })

  it('spawn error（ENOENT 等）→ false', async () => {
    platform('linux')
    const child = stubChild()
    spawnMock.mockReturnValue(child)

    const p = spawnSelfRestart({ argv: ARGV })
    emitOnce(child, 'error')
    await expect(p).resolves.toBe(false)
  })

  it('缺省 argv 走 process.argv（重启当前进程的命令行）', async () => {
    platform('linux')
    const child = stubChild()
    spawnMock.mockReturnValue(child)

    const p = spawnSelfRestart()
    emitOnce(child, 'spawn')
    await expect(p).resolves.toBe(true)

    const [command, args] = spawnMock.mock.calls[0]!
    expect(command).toBe(process.argv[0])
    expect(args).toEqual(process.argv.slice(1))
  })
})
