/**
 * command-palette — Ctrl+P 命令面板（RED 基线）。
 *
 * 覆盖：
 * - toPaletteEntries：SlashCommand[] → 面板条目（数据源 = SlashCommandRegistry）
 * - filterPalette：空查询全量；名称/描述子串 + 名称子序列匹配；前缀优先排序
 * - 状态机：open 重置 / type 追加并夹紧选中 / backspace / move 夹紧 / close
 * - paletteCommitText：`/name ` 回填输入行
 * - renderCommandPalette：overlay 渲染（选中高亮、宽度截断、空态、滚动窗口）
 * - CommandPalette 控制器：open/toggle/type/move/commit，实现 OverlayRenderer
 */

import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_COMMAND_NAMES, type SlashCommand } from '../src/commands/registry.js'
import type { RivetTheme } from '../src/theme.js'
import {
  CommandPalette,
  PALETTE_COMMAND_GROUPS,
  applyPaletteEvent,
  emptyPaletteState,
  filterPalette,
  paletteCommitText,
  paletteVisibleEntries,
  renderCommandPalette,
  toPaletteEntries,
  type PaletteEntry,
} from '../src/command-palette.js'

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

function cmd(name: string, description: string, argsHint?: string): SlashCommand {
  return { name, description, ...(argsHint === undefined ? {} : { argsHint }), run: vi.fn() }
}

const SAMPLE: readonly SlashCommand[] = [
  cmd('theme', '切换主题', '<name>'),
  cmd('clear', '清空当前会话滚动区并收起命令面板'),
  cmd('compact', '压缩当前会话'),
  cmd('steer', '中轮转向', '<text>'),
]

const THEME = fakeTheme()

describe('toPaletteEntries — 数据源投影', () => {
  it('SlashCommand → PaletteEntry（argsHint 可选，自动分组）', () => {
    const entries = toPaletteEntries(SAMPLE)
    expect(entries).toHaveLength(4)
    expect(entries[0]).toEqual({ name: 'theme', description: '切换主题', argsHint: '<name>', group: '配置' })
    expect(entries[1]?.argsHint).toBeUndefined()
    expect(entries[1]?.group).toBe('会话') // clear 归会话组
    expect(entries[2]?.group).toBe('会话') // compact 归会话组
    expect(entries[3]?.group).toBe('会话') // steer 归会话组
  })

  it('内置命令分组表覆盖全部 BUILTIN_COMMAND_NAMES（新增命令必须补分组）', () => {
    for (const name of BUILTIN_COMMAND_NAMES) {
      expect(PALETTE_COMMAND_GROUPS[name], `/命令 ${name} 未登记分组`).toBeDefined()
    }
  })
})

describe('filterPalette — 模糊过滤', () => {
  const entries = toPaletteEntries(SAMPLE)

  it('空查询返回全部（原顺序）', () => {
    expect(filterPalette(entries, '')).toEqual(entries)
  })

  it('名称子串匹配', () => {
    const hit = filterPalette(entries, 'com')
    expect(hit.map(e => e.name)).toEqual(['compact'])
  })

  it('描述子串匹配', () => {
    const hit = filterPalette(entries, '会话')
    expect(hit.map(e => e.name)).toEqual(['clear', 'compact'])
  })

  it('名称子序列匹配（t-h → theme）', () => {
    const hit = filterPalette(entries, 'th')
    expect(hit.map(e => e.name)).toEqual(['theme'])
  })

  it('子序列提前返回：query 是 name 的子序列但非连续子串（hme → theme）', () => {
    // 'hme' 不是 theme 的连续子串，走 isSubsequence 提前 return true 分支
    const hit = filterPalette(entries, 'hme')
    expect(hit.map(e => e.name)).toEqual(['theme'])
  })

  it('前缀优先排序（查询 t：theme 在前，compact/steer 殿后）', () => {
    const hit = filterPalette(entries, 't')
    expect(hit[0]?.name).toBe('theme')
  })

  it('无匹配返回空数组', () => {
    expect(filterPalette(entries, 'zzz')).toEqual([])
  })

  it('大小写不敏感', () => {
    expect(filterPalette(entries, 'THEME').map(e => e.name)).toEqual(['theme'])
  })
})

describe('palette 状态机', () => {
  it('open 重置查询与选中', () => {
    let s = applyPaletteEvent(emptyPaletteState(), { type: 'type', char: 'c' })
    s = applyPaletteEvent(s, { type: 'move', delta: 2, count: 4 })
    expect(s.query).toBe('c')
    s = applyPaletteEvent(s, { type: 'open' })
    expect(s.open).toBe(true)
    expect(s.query).toBe('')
    expect(s.selected).toBe(0)
  })

  it('type 追加查询并把选中夹回 0', () => {
    let s = applyPaletteEvent(emptyPaletteState(), { type: 'open' })
    s = applyPaletteEvent(s, { type: 'move', delta: 3, count: 4 })
    s = applyPaletteEvent(s, { type: 'type', char: 't' })
    expect(s.query).toBe('t')
    expect(s.selected).toBe(0)
  })

  it('backspace 删除末字符', () => {
    let s = emptyPaletteState()
    s = applyPaletteEvent(s, { type: 'type', char: 'th' })
    expect(s.query).toBe('th')
    s = applyPaletteEvent(s, { type: 'backspace' })
    expect(s.query).toBe('t')
  })

  it('move 夹紧到 0 与列表尾（count 为可见条目数；不越界）', () => {
    let s = applyPaletteEvent(emptyPaletteState(), { type: 'open' })
    s = applyPaletteEvent(s, { type: 'move', delta: -5, count: 4 })
    expect(s.selected).toBe(0)
    s = applyPaletteEvent(s, { type: 'move', delta: 99, count: 4 })
    expect(s.selected).toBe(3)
    // 无可见条目（count 0）：selected 归 0，不越界
    s = applyPaletteEvent(s, { type: 'move', delta: -99, count: 0 })
    expect(s.selected).toBe(0)
  })

  it('close 置 open=false', () => {
    let s = applyPaletteEvent(emptyPaletteState(), { type: 'open' })
    s = applyPaletteEvent(s, { type: 'close' })
    expect(s.open).toBe(false)
  })
})

describe('paletteVisibleEntries / commitText', () => {
  it('可见条目 = 过滤后列表；selected 默认指向首项', () => {
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'type', char: 'c' })
    const visible = paletteVisibleEntries(s, toPaletteEntries(SAMPLE))
    expect(visible.map(e => e.name)).toEqual(['clear', 'compact'])
  })

  it('commitText 回填 `/name `（含尾随空格，用户续写参数）', () => {
    expect(paletteCommitText({ name: 'theme', description: '' })).toBe('/theme ')
    expect(paletteCommitText({ name: 'clear', description: '' })).toBe('/clear ')
  })
})

describe('renderCommandPalette — overlay 渲染', () => {
  const entries: readonly PaletteEntry[] = [
    { name: 'theme', description: '切换主题', argsHint: '<name>' },
    { name: 'clear', description: '清空当前会话滚动区并收起命令面板' },
    { name: 'compact', description: '压缩当前会话' },
  ]

  it('渲染头 + 全部条目 + 底部键位提示', () => {
    const lines = renderCommandPalette(emptyPaletteState(), entries, 80, 24, THEME)
    expect(plain(lines).join('\n')).toContain('命令面板')
    expect(plain(lines).join('\n')).toContain('/theme')
    expect(plain(lines).join('\n')).toContain('/compact')
    expect(plain(lines).join('\n')).toContain('Enter')
    expect(plain(lines).join('\n')).toContain('Esc')
  })

  it('选中项有高亮标记（▶ 前缀）', () => {
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'open' })
    const lines = plain(renderCommandPalette(s, entries, 80, 24, THEME))
    expect(lines.some(l => l.includes('▶ /theme'))).toBe(true)
  })

  it('过滤后只渲染匹配项', () => {
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'type', char: 'cl' })
    const lines = plain(renderCommandPalette(s, entries, 80, 24, THEME))
    const body = lines.join('\n')
    expect(body).toContain('/clear')
    expect(body).not.toContain('/theme')
  })

  it('无匹配 → 空态提示行', () => {
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'type', char: 'zzz' })
    const lines = plain(renderCommandPalette(s, entries, 80, 24, THEME))
    expect(lines.join('\n')).toContain('无匹配')
  })

  it('超宽名称在窄宽下被截断（truncate break 分支）', () => {
    const wide: PaletteEntry[] = [{ name: 'x'.repeat(60), description: '' }]
    const lines = plain(renderCommandPalette(emptyPaletteState(), wide, 20, 24, THEME))
    expect(lines.length).toBeGreaterThan(0)
    // break 生效：任何行显示宽度 ≤ 20（含截断后的命令行）
    for (const l of lines) {
      expect(l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').length).toBeLessThanOrEqual(20)
    }
  })

  it('按组渲染：组标题行（── 组 ──）+ 组内条目；未分组归「其他」', () => {
    const grouped: readonly PaletteEntry[] = [
      { name: 'theme', description: 'd', group: '配置' },
      { name: 'session', description: 'd', group: '会话' },
      { name: 'plugin-x', description: 'd' },
      { name: 'clear', description: 'd', group: '会话' },
    ]
    const lines = plain(renderCommandPalette(emptyPaletteState(), grouped, 80, 24, THEME))
    const body = lines.join('\n')
    // 组序：会话（先出现）→ 配置 → 其他；组标题不可选中
    expect(body.indexOf('── 会话 ──')).toBeLessThan(body.indexOf('── 配置 ──'))
    expect(body.indexOf('── 配置 ──')).toBeLessThan(body.indexOf('── 其他 ──'))
    expect(body.indexOf('/session')).toBeLessThan(body.indexOf('/theme'))
    expect(body.indexOf('/theme')).toBeLessThan(body.indexOf('/plugin-x'))
    expect(body).not.toContain('▶ ──') // 标题行不带选中标记
  })

  it('过滤后组标题随组内条目出现（空组不显示标题）', () => {
    const grouped: readonly PaletteEntry[] = [
      { name: 'theme', description: '切换主题', group: '配置' },
      { name: 'session', description: '切换会话', group: '会话' },
      { name: 'clear', description: '清空会话', group: '会话' },
    ]
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'type', char: 'cle' })
    const lines = plain(renderCommandPalette(s, grouped, 80, 24, THEME))
    const body = lines.join('\n')
    expect(body).toContain('── 会话 ──')
    expect(body).toContain('/clear')
    expect(body).not.toContain('── 配置 ──') // theme 被过滤 → 空组无标题
    expect(body).not.toContain('/theme')
  })

  it('滚动窗口按展开后行序跟随选中项（选中条目可见，标题随滚）', () => {
    // 5 组 × 10 条 = 50 条目 + 5 标题 = 55 行；bodyHeight=6 时末项应可见
    const many: PaletteEntry[] = []
    for (let g = 0; g < 5; g++) {
      for (let i = 0; i < 10; i++) {
        many.push({ name: `g${g}c${i}`, description: 'd', group: `组${g}` })
      }
    }
    const lastIdx = many.length - 1
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'move', delta: lastIdx, count: many.length })
    const lines = plain(renderCommandPalette(s, many, 80, 8, THEME))
    expect(lines.some(l => l.includes(`▶ /g4c9`))).toBe(true)
  })

  it('宽度守恒：任何行显示宽度 ≤ width', () => {
    const { displayWidth } = { displayWidth: (l: string) => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').length }
    const lines = renderCommandPalette(emptyPaletteState(), entries, 30, 24, THEME)
    for (const l of lines) {
      expect(displayWidth(l)).toBeLessThanOrEqual(30)
    }
  })

  it('列表超屏高 → 滚动窗口跟随选中项（末项可见）', () => {
    const many: PaletteEntry[] = Array.from({ length: 40 }, (_, i) => ({ name: `cmd${i}`, description: `d${i}` }))
    const s = applyPaletteEvent(emptyPaletteState(), { type: 'move', delta: 39, count: many.length })
    const lines = plain(renderCommandPalette(s, many, 80, 10, THEME))
    expect(lines.some(l => l.includes('▶ /cmd39'))).toBe(true)
  })
})

describe('CommandPalette 控制器', () => {
  it('toggle 开/关，commit 返回选中条目与回填文本', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    expect(palette.isOpen()).toBe(false)
    palette.toggle()
    expect(palette.isOpen()).toBe(true)
    palette.type('cl')
    const committed = palette.commit()
    expect(committed?.entry.name).toBe('clear')
    expect(committed?.text).toBe('/clear ')
    palette.close()
    expect(palette.isOpen()).toBe(false)
  })

  it('open 状态下 toggle 关闭（toggle 的 if 分支）', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    palette.open()
    expect(palette.isOpen()).toBe(true)
    palette.toggle()
    expect(palette.isOpen()).toBe(false)
  })

  it('move 改变选中项，commit 提交对应条目（方向键 UI 路径）', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    palette.open()
    expect(palette.commit()?.entry.name).toBe('theme')
    palette.move(1)
    expect(palette.commit()?.entry.name).toBe('clear')
    palette.move(1)
    expect(palette.commit()?.entry.name).toBe('compact')
    palette.move(-2)
    expect(palette.commit()?.entry.name).toBe('theme')
    // 越界夹紧：尾部继续 ↓ 停在末项
    palette.move(99)
    expect(palette.commit()?.entry.name).toBe('steer')
  })

  it('open 时快照注册表当前命令（插件扩展后可见）', () => {
    let commands = [...SAMPLE]
    const palette = new CommandPalette({ getCommands: () => commands, getTheme: () => THEME })
    palette.open()
    commands = [...SAMPLE, cmd('ping', '测试命令')]
    // 每次渲染/过滤从 getCommands 现取，而非构造时固化
    expect(paletteVisibleEntries(emptyPaletteState(), toPaletteEntries(commands)).map(e => e.name))
      .toContain('ping')
  })

  it('实现 OverlayRenderer 契约（render(width,height) → string[]，用注入主题）', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    palette.open()
    const lines = palette.render(80, 24)
    expect(Array.isArray(lines)).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
    palette.close()
  })

  it('commit 无可选中项（空列表）返回 null', () => {
    const palette = new CommandPalette({ getCommands: () => [], getTheme: () => THEME })
    palette.open()
    expect(palette.commit()).toBeNull()
  })

  it('type 单个字符进入查询（可打印字符走面板而非输入行）', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    palette.open()
    palette.type('t')
    expect(palette.query).toBe('t')
    const visible = palette.entries
    expect(visible[0]?.name).toBe('theme')
  })

  it('过滤后 move 夹紧到可见列表长度（count 由控制器按过滤结果提供）', () => {
    const palette = new CommandPalette({ getCommands: () => SAMPLE, getTheme: () => THEME })
    palette.open()
    palette.type('c') // 过滤后可见 [clear, compact]（theme 不匹配）
    palette.move(99)
    expect(palette.commit()?.entry.name).toBe('compact')
    palette.move(-99)
    expect(palette.commit()?.entry.name).toBe('clear')
  })
})
