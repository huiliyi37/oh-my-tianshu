/**
 * 底部 footer（format/prompt-footer.ts）— 纯渲染契约测试（C4 概念稿 C 三行底部区）。
 *
 * - 模式 badge 段（normal / [plan] / [plan…] / [auto]）在前，快捷键提示在后。
 * - 空闲态提示按 FOOTER_TIPS 权重表 10s 轮播（tipIndex 注入保证确定性）；
 *   审批/忙碌/换行模式等上下文态固定操作提示不轮播。
 * - 窄宽从后往前丢段（轮播 tip 整条丢弃），mode 恒保留（Enter 发送不提示）。
 * - 宽度守恒：任何输入下每行显示宽度 ≤ width。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { displayWidth } from '../src/width.js'
import {
  FOOTER_TIP_ROTATE_MS,
  FOOTER_TIPS,
  footerTipForIndex,
  footerTipIndex,
  formatPromptFooter,
  type FormatPromptFooterInput,
} from '../src/format/prompt-footer.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

/** 权重展开序列长度（= 轮播周期；与实现内 TIP_SEQUENCE 一致）。 */
const TIP_LENGTH = FOOTER_TIPS.reduce((n, t) => n + t.weight, 0)

function plain(lines: readonly string[]): string[] {
  return lines.map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

function base(over: Partial<FormatPromptFooterInput> = {}): FormatPromptFooterInput {
  // tipIndex 0 固定为第一条轮播提示——测试确定性。
  return { width: 100, tipIndex: 0, ...over }
}

describe('formatPromptFooter', () => {
  it('默认：normal + 轮播首位提示（基础操作集，Enter 发送不提示）', () => {
    const [line = ''] = plain(formatPromptFooter(base(), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).not.toContain('Enter 发送')
    expect(line).toContain('/ 命令')
    expect(line).toContain('ctrl+j')
    expect(line).toContain('ctrl+p')
  })

  it('空闲提示随 tipIndex 轮播（权重展开序列取模）', () => {
    // 序号扫过整个展开序列：所有表内 tip 都会出现
    const seen = new Set<string>()
    for (let i = 0; i < TIP_LENGTH; i++) seen.add(footerTipForIndex(i))
    for (const t of FOOTER_TIPS) expect(seen.has(t.text), t.text).toBe(true)
    // 负序号按模归一；权重展开长度即周期
    expect(footerTipForIndex(-1)).toBe(footerTipForIndex(TIP_LENGTH - 1))
    // 高权重 tip 在展开序列中出现更多次
    const heavy = FOOTER_TIPS[0]
    if (heavy === undefined) throw new Error('FOOTER_TIPS empty')
    const occurrences = Array.from({ length: TIP_LENGTH }, (_, i) => footerTipForIndex(i))
      .filter(t => t === heavy.text).length
    expect(occurrences).toBe(heavy.weight)
  })

  it('footerTipIndex：按 FOOTER_TIP_ROTATE_MS 分片', () => {
    expect(footerTipIndex(0)).toBe(0)
    expect(footerTipIndex(FOOTER_TIP_ROTATE_MS)).toBe(1)
    expect(footerTipIndex(FOOTER_TIP_ROTATE_MS * 7 + 123)).toBe(7)
  })

  it('planActive：mode 段含 [plan]', () => {
    const [line = ''] = plain(formatPromptFooter(base({ planActive: true }), fakeTheme()))
    expect(line).toContain('normal [plan]')
  })

  it('planPending：mode 段含 [plan…]（优先于 planActive）', () => {
    const [line = ''] = plain(formatPromptFooter(base({ planActive: true, planPending: true }), fakeTheme()))
    expect(line).toContain('[plan…]')
    expect(line).not.toContain('[plan] ·')
  })

  it('approvalPending：快捷键换成 y/n/a/esc', () => {
    const [line = ''] = plain(formatPromptFooter(base({ approvalPending: true }), fakeTheme()))
    expect(line).toContain('y 允许')
    expect(line).toContain('n 拒绝')
    expect(line).toContain('a 放行')
    expect(line).not.toContain('Enter 发送')
  })

  it('宽度守恒：任意宽度下每行显示宽度 ≤ width', () => {
    for (const width of [100, 80, 60, 40, 20]) {
      const lines = formatPromptFooter(base({ width }), fakeTheme())
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(width)
      }
    }
  })

  it('窄宽丢段：mode 恒保留，轮播提示整条丢弃', () => {
    // width 12：mode 段（normal=6）放得下，轮播 tip 整条丢弃
    const [line = ''] = plain(formatPromptFooter(base({ width: 12 }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).not.toContain('ctrl+p')
    // width 20：锚位 tip（30 列）放不下 → 整条丢弃，只留 mode
    const [mid = ''] = plain(formatPromptFooter(base({ width: 20 }), fakeTheme()))
    expect(mid).toContain('normal')
    expect(mid).not.toContain('/ 命令')
    expect(mid).not.toContain('Enter 发送')
    // 短 tip（'ctrl+o 展开推理'）放得下：6+3+13=22 ≥ 22 → 可见
    const shortIdx = Array.from({ length: TIP_LENGTH }, (_, i) => i)
      .find(i => footerTipForIndex(i).startsWith('ctrl+o'))
    if (shortIdx === undefined) throw new Error('no ctrl+o tip in table')
    const [short = ''] = plain(formatPromptFooter(base({ width: 24, tipIndex: shortIdx }), fakeTheme()))
    expect(short).toContain('ctrl+o')
  })

  it('极窄（mode 段也放不下）：退化为 mode 单段（mode 恒保留）', () => {
    const [line = ''] = plain(formatPromptFooter(base({ width: 5 }), fakeTheme()))
    expect(line).toBe('normal')
  })

  it('宽终端：右侧状态段右对齐合并进同一行', () => {
    const [line = ''] = plain(formatPromptFooter(base({
      width: 100,
      rightSegments: ['12.3k', 'deepseek-chat', 'API ✓'],
    }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('deepseek-chat')
    expect(line).toContain('API ✓')
    // 左侧在前、右侧在后（右对齐）
    expect(line.indexOf('normal')).toBeLessThan(line.indexOf('deepseek-chat'))
    expect(displayWidth(line)).toBe(100)
  })

  it('右侧段放不下：从后往前丢段，末尾段先丢', () => {
    const [narrow = ''] = plain(formatPromptFooter(base({
      width: 80,
      rightSegments: ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'II', 'JJ', 'KK'],
    }), fakeTheme()))
    expect(narrow).toContain('normal')
    expect(narrow).toContain('AA')
    expect(narrow).not.toContain('KK')
    expect(narrow).not.toContain('AA · BB · CC · DD · EE · FF · GG · HH · II · JJ · KK')
  })

  it('任意宽度：右侧段合并进同一行，不另起第二行', () => {
    const lines = formatPromptFooter(base({
      width: 79,
      rightSegments: ['deepseek-chat', 'effort:high'],
    }), fakeTheme())
    expect(lines).toHaveLength(1)
    const [line = ''] = plain(lines)
    expect(line).toContain('normal')
    expect(line).toContain('deepseek-chat')
    expect(displayWidth(lines[0] ?? '')).toBe(79)
  })

  it('窄宽仍从右丢段，左侧与右侧同处一行（轮播 tip 整条不截断）', () => {
    // 短 tip（'ctrl+o 展开推理' 13 列）注入：左段 = normal · tip = 22 列；
    // width 33 → 右段 'AA · BB · CC'(12) 放不下，从后丢 CC 保 AA·BB。
    const shortIdx = Array.from({ length: TIP_LENGTH }, (_, i) => i)
      .find(i => footerTipForIndex(i).startsWith('ctrl+o'))
    if (shortIdx === undefined) throw new Error('no ctrl+o tip in table')
    const lines = formatPromptFooter(base({
      width: 33,
      tipIndex: shortIdx,
      rightSegments: ['AA', 'BB', 'CC'],
    }), fakeTheme())
    expect(lines).toHaveLength(1)
    const [line = ''] = plain(lines)
    expect(line).toContain('normal')
    expect(line).toContain('ctrl+o')
    expect(line).toContain('AA')
    expect(line).not.toContain('CC')
  })

  it('右侧段恰好填满：pad=0 仍合并，不丢末段', () => {
    // 新 hint 集左侧满档 `normal · / 命令 · ctrl+j 换行 · ctrl+p 面板` = 43 列；
    // width 55 → 右段 12 列恰好 pad=0 合并。
    const [line = ''] = plain(formatPromptFooter(base({
      width: 55,
      rightSegments: ['xxxxxxxxxxxx'],
    }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('xxxxxxxxxxxx')
    expect(displayWidth(formatPromptFooter(base({
      width: 55,
      rightSegments: ['xxxxxxxxxxxx'],
    }), fakeTheme())[0] ?? '')).toBe(55)
  })

  it('空右侧段：与缺省行为一致', () => {
    const [line = ''] = plain(formatPromptFooter(base({ width: 100, rightSegments: [] }), fakeTheme()))
    expect(line).toContain('normal')
    expect(line).toContain('/ 命令')
    expect(line).not.toContain('Enter 发送')
  })

  it('雾蓝 chrome：mode 用 inactiveShimmer，提示用 subtle', () => {
    const [line = ''] = formatPromptFooter(base(), fakeTheme())
    expect(line).toContain('\x1B[38;2;170;178;194m')
    expect(line).toContain('\x1B[38;2;94;102;115m')
    expect(line).not.toContain('\x1B[38;2;17;17;17m')
  })

  it('agentBusy：提示 esc/ctrl+c 打断', () => {
    const [line = ''] = plain(formatPromptFooter(base({ agentBusy: true }), fakeTheme()))
    expect(line).toContain('esc 打断')
    expect(line).toContain('ctrl+c 打断')
    expect(line).not.toContain('/ 命令')
  })

  it('newlineMode：提示换行中', () => {
    const [line = ''] = plain(formatPromptFooter(base({ newlineMode: true }), fakeTheme()))
    expect(line).toContain('换行中')
    expect(line).toContain('enter 换行')
    expect(line).toContain('shift+enter 退出')
    expect(line).toContain('pgup 翻页')
  })
})
