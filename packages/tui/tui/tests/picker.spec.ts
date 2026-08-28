/**
 * picker.spec.ts — 交互式选择器纯函数 + 控制器（Issue #31）。
 *
 * 覆盖：状态机（open 重置 / move 夹紧）、渲染（标题/选中 ▶/当前 ●/空态/
 * 窄宽截断）、控制器（open/move/commit 回调/close）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  applyPickerEvent,
  emptyPickerState,
  PickerController,
  renderPicker,
  type PickerItem,
} from '../src/picker.js'
import type { RivetTheme } from '../src/theme.js'

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

const items: PickerItem[] = [
  { label: 'graphite', value: 'graphite', current: true },
  { label: 'paper', value: 'paper' },
  { label: 'ocean', value: 'ocean' },
]

describe('applyPickerEvent', () => {
  it('open 重置选中与标题', () => {
    const s = applyPickerEvent({ ...emptyPickerState(), selected: 2 }, { type: 'open', title: '选择主题' })
    expect(s).toEqual({ open: true, selected: 0, title: '选择主题' })
  })

  it('close 关闭但保留选中', () => {
    const s = applyPickerEvent({ open: true, selected: 1, title: 't' }, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.selected).toBe(1)
  })

  it('move 在 [0, count-1] 内夹紧', () => {
    const base = { open: true, selected: 0, title: 't' }
    expect(applyPickerEvent(base, { type: 'move', delta: -1, count: 3 }).selected).toBe(0)
    expect(applyPickerEvent(base, { type: 'move', delta: 1, count: 3 }).selected).toBe(1)
    expect(applyPickerEvent({ ...base, selected: 2 }, { type: 'move', delta: 1, count: 3 }).selected).toBe(2)
    expect(applyPickerEvent(base, { type: 'move', delta: 5, count: 0 }).selected).toBe(0)
  })
})

describe('renderPicker', () => {
  it('标题 + 选中 ▶ 高亮 + 当前 ● 标记 + 键位提示', () => {
    const state = { open: true, selected: 0, title: '选择主题' }
    const rows = plain(renderPicker(state, items, 60, 10, fakeTheme()))
    expect(rows[0]).toBe('选择主题')
    expect(rows[1]).toBe('▶ graphite ●')
    expect(rows[2]).toBe('  paper')
    expect(rows[3]).toBe('  ocean')
    expect(rows[rows.length - 1]).toContain('↑↓ 选择')
  })

  it('选中项跟随移动', () => {
    const state = { open: true, selected: 2, title: 't' }
    const rows = plain(renderPicker(state, items, 60, 10, fakeTheme()))
    expect(rows[1]).toBe('  graphite ●')
    expect(rows[3]).toBe('▶ ocean')
  })

  it('空条目 → 无选项占位', () => {
    const rows = plain(renderPicker({ open: true, selected: 0, title: 't' }, [], 60, 10, fakeTheme()))
    expect(rows).toContain('（无选项）')
  })

  it('窄宽截断（条目行 ≤ width；标题/footer 为 chrome 不截断，同 command-palette）', () => {
    const long: PickerItem[] = [{ label: '这是一个非常长的模型标识符用来测试窄宽截断行为', value: 'x' }]
    for (const width of [20, 12]) {
      const rows = renderPicker({ open: true, selected: 0, title: 't' }, long, width, 10, fakeTheme())
      const entry = plain(rows)[1]
      expect(entry!.length).toBeLessThanOrEqual(width)
    }
  })
})

describe('PickerController', () => {
  it('open 注入条目与回调；commit 以选中项调用并关闭', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onCommit = vi.fn()
    c.open('选择主题', items, onCommit, 1)
    expect(c.isOpen()).toBe(true)
    expect(c.selected?.value).toBe('paper')
    c.commit()
    expect(onCommit).toHaveBeenCalledWith(items[1])
    expect(c.isOpen()).toBe(false)
  })

  it('move 移动选中；close 后 commit 不回调', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onCommit = vi.fn()
    c.open('t', items, onCommit)
    c.move(1)
    expect(c.selected?.value).toBe('paper')
    c.close()
    c.commit()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('无条目时 commit 不回调（selected undefined）', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onCommit = vi.fn()
    c.open('t', [], onCommit)
    expect(c.selected).toBeUndefined()
    c.commit()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('render 委托 renderPicker（OverlayRenderer 契约）', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    c.open('选择主题', items, () => {})
    const rows = plain(c.render(60, 10))
    expect(rows[0]).toBe('选择主题')
  })

  it('move 触发 onPreview（以新选中条目；实时预览钩子）', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onPreview = vi.fn()
    c.open('选择主题', items, () => {}, undefined, { onPreview })
    c.move(1)
    expect(onPreview).toHaveBeenCalledWith(items[1])
    c.move(1)
    expect(onPreview).toHaveBeenLastCalledWith(items[2])
    // open 即触发一次初始预览 + 两次 move = 3（dde14eb54 回流后行为）。
    expect(onPreview).toHaveBeenCalledTimes(3)
  })

  it('close 触发 onCancel（Esc/q 关闭路径；还原预览）', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onCancel = vi.fn()
    c.open('选择主题', items, () => {}, undefined, { onCancel })
    c.close()
    expect(onCancel).toHaveBeenCalledTimes(1)
    // 幂等：再次 close 不再触发（回调已清空）
    c.close()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('commit 不触发 onCancel（确认路径，预览已落定无需还原）', () => {
    const c = new PickerController({ getTheme: fakeTheme })
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    c.open('选择主题', items, onCommit, undefined, { onCancel })
    c.move(1)
    c.commit()
    expect(onCommit).toHaveBeenCalledWith(items[1])
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('PickerController 同行步进（</> 调档位，回流 opencode-tui dde14eb54）', () => {
  function boot() {
    const c = new PickerController({ getTheme: fakeTheme })
    return { c }
  }

  it('step 经 onStep 写回选中行 detail 并返回 true；null 静默返回 false', () => {
    const { c } = boot()
    let call = 0
    c.open('t', [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }], () => {}, 1, {
      onStep: (delta) => {
        call += 1
        return delta === 1 ? '档位 high' : null
      },
    })
    expect(c.step(1)).toBe(true)
    expect(c.selectedValue()).toBe('b')
    // setDetail 由 step 内部写入：经渲染可见
    const lines = c.render(40, 10).map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
    expect(lines.some(l => l.includes('档位 high'))).toBe(true)
    expect(c.step(-1)).toBe(false)
    expect(call).toBe(2)
  })

  it('无 onStep 的选择器 step 恒 false；setDetail 越界安全', () => {
    const { c } = boot()
    c.open('t', [{ label: 'a', value: 'a' }], () => {})
    expect(c.step(1)).toBe(false)
    expect(() => c.setDetail(9, 'x')).not.toThrow()
  })

  it('footer 在 onStep 存在时提示 </> 键位；open 即触发一次 onPreview', () => {
    const { c } = boot()
    const previews: string[] = []
    c.open('t', [{ label: 'a', value: 'a' }], () => {}, 0, {
      onPreview: (item) => { previews.push(item.value) },
      onStep: () => 'x',
    })
    expect(previews).toEqual(['a'])
    const lines = c.render(40, 10).map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
    expect(lines.some(l => l.includes('</> 调档位'))).toBe(true)
  })
})
