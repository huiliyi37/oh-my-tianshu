/**
 * term-caps.spec.ts — 终端能力探测（P1-1-3 OSC52 支持启发式）。
 *
 * supportsOsc52：白名单 TERM_PROGRAM 优先；Apple Terminal 显式排除
 * （macOS Terminal.app 不写 OSC52）；其余按 TERM 兼容性启发式。
 */
import { describe, expect, it } from 'vitest'
import { supportsOsc52 } from '../src/term-caps.js'

describe('supportsOsc52', () => {
  it('Apple Terminal 不支持（即使 TERM 是 xterm 兼容）', () => {
    expect(supportsOsc52({ TERM_PROGRAM: 'Apple_Terminal', TERM: 'xterm-256color' })).toBe(false)
  })

  it('已知支持 OSC52 的终端程序白名单', () => {
    for (const prog of ['iTerm.app', 'WezTerm', 'kitty', 'Hyper', 'vscode']) {
      expect(supportsOsc52({ TERM_PROGRAM: prog, TERM: 'xterm-256color' })).toBe(true)
    }
  })

  it('无 TERM_PROGRAM 时按 TERM 启发式（xterm/screen/tmux 兼容）', () => {
    expect(supportsOsc52({ TERM: 'xterm-256color' })).toBe(true)
    expect(supportsOsc52({ TERM: 'screen-256color' })).toBe(true)
    expect(supportsOsc52({ TERM: 'tmux-256color' })).toBe(true)
  })

  it('VTE 系终端（gnome-terminal 等，TERM=xterm 兼容）不支持', () => {
    expect(supportsOsc52({ TERM: 'xterm-256color', VTE_VERSION: '6800' })).toBe(false)
  })

  it('GNU screen（STY 会话变量）不支持', () => {
    expect(supportsOsc52({ TERM: 'screen-256color', STY: '1234.pts-0.tty' })).toBe(false)
  })

  it('内核 VT（TERM=linux）不支持', () => {
    expect(supportsOsc52({ TERM: 'linux' })).toBe(false)
  })

  it('未知/受限终端按不支持处理（dumb、空 env）', () => {
    expect(supportsOsc52({ TERM: 'dumb' })).toBe(false)
    expect(supportsOsc52({})).toBe(false)
  })
})
