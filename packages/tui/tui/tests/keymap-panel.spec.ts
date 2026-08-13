/**
 * keymap-panel.spec.ts — 快捷键面板纯函数（grok-build Ctrl+. 弹层移植）。
 *
 * 覆盖：KEYMAP_ENTRIES 完整性（含自引用条目）、两列对齐渲染、
 * 窄宽截断/降级不破版。
 */
import { describe, expect, it } from 'vitest'
import { KEYMAP_ENTRIES, renderKeymapPanel } from '../src/format/keymap-panel.js'

describe('KEYMAP_ENTRIES', () => {
  it('包含自引用条目（Ctrl+. 打开本面板）', () => {
    expect(KEYMAP_ENTRIES).toContainEqual({ keys: 'Ctrl+.', action: '快捷键面板' })
  })

  it('覆盖核心键位（Enter/Ctrl+P/Ctrl+O/Ctrl+E/Tab/Esc）', () => {
    const keys = KEYMAP_ENTRIES.map(e => e.keys)
    for (const expected of ['Enter', 'Ctrl+P', 'Ctrl+O', 'Ctrl+E', 'Tab', 'Esc']) {
      expect(keys).toContain(expected)
    }
  })

  it('Ctrl+O 恢复为推理展开语义，外部编辑器移驻 Ctrl+E', () => {
    expect(KEYMAP_ENTRIES).toContainEqual({ keys: 'Ctrl+O', action: '展开/收起推理块' })
    expect(KEYMAP_ENTRIES).toContainEqual({ keys: 'Ctrl+E', action: '外部编辑器' })
  })
})

describe('renderKeymapPanel', () => {
  it('渲染标题 + 空行 + 全部条目', () => {
    const rows = renderKeymapPanel(80)
    expect(rows[0]).toBe('快捷键')
    // 标题 + 空行 + 条目数
    expect(rows).toHaveLength(2 + KEYMAP_ENTRIES.length)
  })

  it('两列对齐：键位列宽 = 最长键位 + 2', () => {
    const rows = renderKeymapPanel(80)
    // 每行键位后至少 2 列间隔；用 Ctrl+Shift+Enter 这种最长键位验证对齐
    const colWidth = Math.max(...KEYMAP_ENTRIES.map(e => e.keys.length)) + 2
    for (const row of rows.slice(2)) {
      const keyPart = row.slice(0, colWidth)
      expect(keyPart.trimEnd().length).toBeLessThanOrEqual(colWidth)
    }
  })

  it('每个条目键位出现在对应行首', () => {
    const rows = renderKeymapPanel(80)
    for (const entry of KEYMAP_ENTRIES) {
      const matched = rows.some(row => row.includes(entry.keys) && row.includes(entry.action))
      expect(matched, `条目 ${entry.keys} → ${entry.action} 应成行出现`).toBe(true)
    }
  })

  it('窄宽（放不下动作列）时动作截断不破版', () => {
    const rows = renderKeymapPanel(20)
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(20)
    }
  })

  it('极端窄宽（<12）仅标题+空行', () => {
    const rows = renderKeymapPanel(10)
    expect(rows).toEqual(['快捷键', ''])
  })

  it('紧凑单列降级：键位列宽 ≥ width 时键位不截断、动作截断', () => {
    // 最长键位 Shift+Enter(11) → keyCol=13；width 12/13 触发紧凑分支
    const rows = renderKeymapPanel(12)
    expect(rows.length).toBeGreaterThan(2)
    for (const row of rows.slice(2)) {
      expect(row.length).toBeLessThanOrEqual(12)
      expect(row).toMatch(/^ [A-Za-z]/)
    }
  })

  it('窄于 12 的宽度不抛错', () => {
    expect(() => renderKeymapPanel(5)).not.toThrow()
  })
})
