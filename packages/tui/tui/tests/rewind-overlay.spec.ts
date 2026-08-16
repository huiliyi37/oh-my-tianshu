import { describe, expect, it, vi } from 'vitest'
import { RewindOverlay, type RewindableMessage } from '../src/format/rewind-overlay.js'

/** now 基准：消息时间相对固定（time 用 Date.now() 减偏移,相对时间稳定）。 */
const NOW = Date.now()
const MESSAGES: RewindableMessage[] = [
  { seq: 0, turn: 1, kind: 'user', time: NOW - 300_000, text: 'hello' }, // 5m 前
  { seq: 3, turn: 1, kind: 'assistant', time: NOW - 120_000, text: 'let me check' }, // 2m 前
  { seq: 7, turn: 2, kind: 'assistant', time: NOW - 30_000, text: 'fixed it' }, // 30s 前
]

describe('RewindOverlay 状态机', () => {
  it('setMessages 后进入 list 阶段，默认选中最后消息', () => {
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, vi.fn())
    expect(ov.selectedSeq()).toBe(7)
    const rows = ov.render(80, 20)
    expect(rows[0]).toContain('rewind')
    expect(rows.some(r => r.includes('fixed it'))).toBe(true)
  })

  it('list 阶段：时间线渲染——类型标记 ❯/✦、相对时间、turn 分隔线', () => {
    const ov = new RewindOverlay()
    ov.setMessages(MESSAGES, vi.fn())
    const rows = ov.render(80, 20)
    const plain = rows.map(r => r.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
    expect(plain.some(r => r.includes('❯ 5m 0s 前 hello'))).toBe(true)
    expect(plain.some(r => r.includes('✦ 2m 0s 前 let me check'))).toBe(true)
    expect(plain.some(r => r.includes('✦ 30s 前 fixed it'))).toBe(true)
    // turn 分隔线:每个 turn 起点插分隔(时间线分组,含首个 turn)
    expect(plain.some(r => r.includes('── turn 1 ──'))).toBe(true)
    expect(plain.some(r => r.includes('── turn 2 ──'))).toBe(true)
  })

  it('list 阶段：滚动窗口跟随选中（消息数超 bodyHeight 时可滚到更早）', () => {
    // 12 条消息,渲染高度 6 行强制小窗口
    const many: RewindableMessage[] = Array.from({ length: 12 }, (_, i) => ({
      seq: i,
      turn: Math.floor(i / 4),
      kind: 'user' as const,
      time: NOW - (12 - i) * 10_000,
      text: `msg-${i}`,
    }))
    const ov = new RewindOverlay()
    ov.setMessages(many, vi.fn())
    // 默认选最后(seq 11):窗口应包含 msg-11
    let rows = ov.render(80, 6).map(r => r.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
    expect(rows.some(r => r.includes('msg-11'))).toBe(true)
    expect(rows.some(r => r.includes('msg-0'))).toBe(false)
    // 滚到最早(连按 ↑ 到顶):窗口应包含 msg-0
    for (let i = 0; i < 20; i++) ov.handleKey('up', '')
    rows = ov.render(80, 6).map(r => r.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
    expect(rows.some(r => r.includes('msg-0'))).toBe(true)
    expect(rows.some(r => r.includes('msg-11'))).toBe(false)
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
