/**
 * 动态 spinner 状态行（format/spinner-status.ts）— 纯渲染契约测试。
 *
 * - idle 返回 null（不占位）；其余相位返回单行 LiveRegionLine。
 * - 动词池按 elapsed 时间片轮换（纯函数，无全局状态）；reducedMotion 冻结为池首。
 * - approvalWait 显示「等待审批 <tool> · Ns」而不是冒充模型活动。
 */

import { describe, expect, it } from 'vitest'
import type { RivetTheme } from '../src/theme.js'
import {
  DEFAULT_SPINNER_VERBS,
  VERB_ROTATE_MS,
  formatElapsedHuman,
  formatSpinnerStatus,
  verbForElapsed,
  type SpinnerPhase,
  type SpinnerStatusInput,
} from '../src/format/spinner-status.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(lines: readonly string[]): string[] {
  return lines.map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

function base(over: Partial<SpinnerStatusInput> = {}): SpinnerStatusInput {
  return { tick: 0, phase: 'thinking', elapsedMs: 0, ...over }
}

describe('formatElapsedHuman', () => {
  it('<60s：纯秒', () => {
    expect(formatElapsedHuman(0)).toBe('0s')
    expect(formatElapsedHuman(30_000)).toBe('30s')
  })
  it('>=60s：分+秒', () => {
    expect(formatElapsedHuman(90_000)).toBe('1m 30s')
    expect(formatElapsedHuman(3_605_000)).toBe('60m 5s')
  })
  it('负数按 0 处理', () => {
    expect(formatElapsedHuman(-1000)).toBe('0s')
  })
})

describe('verbForElapsed（纯函数词池轮换）', () => {
  it('默认池：elapsed 时间片内取同一词，跨片轮换', () => {
    const v0 = verbForElapsed(0, DEFAULT_SPINNER_VERBS)
    const vSame = verbForElapsed(VERB_ROTATE_MS - 1, DEFAULT_SPINNER_VERBS)
    expect(vSame).toBe(v0)
    const vNext = verbForElapsed(VERB_ROTATE_MS, DEFAULT_SPINNER_VERBS)
    expect(vNext).not.toBe(v0)
  })
  it('一个词的池恒返回该词', () => {
    expect(verbForElapsed(123_456, ['干活中'])).toBe('干活中')
  })
  it('reducedMotion 冻结为池首', () => {
    expect(verbForElapsed(VERB_ROTATE_MS * 3, DEFAULT_SPINNER_VERBS, true)).toBe(DEFAULT_SPINNER_VERBS[0])
  })
})

describe('formatSpinnerStatus', () => {
  it('idle 返回 null（不占位）', () => {
    expect(formatSpinnerStatus(base({ phase: 'idle' }), fakeTheme())).toBeNull()
  })

  it('thinking：frame + 动词… + 耗时', () => {
    const lines = formatSpinnerStatus(base({ tick: 0, elapsedMs: 5_000 }), fakeTheme())
    expect(lines).not.toBeNull()
    const text = plain(lines!.map(l => l.text))[0]!
    expect(text).toMatch(/⠋ .*… 5s/)
  })

  it('approvalWait：如实显示等待审批', () => {
    const lines = formatSpinnerStatus(
      base({ phase: 'waiting', approvalWait: { toolName: 'bash', waitMs: 30_000 } }),
      fakeTheme(),
    )
    const text = plain(lines!.map(l => l.text))[0]!
    expect(text).toContain('等待审批 bash')
    expect(text).toContain('30s')
  })

  it('stalled：整行转警告（文本仍含动词）', () => {
    const lines = formatSpinnerStatus(base({ stalled: true, elapsedMs: 12_000 }), fakeTheme())
    expect(plain(lines!.map(l => l.text))[0]).toContain('…')
  })

  it('reducedMotion：frame 静态化', () => {
    const lines = formatSpinnerStatus(base({ reducedMotion: true, tick: 1 }), fakeTheme())
    expect(plain(lines!.map(l => l.text))[0]).toContain('◐')
  })

  it('ascii：frame 用 -\\|/ 四帧', () => {
    const frames = [0, 1, 2, 3].map((t) => {
      const lines = formatSpinnerStatus(base({ tick: t, ascii: true }), fakeTheme())
      return plain(lines!.map(l => l.text))[0]!.charAt(0)
    })
    expect(frames).toEqual(['-', '\\', '|', '/'])
  })

  it('自定义动词池覆盖默认池', () => {
    const lines = formatSpinnerStatus(base({ verbs: ['巡天中'] }), fakeTheme())
    expect(plain(lines!.map(l => l.text))[0]).toContain('巡天中')
  })

  it('空动词池回退默认池', () => {
    const lines = formatSpinnerStatus(base({ verbs: [] }), fakeTheme())
    expect(plain(lines!.map(l => l.text))[0]).toContain(DEFAULT_SPINNER_VERBS[0])
  })

  it('所有相位均渲染不抛错（色板映射全覆盖）', () => {
    const phases: SpinnerPhase[] = ['thinking', 'streaming', 'waiting', 'analyzing']
    for (const phase of phases) {
      const lines = formatSpinnerStatus(base({ phase, elapsedMs: 1_000 }), fakeTheme())
      expect(lines).not.toBeNull()
      expect(lines!.length).toBe(1)
    }
  })

  it('tick 为 NaN：frames[idx] undefined 回退静态帧（ascii/braille 双轨）', () => {
    const ascii = formatSpinnerStatus(base({ tick: NaN, ascii: true }), fakeTheme())
    expect(plain(ascii!.map(l => l.text))[0]).toMatch(/^-/)
    const braille = formatSpinnerStatus(base({ tick: NaN }), fakeTheme())
    expect(plain(braille!.map(l => l.text))[0]).toMatch(/^⠋/)
  })

  it('verbs 数组首位为 undefined：verbForElapsed 回退默认池首（防御分支）', () => {
    const undefinedFirst = [undefined as unknown as string, 'x']
    expect(verbForElapsed(0, undefinedFirst)).toBe('思考中')
    // pool[idx] undefined → ?? first 回退
    expect(verbForElapsed(VERB_ROTATE_MS, ['a', undefined as unknown as string])).toBe('a')
  })
})
