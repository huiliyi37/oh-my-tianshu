/**
 * Kitty CSI u / xterm modifyOtherKeys 与跨 chunk 粘贴 return 按住。
 */
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { InputHandler } from '../src/engine/input-handler.js'
import { InputLine, inputViewportMaxLines } from '../src/engine/input-line.js'

function makeStdin(): NodeJS.ReadStream & Record<string, unknown> {
  const stdin = new EventEmitter() as unknown as NodeJS.ReadStream & Record<string, unknown>
  stdin.isTTY = false
  stdin.setRawMode = vi.fn()
  stdin.resume = vi.fn()
  stdin.setEncoding = vi.fn()
  stdin.pause = vi.fn()
  return stdin
}

describe('Kitty / xterm 增强键', () => {
  it('CSI 27 u → escape（Cursor/Kitty 消歧后的 Esc）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string }> = []
    handler.onAnyKey(k => keys.push({ name: k.name }))
    stdin.emit('data', '\x1b[27u')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'escape' }])
  })

  it('CSI 13;2u → return+shift（Shift+Enter）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; shift: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, shift: k.shift }))
    stdin.emit('data', '\x1b[13;2u')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'return', shift: true }])
  })

  it('xterm modifyOtherKeys CSI 27;2;13~ → return+shift', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; shift: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, shift: k.shift }))
    stdin.emit('data', '\x1b[27;2;13~')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'return', shift: true }])
  })
})

describe('跨 chunk 粘贴 return', () => {
  it('上一包停在 \\r、下一包立刻到达 → 第一次 return 标 inline', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input', returnHoldMs: 30 })
    const keys: Array<{ name: string; inline?: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, inline: k.inline }))
    stdin.emit('data', '第一行\r')
    stdin.emit('data', '第二行\r')
    await new Promise(r => setTimeout(r, 50))
    handler.dispose()
    const returns = keys.filter(k => k.name === 'return')
    expect(returns[0]?.inline).toBe(true)
    expect(returns[1]?.inline).toBeUndefined()
  })
})

describe('inputViewportMaxLines', () => {
  it('矮屏至少 3 行，高屏封顶 12，约 rows/3', () => {
    expect(inputViewportMaxLines(1)).toBe(3)
    expect(inputViewportMaxLines(30)).toBe(10)
    expect(inputViewportMaxLines(80)).toBe(12)
  })
})

describe('InputLine newlineMode', () => {
  it('开启后普通 Enter 插入换行，不提交', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.insertText('hello')
    line.setNewlineMode(true)
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(line.value).toBe('hello\n')
  })

  it('粘贴流结束的 return 仍合并提交', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.setNewlineMode(true)
    line.insertText('第一行')
    line.handleKey('return', '', false, false, false, true)
    line.insertText('第二行')
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('第一行\n第二行', [])
  })
})
