/**
 * MemoryBrowserOverlay 单测（P2 交互打磨）。
 *
 * 状态机行为：导航（↑↓/j k）、过滤（字符进 query / backspace 退）、
 * 删除（x → onDelete + refetch 刷新）、分页（Ctrl+N/P → fetchPage）、空态/无匹配渲染。
 * 渲染是纯函数（同一状态恒同行序列）；theme 注入固定实例避免环境探测。
 *
 * @module @deepseek-ai/dsh-tui/tests/memory-overlay
 */

import { describe, expect, it, vi } from 'vitest'
import { MemoryBrowserOverlay, type MemoryBrowserItem } from '../src/format/memory-overlay.js'
import { getTheme } from '../src/theme.js'

const THEME = getTheme()

function item(id: string, text: string, tags: string[] = [], scope = 'global'): MemoryBrowserItem {
  return { id, text, tags, createdAt: 0, scope }
}

/** 渲染文本（剥 ANSI：只取内容行）。 */
function renderLines(overlay: MemoryBrowserOverlay, width = 80, height = 20): string[] {
  return overlay.render(width, height).map(line => line.replace(/\u001b\[[0-9;]*m/g, ''))
}

/** 默认数据源（无操作 mock）。 */
function mockSources() {
  return { refetch: vi.fn(async () => []), onDelete: vi.fn(async () => {}), fetchPage: vi.fn(async () => []) }
}

describe('MemoryBrowserOverlay', () => {
  it('setItems 后渲染列表 + 选中项内容（上下布局）', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems(
      [item('a1', '第一条记忆', ['tooling']), item('a2', '第二条记忆\n第二行', [])],
      mockSources(), false,
    )
    const lines = renderLines(overlay)
    expect(lines.some(l => l.includes('第一条记忆'))).toBe(true)
    expect(lines.some(l => l.includes('#tooling'))).toBe(true)
    expect(lines.some(l => l.includes('第一条记忆'))).toBe(true)
  })

  it('↑↓/j k 移动选中；选中项内容随选中变化', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems(
      [item('a1', '一'), item('a2', '二'), item('a3', '三')],
      mockSources(), false,
    )
    const before = renderLines(overlay)
    expect(before.some(l => l.includes('▸'))).toBe(true)
    overlay.handleKey('down', '')
    expect(renderLines(overlay).some(l => l.includes('▸ [a2'))).toBe(true)
    overlay.handleKey('', 'j')
    expect(renderLines(overlay).some(l => l.includes('▸ [a3'))).toBe(true)
    overlay.handleKey('up', '')
    expect(renderLines(overlay).some(l => l.includes('▸ [a2'))).toBe(true)
    overlay.handleKey('', 'k')
    expect(renderLines(overlay).some(l => l.includes('▸ [a1'))).toBe(true)
  })

  it('字符进过滤（text/tags 子串，大小写不敏感）；无匹配显示提示', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems(
      [item('a1', 'pnpm workspace', []), item('a2', 'DeepSeek API', ['llm'])],
      mockSources(), false,
    )
    overlay.handleKey('', 'd')
    overlay.handleKey('', 'e')
    const lines = renderLines(overlay)
    expect(lines.some(l => l.includes('filter: de'))).toBe(true)
    expect(lines.some(l => l.includes('DeepSeek API'))).toBe(true)
    expect(lines.some(l => l.includes('pnpm workspace'))).toBe(false)
    // tags 匹配（'LLM' 大写）
    overlay.handleKey('backspace', '')
    overlay.handleKey('backspace', '')
    overlay.handleKey('', 'L')
    expect(renderLines(overlay).some(l => l.includes('DeepSeek API'))).toBe(true)
    // 无匹配
    overlay.handleKey('', 'z')
    expect(renderLines(overlay).some(l => l.includes('无匹配'))).toBe(true)
  })

  it('backspace 退过滤；空 query 恢复全量', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems([item('a1', 'x'), item('a2', 'y')], mockSources(), false)
    // 注：'x' 是删除键——过滤测试用 'y'（仅命中 a2）
    overlay.handleKey('', 'y')
    expect(renderLines(overlay).filter(l => l.includes('[')).length).toBe(1)
    overlay.handleKey('backspace', '')
    expect(renderLines(overlay).filter(l => l.includes('[')).length).toBe(2)
  })

  it('x 删除选中：onDelete + refetch 刷新列表，选中回退到界内', async () => {
    let items: MemoryBrowserItem[] = [item('a1', '一'), item('a2', '二')]
    const onDelete = vi.fn(async (id: string) => {
      items = items.filter(i => i.id !== id)
    })
    const refetch = vi.fn(async () => items)
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems(items, { refetch, onDelete, fetchPage: vi.fn(async () => []) }, false)
    overlay.handleKey('down', '')
    overlay.handleKey('', 'x')
    await vi.waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('a2')
      expect(refetch).toHaveBeenCalled()
      expect(overlay.render(80, 20).some(l => l.includes('[a2'))).toBe(false)
    })
  })

  it('Ctrl+N 翻页：fetchPage 追加条目，hasMore 控制翻页按钮', async () => {
    const page1 = [item('a1', '一'), item('a2', '二')]
    const page2 = [item('a3', '三')]
    const fetchPage = vi.fn(async (offset: number) => {
      return offset === 0 ? page1 : offset === 2 ? page2 : []
    })
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems(page1, { ...mockSources(), fetchPage }, true)
    // 翻页（handleKey 同步返回 boolean，内部 void nextPage()；await 边界让
    // fetchPage 微任务链完成，等价原 `await handleKey(...)` 的时序）
    overlay.handleKey('ctrl_n', '')
    await Promise.resolve()
    expect(fetchPage).toHaveBeenCalledWith(2, 20)
    expect(renderLines(overlay).some(l => l.includes('[a3'))).toBe(true)
  })

  it('空条目渲染空态提示', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems([], mockSources(), false)
    const lines = renderLines(overlay)
    expect(lines.some(l => l.includes('暂无记忆'))).toBe(true)
  })

  it('Esc/Ctrl+C 返回消费（装配方关闭 overlay）', () => {
    const overlay = new MemoryBrowserOverlay(THEME)
    overlay.setItems([item('a1', 'x')], mockSources(), false)
    expect(overlay.handleKey('escape', '')).toBe(true)
    expect(overlay.handleKey('ctrl_c', '')).toBe(true)
  })
})
