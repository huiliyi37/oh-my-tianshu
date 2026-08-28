/**
 * term-bell — 完成事件的终端 BEL 通道（SSH 下唯一可达的提醒，失败静默）。
 * 回流 dsh-tui 704a833（prefs 门适配为本包 bellEnabled）。
 */
import { describe, expect, it, vi } from 'vitest'
import { SKIP_NOTIFY_ENV, shouldBell, writeBell } from '../src/term-bell.js'

function fakeStream() {
  const written: string[] = []
  return { written, write: (s: string) => { written.push(s) } }
}

describe('shouldBell', () => {
  const clean = { PATH: '/usr/bin' }

  it('干净环境放行', () => {
    expect(shouldBell(clean)).toBe(true)
  })

  it('SKIP / VITEST / CI 静默', () => {
    expect(shouldBell({ ...clean, [SKIP_NOTIFY_ENV]: '1' })).toBe(false)
    expect(shouldBell({ ...clean, VITEST: '1' })).toBe(false)
    expect(shouldBell({ ...clean, CI: 'true' })).toBe(false)
  })

  it('SSH 放行——BEL 穿透 pty 到本地终端，正是远程会话的兜底提醒', () => {
    expect(shouldBell({ ...clean, SSH_CONNECTION: '1 2 3 4' })).toBe(true)
    expect(shouldBell({ ...clean, SSH_TTY: '/dev/pts/0' })).toBe(true)
  })

  it('prefs.bellEnabled === false 静默（缺省视为开）', () => {
    expect(shouldBell(clean, { bellEnabled: false })).toBe(false)
    expect(shouldBell(clean, {})).toBe(true)
    expect(shouldBell(clean, { bellEnabled: true })).toBe(true)
  })
})

describe('writeBell', () => {
  const clean = { PATH: '/usr/bin' }

  it('放行时写出 BEL（\\x07）', () => {
    const out = fakeStream()
    expect(writeBell(out, clean)).toBe(true)
    expect(out.written).toEqual(['\x07'])
  })

  it('门闸关闭不写、不抛', () => {
    const out = fakeStream()
    expect(writeBell(out, { ...clean, VITEST: '1' })).toBe(false)
    expect(out.written).toEqual([])
  })

  it('stream.write 抛错时静默吞掉', () => {
    const out = { write: vi.fn(() => { throw new Error('EBADF') }) }
    expect(() => writeBell(out, clean)).not.toThrow()
    expect(writeBell(out, clean)).toBe(false)
  })
})
