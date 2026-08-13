import { describe, expect, it, vi } from 'vitest'
import { RewindOverlay, type RewindableMessage } from '../src/format/rewind-overlay.js'

const MESSAGES: RewindableMessage[] = [
  { seq: 0, turn: 1, text: 'hello' },
  { seq: 3, turn: 1, text: 'let me check' },
  { seq: 7, turn: 2, text: 'fixed it' },
]

describe('RewindOverlay 状态机', () => {
  it('setMessages 后进入 list 阶段，默认选中最后消息', () => {
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, vi.fn())
    expect(ov.selectedSeq()).toBe(7)
    const rows = ov.render(80, 20)
    expect(rows[0]).toContain('rewind')
    expect(rows.some(r => r.includes('[turn 2] fixed it'))).toBe(true)
  })

  it('list 阶段：↑↓/j k 移动选中，Enter 进入 mode 阶段', () => {
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, vi.fn())
    ov.handleKey('up', '')
    expect(ov.selectedSeq()).toBe(3)
    ov.handleKey('', 'k')
    expect(ov.selectedSeq()).toBe(0)
    ov.handleKey('down', '')
    expect(ov.selectedSeq()).toBe(3)
    ov.handleKey('return', '')
    const rows = ov.render(80, 20)
    expect(rows.some(r => r.includes('回退到 seq 3'))).toBe(true)
    expect(rows.some(r => r.includes('1. 只截断会话'))).toBe(true)
  })

  it('mode 阶段：数字键选粒度并执行，done 阶段渲染结果', async () => {
    const executor = vi.fn(async () => ({ filesChanged: 2, truncatedTo: 3 }))
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, executor)
    ov.handleKey('return', '')
    ov.handleKey('', '3') // both
    expect(executor).toHaveBeenCalledWith('both', 7)
    // run() 是 async——等一拍
    await new Promise(resolve => setImmediate(resolve))
    const rows = ov.render(80, 20)
    expect(rows.some(r => r.includes('回退完成：2 个文件，会话截断到 seq 3'))).toBe(true)
  })

  it('mode 阶段：executor 抛错 → done 渲染失败信息', async () => {
    const executor = vi.fn(async () => { throw new Error('boom') })
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, executor)
    ov.handleKey('return', '')
    ov.handleKey('', '1')
    await new Promise(resolve => setImmediate(resolve))
    const rows = ov.render(80, 20)
    expect(rows.some(r => r.includes('回退失败：boom'))).toBe(true)
  })

  it('done 阶段：filesSkipped > 0 渲染缺口提示', async () => {
    const executor = vi.fn(async () => ({ filesChanged: 1, filesSkipped: 2 }))
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, executor)
    ov.handleKey('return', '')
    ov.handleKey('', '2') // code
    await new Promise(resolve => setImmediate(resolve))
    const rows = ov.render(80, 20)
    expect(rows.some(r => r.includes('回退完成：1 个文件（2 个文件因快照缺失未回退）'))).toBe(true)
  })

  it('list/mode 阶段 Esc 返回 true（装配方负责 deactivate）', () => {
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, vi.fn())
    expect(ov.handleKey('escape', '')).toBe(true)
    ov.handleKey('return', '')
    expect(ov.handleKey('escape', '')).toBe(true)
  })

  it('空消息列表：selectedSeq 返回 -1，Enter 不进入 mode', () => {
    const ov = new RewindOverlay()
    ov.setMessages([], vi.fn())
    expect(ov.selectedSeq()).toBe(-1)
    expect(ov.handleKey('return', '')).toBe(true) // 无选中 → 视为取消
    expect(ov.render(80, 20)[1]).toContain('↑↓')
  })
})
