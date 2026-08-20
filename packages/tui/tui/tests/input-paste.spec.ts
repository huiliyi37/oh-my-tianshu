import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { InputHandler } from '../src/engine/input-handler.js'
import { InputLine } from '../src/engine/input-line.js'

describe('非 bracketed paste 粘贴流：内联 return 合并为一次提交', () => {
  function makeStdin(): NodeJS.ReadStream & Record<string, unknown> {
    const stdin = new EventEmitter() as unknown as NodeJS.ReadStream & Record<string, unknown>
    stdin.isTTY = false
    stdin.setRawMode = vi.fn()
    stdin.resume = vi.fn()
    stdin.setEncoding = vi.fn()
    stdin.pause = vi.fn()
    return stdin
  }

  it('InputHandler：粘贴流中行尾 \\r 标记 inline（缓冲还有后续字节）', async () => {
    const stdin = makeStdin()
    const handler = new InputHandler({ stdin, mode: 'input' })
    const keys: Array<{ name: string; inline?: boolean }> = []
    handler.onAnyKey(k => keys.push(k))
    stdin.emit('data', '第一行\r第二行\r第三行\r')
    await new Promise(r => setTimeout(r, 120))
    handler.dispose()
    const returns = keys.filter(k => k.name === 'return')
    expect(returns.length).toBe(3)
    expect(returns[0]?.inline).toBe(true)   // 后跟第二行
    expect(returns[1]?.inline).toBe(true)   // 后跟第三行
    expect(returns[2]?.inline).toBeUndefined() // 缓冲末尾：普通 return
  })

  it('InputLine：内联 return 累积，流结束一次提交合并多行', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    // 模拟粘贴流：每行文本后跟 inline return（行分隔）
    line.insertText('第一行')
    line.handleKey('return', '', false, false, false, true)
    line.insertText('第二行')
    line.handleKey('return', '', false, false, false, true)
    line.insertText('第三行')
    // 缓冲末尾：普通 return → 合并提交
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('第一行\n第二行\n第三行', [])
  })

  it('普通 Enter 不受影响：无累积时立即单行提交', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.insertText('hello')
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('hello', [])
  })

  it('单次 Enter 后再 Enter（人工连按）：各自单行提交，不合并', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.insertText('一')
    line.handleKey('return', '', false, false, false, false)
    line.insertText('二')
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit.mock.calls[0]?.[0]).toBe('一')
    expect(onSubmit.mock.calls[1]?.[0]).toBe('二')
  })
})

describe('换行模式（粘滞）下粘贴流并入草稿，不提交', () => {
  it('inline return 累积行 + 当前行 + 尾随换行并入 value，onSubmit 不触发', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.setNewlineMode(true)
    line.insertText('草稿')
    line.handleKey('return', '', false, false, false, true) // 粘贴流行分隔
    line.insertText('第一行')
    line.handleKey('return', '', false, false, false, true)
    line.insertText('第二行')
    // 流结束（普通 return）：换行模式下并入草稿，而不是提交
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(line.value).toBe('草稿\n第一行\n第二行\n')
  })

  it('换行模式无粘贴流时普通 Enter 仍插入换行', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.setNewlineMode(true)
    line.insertText('a')
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(line.value).toBe('a\n')
  })

  it('换行模式下提交需退出模式后 Enter（行为不变）', () => {
    const onSubmit = vi.fn()
    const line = new InputLine({ onSubmit })
    line.setNewlineMode(true)
    line.insertText('a')
    line.setNewlineMode(false)
    line.handleKey('return', '', false, false, false, false)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('a', [])
  })
})
