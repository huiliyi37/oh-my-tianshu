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

  it('CSI 13;5u → ctrl_return（Ctrl+Enter 插队键，kitty 键盘增强）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; ctrl: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, ctrl: k.ctrl }))
    stdin.emit('data', '\x1b[13;5u')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'ctrl_return', ctrl: true }])
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

  it('Kitty flag 1 把 Ctrl+字母编成 CSI u：99;5u → ctrl_c', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; ctrl: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, ctrl: k.ctrl }))
    stdin.emit('data', '\x1b[99;5u')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'ctrl_c', ctrl: true }])
  })

  it('CSI 113;5u / 97;5u / 106;5u → ctrl_q / ctrl_a / ctrl_j', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const names: string[] = []
    handler.onAnyKey(k => names.push(k.name))
    stdin.emit('data', '\x1b[113;5u\x1b[97;5u\x1b[106;5u')
    await Promise.resolve()
    handler.dispose()
    expect(names).toEqual(['ctrl_q', 'ctrl_a', 'ctrl_j'])
  })

  it('CSI 99;5:1u 按下派发；CSI 99;5:3u 释放吞掉', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const names: string[] = []
    handler.onAnyKey(k => names.push(k.name))
    stdin.emit('data', '\x1b[99;5:1u\x1b[99;5:3u')
    await Promise.resolve()
    handler.dispose()
    expect(names).toEqual(['ctrl_c'])
  })

  it('xterm CSI 27;5;99~ → ctrl_c', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const names: string[] = []
    handler.onAnyKey(k => names.push(k.name))
    stdin.emit('data', '\x1b[27;5;99~')
    await Promise.resolve()
    handler.dispose()
    expect(names).toEqual(['ctrl_c'])
  })

  it('CSI 49;3u → Alt+1（char 保留，供会话 tab 跳转）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; meta: boolean; char: string }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, meta: k.meta, char: k.char }))
    stdin.emit('data', '\x1b[49;3u')
    await Promise.resolve()
    handler.dispose()
    expect(keys).toEqual([{ name: 'unknown', meta: true, char: '1' }])
  })
})

describe('跨 chunk 粘贴 return', () => {
  it('上一包停在 \\r、下一包立刻到达 → 第一次 return 标 inline', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input', returnHoldMs: 30 })
    const keys: Array<{ name: string; inline?: boolean }> = []
    handler.onAnyKey(k => keys.push({ name: k.name, ...(k.inline === undefined ? {} : { inline: k.inline }) }))
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
  it('矮屏至少 3 行，高屏封顶 16，约 rows/3', () => {
    expect(inputViewportMaxLines(1)).toBe(3)
    expect(inputViewportMaxLines(30)).toBe(10)
    expect(inputViewportMaxLines(80)).toBe(16)
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

  it('换行模式：粘贴流结束的 return 并入草稿（Enter 语义一致，不提交）', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.setNewlineMode(true)
    line.insertText('第一行')
    line.handleKey('return', '', false, false, false, true)
    line.insertText('第二行')
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(line.value).toBe('第一行\n第二行\n')
  })
})

describe('InputLine 长草稿视窗与行内编辑', () => {
  it('超出 maxLines 时中文提示上下还有几行', () => {
    const line = new InputLine({ value: Array.from({ length: 8 }, (_, i) => `L${i}`).join('\n') })
    line.setValue(line.value, 0)
    const shown = line.displayLines({ maxLines: 4 }).join('\n')
    expect(shown).toContain('下')
    expect(shown).toContain('行')
    expect(shown).not.toContain('lines below')
  })

  it('无换行的超宽单行：↑ 在软折行间移动，不翻历史', () => {
    const history = ['旧历史']
    const line = new InputLine({
      value: 'abcdefghijklmnopqrstuvwxyz',
      history,
    })
    line.displayLines({ maxWidth: 12, maxLines: 8 })
    line.setValue(line.value, line.value.length)
    line.handleKey('up', '', false, false)
    expect(line.value).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(line.cursor).toBeLessThan(line.value.length)
  })

  it('CJK 超宽单行：↑ 按与折行相同的 code point 量宽移动，不翻历史', () => {
    const history = ['旧历史']
    const line = new InputLine({
      value: '中'.repeat(20),
      history,
    })
    line.displayLines({ maxWidth: 10, maxLines: 8 })
    line.setValue(line.value, line.value.length)
    line.handleKey('up', '', false, false)
    expect(line.value).toBe('中'.repeat(20))
    expect(line.cursor).toBeLessThan(line.value.length)
    expect(line.cursor).toBeGreaterThan(0)
  })

  it('PageUp 在多行草稿中上跳，不提交', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({
      value: Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n'),
      onSubmit,
    })
    line.displayLines({ maxWidth: 40, maxLines: 6 })
    line.setValue(line.value, line.value.length)
    const before = line.cursor
    line.handleKey('pageup', '', false, false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(line.cursor).toBeLessThan(before)
  })

  it('多行时 Home / Ctrl+A 到当前逻辑行首，不是整段草稿开头', () => {
    const line = new InputLine({ value: 'aaa\nbbb\nccc' })
    line.setValue(line.value, line.value.length)
    line.handleKey('home', '', false, false)
    expect(line.cursor).toBe('aaa\nbbb\n'.length)
    line.handleKey('ctrl_a', '', true, false)
    expect(line.cursor).toBe('aaa\nbbb\n'.length)
  })
})

describe('Alt+控制字符（ESC + 控制码组合）', () => {
  it('ESC+DEL → meta+backspace（原先落 unknown，按名路由收不到）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; meta: boolean }> = []
    handler.onAnyKey((key) => { keys.push({ name: key.name, meta: key.meta }) })
    stdin.emit('data', '\x1b\x7f')
    await new Promise(resolve => setTimeout(resolve, 100)) // 越过孤 ESC 超时窗（同 chunk 应立即解析）
    expect(keys).toEqual([{ name: 'backspace', meta: true }])
  })
})
