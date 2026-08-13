/**
 * format/steer-message.ts — 转向消息导轨渲染契约测试。
 *
 * marker 双轨：chalk.level<3 → `>>`；truecolor → `➤`，均 warning 色 + bold。
 * 正文渲染复用 formatRailedMessage（user-message.spec.ts 已覆盖折叠/时间戳）。
 */

import chalk from 'chalk'
import { afterEach, describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import { formatSteerMessage } from '../src/format/steer-message.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(lines: string[]): string[] {
  return lines.map(l => l.replace(/\u001b\[[0-9;]*m/g, ''))
}

let savedLevel: typeof chalk.level

afterEach(() => {
  chalk.level = savedLevel
})

describe('formatSteerMessage', () => {
  it('ascii 轨（chalk.level<3）：marker 用 >>，正文中性色', () => {
    savedLevel = chalk.level
    chalk.level = 0
    const lines = formatSteerMessage({ content: '换个方向', width: 40 }, fakeTheme())
    expect(plain(lines)[0]).toBe('>> 换个方向')
  })

  it('truecolor 轨（chalk.level=3）：marker 用 ➤', () => {
    savedLevel = chalk.level
    chalk.level = 3
    const lines = formatSteerMessage({ content: '换个方向', width: 40 }, fakeTheme())
    expect(plain(lines)[0]).toBe('➤ 换个方向')
  })

  it('多行：后续行维持同一 marker', () => {
    savedLevel = chalk.level
    chalk.level = 0
    const lines = formatSteerMessage({ content: 'a\nb', width: 40 }, fakeTheme())
    expect(plain(lines)).toEqual(['>> a', '>> b'])
  })

  it('带时间戳：首行正文后附 [HH:MM]', () => {
    savedLevel = chalk.level
    chalk.level = 0
    const ts = new Date(2026, 7, 10, 14, 32).getTime()
    const lines = formatSteerMessage({ content: 'hello', width: 80, timestamp: ts }, fakeTheme())
    expect(plain(lines)[0]).toBe('>> hello [14:32]')
  })
})
