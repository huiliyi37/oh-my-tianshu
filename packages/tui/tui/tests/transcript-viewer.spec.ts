/**
 * TranscriptViewer 单测（T5，/scroll 全屏转录查看器）。
 *
 * 状态机行为：行滚动 clamp、半屏步长、顶/底跳转、[ ] 轮次跳转循环、
 * / 搜索（实时重算跳首个匹配、n/N 循环、Esc 清 query 保持打开）、
 * 折行平面与视口切片、截断提示、空态渲染、未绑定键不消费。
 * 渲染是纯函数（同一状态恒同行序列）；theme 注入固定实例避免环境探测。
 *
 * @module @huiliyi37/dsh-tui/tests/transcript-viewer
 */

import { describe, expect, it } from 'vitest'
import { TranscriptViewer } from '../src/format/transcript-viewer.js'
import { getTheme } from '../src/theme.js'

const THEME = getTheme()

/** 剥 ANSI 后的渲染行（只取内容断言）。 */
function plain(viewer: TranscriptViewer, width = 80, height = 24): string[] {
  return viewer.render(width, height).map(line => line.replace(/\u001b\[[0-9;]*m/g, ''))
}

/** 交替 user/assistant 的 N 轮 fixture。 */
function turns(count: number, assistantPrefix = 'answer'): string {
  const lines: string[] = []
  for (let i = 1; i <= count; i++) {
    lines.push(`▌ question ${i}`, `${assistantPrefix} ${i}`)
  }
  return lines.join('\n')
}

describe('TranscriptViewer — 渲染与滚动', () => {
  it('空内容渲染提示', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent('')
    const lines = plain(viewer)
    expect(lines.some(l => l.includes('📜 transcript'))).toBe(true)
    expect(lines.some(l => l.includes('暂无内容'))).toBe(true)
  })

  it('初始渲染：顶栏消息/行计数 + 正文全量', () => {
    const viewer = new TranscriptViewer(THEME)
    // 解析语义：标记行开启新块，无标记行并入——assistant 文本并入其 user 块。
    viewer.setContent(turns(2))
    const lines = plain(viewer, 80, 24)
    expect(lines[0]).toContain('消息 1/2')
    expect(lines[0]).toContain('行 1/4')
    expect(lines.some(l => l.includes('answer 2'))).toBe(true)
    // 底栏键提示
    expect(lines[lines.length - 1]).toContain('Esc 关闭')
  })

  it('↓/↑ 行滚动 clamp 顶底；j/k 同义', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(5))
    plain(viewer, 80, 6) // 视口 4 行，总 10 行 → maxScroll 6
    for (let i = 0; i < 20; i++) viewer.handleKey('down', '')
    expect(plain(viewer, 80, 6)[0]).toContain('行 7/10')
    viewer.handleKey('', 'k')
    expect(plain(viewer, 80, 6)[0]).toContain('行 6/10')
    for (let i = 0; i < 20; i++) viewer.handleKey('up', '')
    expect(plain(viewer, 80, 6)[0]).toContain('行 1/10')
  })

  it('PageDown/PageUp 半屏步长；Ctrl+U/Ctrl+D 同义', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(10)) // 20 行
    plain(viewer, 80, 12) // 视口 10，半屏 5，maxScroll 10
    viewer.handleKey('pagedown', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 6/20')
    viewer.handleKey('ctrl_d', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 11/20')
    viewer.handleKey('pageup', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 6/20')
    viewer.handleKey('ctrl_u', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 1/20')
  })

  it('g/G 与 home/end 跳顶/跳底（尾页填满视口）', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(10))
    plain(viewer, 80, 12)
    viewer.handleKey('end', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 11/20')
    viewer.handleKey('', 'g')
    expect(plain(viewer, 80, 12)[0]).toContain('行 1/20')
    viewer.handleKey('', 'G')
    expect(plain(viewer, 80, 12)[0]).toContain('行 11/20')
    viewer.handleKey('home', '')
    expect(plain(viewer, 80, 12)[0]).toContain('行 1/20')
  })

  it('长行折行：视口切片命中折行后半段', () => {
    const viewer = new TranscriptViewer(THEME)
    // '▌ ' + 45 个 a = 显示宽 47 → 20 列折成 3 行（20/20/7）
    viewer.setContent(`▌ ${'a'.repeat(45)}`)
    const lines = plain(viewer, 20, 4)
    // 窄终端下顶栏截断到 20 列——只断言可见前缀（正文折行才是本用例主体）。
    expect(lines[0]).toContain('📜 transcript')
    expect(lines[0]).toContain('消息')
    expect(lines[1]).toBe(`▌ ${'a'.repeat(18)}`)
    viewer.handleKey('down', '')
    expect(plain(viewer, 20, 4)[1]).toBe('a'.repeat(20))
    viewer.handleKey('down', '')
    expect(plain(viewer, 20, 4)[1]).toBe('a'.repeat(20)) // clamp：maxScroll=1，第三段与第二段同帧可见
    expect(plain(viewer, 20, 4)[2]).toBe('a'.repeat(7))
  })

  it('截断提示：truncated 时顶栏显示上限', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(1), { truncated: true, maxLines: 1000 })
    expect(plain(viewer)[0]).toContain('仅显示最近 1000 行')
  })

  it('未绑定键不消费且不改状态', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(5))
    plain(viewer, 80, 6)
    expect(viewer.handleKey('', 'x')).toBe(false)
    expect(plain(viewer, 80, 6)[0]).toContain('行 1/10')
  })

  it('setContent 重置全部状态（滚动/搜索）', () => {
    const viewer = new TranscriptViewer(THEME)
    viewer.setContent(turns(5))
    plain(viewer, 80, 6)
    viewer.handleKey('end', '')
    viewer.handleKey('', '/')
    viewer.handleKey('', 'q')
    viewer.setContent(turns(2))
    expect(viewer.isSearchMode()).toBe(false)
    expect(plain(viewer, 80, 6)[0]).toContain('行 1/4')
  })
})

describe('TranscriptViewer — 轮次跳转与搜索', () => {
  it('[ ] 上一/下一轮循环（user 消息起点）', () => {
    const viewer = new TranscriptViewer(THEME)
    // 3 轮 = 3 个 user 块（assistant 行并入各自 user 块），共 6 行。
    viewer.setContent(turns(3))
    plain(viewer, 80, 4) // 视口 2，总 6 → maxScroll 4
    viewer.handleKey('', ']')
    expect(plain(viewer, 80, 4)[0]).toContain('消息 2/3')
    viewer.handleKey('', ']')
    expect(plain(viewer, 80, 4)[0]).toContain('消息 3/3')
    viewer.handleKey('', ']') // 循环回首轮
    expect(plain(viewer, 80, 4)[0]).toContain('消息 1/3')
    viewer.handleKey('', '[') // 上一轮绕回末轮
    expect(plain(viewer, 80, 4)[0]).toContain('消息 3/3')
  })

  it('/ 进搜索：字符累积实时跳首个匹配；空匹配 0/0', () => {
    const viewer = new TranscriptViewer(THEME)
    const content = ['▌ q1', 'alpha here', '▌ q2', 'second', '▌ q3', 'also alpha'].join('\n')
    viewer.setContent(content)
    plain(viewer, 80, 4)
    viewer.handleKey('', '/')
    expect(viewer.isSearchMode()).toBe(true)
    viewer.handleKey('', 'a')
    viewer.handleKey('', 'l')
    viewer.handleKey('', 'p')
    const header = plain(viewer, 80, 4)[0]
    expect(header).toContain('/alp 命中 1/2')
    expect(header).toContain('消息 1/3')
    // 空匹配
    viewer.handleKey('', 'z')
    expect(plain(viewer, 80, 4)[0]).toContain('/alpz 命中 0/0')
  })

  it('n/N 循环下一/上一匹配；Enter=n；Esc 清 query 保持打开', () => {
    const viewer = new TranscriptViewer(THEME)
    const content = ['▌ q1', 'alpha one', '▌ q2', 'alpha two'].join('\n')
    viewer.setContent(content)
    plain(viewer, 80, 4)
    viewer.handleKey('', '/')
    viewer.handleKey('', 'a')
    viewer.handleKey('', 'l')
    viewer.handleKey('', 'p') // 跳首个匹配（块 1）
    expect(plain(viewer, 80, 4)[0]).toContain('消息 1/2')
    viewer.handleKey('', 'n')
    expect(plain(viewer, 80, 4)[0]).toContain('消息 2/2')
    viewer.handleKey('', 'n') // 循环回首个
    expect(plain(viewer, 80, 4)[0]).toContain('消息 1/2')
    viewer.handleKey('', 'N') // 上一 → 绕回末个
    expect(plain(viewer, 80, 4)[0]).toContain('消息 2/2')
    viewer.handleKey('escape', '')
    expect(viewer.isSearchMode()).toBe(false)
    expect(plain(viewer, 80, 4)[0]).not.toContain('/alp')
  })
})
