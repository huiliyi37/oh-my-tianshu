/**
 * user-message.spec.ts — 用户消息/转向消息导轨渲染 + width 折叠（RED 基线）。
 *
 * 覆盖：首行/后续行导轨制式、空行只保留导轨、长正文按宽度折叠（ASCII/CJK）、
 * 窄宽（导轨占满）不破版、formatUserMessage 的 ascii/truecolor marker 双轨。
 */
import { afterEach, describe, expect, it } from 'vitest'
import chalk from 'chalk'
import { formatRailedMessage, formatUserMessage, formatTimestamp } from '../src/format/user-message.js'
import { wrapToDisplayWidth } from '../src/width.js'
import type { RivetTheme } from '../src/theme.js'

/** 最小主题替身（导轨/正文着色可断言）。 */
const fakeTheme = {
  userColor: '#user',
  assistantColor: '#assistant',
  warning: '#warn',
  secondary: '#secondary',
} as unknown as RivetTheme

function plain(lines: string[]): string[] {
  return lines.map(l => l.replace(/\u001b\[[0-9;]*m/g, ''))
}

describe('wrapToDisplayWidth', () => {
  it('短文本单行返回', () => {
    expect(wrapToDisplayWidth('hello', 10)).toEqual(['hello'])
  })

  it('超宽按显示宽度断行（不吞字符）', () => {
    expect(wrapToDisplayWidth('abcdef', 3)).toEqual(['abc', 'def'])
  })

  it('CJK 双宽字符按显示宽度断行', () => {
    expect(wrapToDisplayWidth('你好世界', 4)).toEqual(['你好', '世界'])
  })

  it('max<=0 返回空数组', () => {
    expect(wrapToDisplayWidth('abc', 0)).toEqual([])
  })

  it('ANSI 转义不计宽且原样保留（断行处补 RESET 防泄漏）', () => {
    const out = wrapToDisplayWidth('\u001b[31mabcdef\u001b[0m', 3)
    // 第一行截断处补 RESET；第二行保留尾部 RESET（原始文本的闭合）
    expect(out).toEqual(['\u001b[31mabc\u001b[0m', 'def\u001b[0m'])
  })

  it('超长单字符（宽字符无法拆分）不无限循环', () => {
    const out = wrapToDisplayWidth('你', 1)
    expect(out).toEqual(['你'])
  })
})

describe('formatRailedMessage 导轨制式', () => {
  it('首行与正文同行，后续行维持导轨', () => {
    const lines = formatRailedMessage({
      content: '第一行\n第二行',
      width: 80,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    expect(plain(lines)).toEqual(['▌ 第一行', '▌ 第二行'])
  })

  it('空行只保留导轨', () => {
    const lines = formatRailedMessage({
      content: 'a\n\nb',
      width: 80,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    expect(plain(lines)).toEqual(['▌ a', '▌', '▌ b'])
  })

  it('长正文按宽度折叠（导轨宽度计入预算）', () => {
    // marker ▌=1 宽 + 空格 = 2；bodyWidth = 10 − 2 = 8
    const lines = formatRailedMessage({
      content: 'abcdefghijklmnop', // 16 字符 → 每行 8
      width: 10,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    expect(plain(lines)).toEqual(['▌ abcdefgh', '▌ ijklmnop'])
  })

  it('CJK 正文按显示宽度折叠', () => {
    const lines = formatRailedMessage({
      content: '你好世界你好世界', // 12 显示宽 → body 8 → 4+4
      width: 10,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    expect(plain(lines)).toEqual(['▌ 你好世界', '▌ 你好世界'])
  })

  it('窄宽（导轨占满）不破版——正文整体一行', () => {
    const lines = formatRailedMessage({
      content: 'abc',
      width: 2,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    // bodyWidth = 2 − 2 = 0 → 退化为不折叠，整行渲染（不破版）
    expect(plain(lines)).toEqual(['▌ abc'])
  })
})

describe('formatUserMessage marker 双轨', () => {
  it('ascii 轨（chalk.level<3）用 ❯，正文带 ANSI 着色', () => {
    const lines = formatRailedMessage({
      content: 'hello',
      width: 80,
      marker: '❯',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    // marker 有 bold 转义；正文有 ANSI 着色前缀（不猜具体码，只断言存在转义）
    expect(lines[0]).toContain('\u001b[')
    expect(plain(lines)[0]).toBe('❯ hello')
  })
})

describe('formatRailedMessage 时间戳投影（/timestamps）', () => {
  const ts = new Date(2026, 7, 10, 14, 32).getTime() // 14:32

  it('提供 timestamp 时首行正文后附 [HH:MM]', () => {
    const lines = formatRailedMessage({
      content: 'hello',
      width: 80,
      marker: '▌',
      markerColor: fakeTheme.userColor,
      timestamp: ts,
    }, fakeTheme)
    expect(plain(lines)[0]).toBe('▌ hello [14:32]')
  })

  it('折叠时时间戳挂在首行最后一块后（宽度预算扣除）', () => {
    const lines = formatRailedMessage({
      content: 'abcdefghijklmnop',
      width: 18, // body = 16；stamp 宽 8 → 首行预算 8
      marker: '▌',
      markerColor: fakeTheme.userColor,
      timestamp: ts,
    }, fakeTheme)
    expect(plain(lines)).toEqual(['▌ abcdefgh [14:32]', '▌ ijklmnop'])
  })

  it('窄宽（放不下时间戳）时隐藏', () => {
    const lines = formatRailedMessage({
      content: 'hello',
      width: 10, // body = 8 < 12 → 隐藏
      marker: '▌',
      markerColor: fakeTheme.userColor,
      timestamp: ts,
    }, fakeTheme)
    expect(plain(lines)[0]).toBe('▌ hello')
  })

  it('无 timestamp 时不渲染时间戳（回归）', () => {
    const lines = formatRailedMessage({
      content: 'hello',
      width: 80,
      marker: '▌',
      markerColor: fakeTheme.userColor,
    }, fakeTheme)
    expect(plain(lines)[0]).toBe('▌ hello')
  })
})

describe('formatUserMessage 直接入口', () => {
  const savedLevel = chalk.level
  afterEach(() => { chalk.level = savedLevel })

  it('ascii 轨（chalk.level<3）：marker 用 ❯', () => {
    chalk.level = 0
    const lines = formatUserMessage({ content: 'hello', width: 80 }, fakeTheme)
    expect(plain(lines)[0]).toBe('❯ hello')
  })

  it('truecolor 轨（chalk.level=3）：marker 用 ▌', () => {
    chalk.level = 3
    const lines = formatUserMessage({ content: 'hello', width: 80 }, fakeTheme)
    expect(plain(lines)[0]).toBe('▌ hello')
  })
})

describe('formatTimestamp', () => {
  it('本地时区 HH:MM，补零', () => {
    const ts = new Date(2026, 7, 10, 14, 32).getTime()
    expect(formatTimestamp(ts)).toBe('[14:32]')
  })
})
