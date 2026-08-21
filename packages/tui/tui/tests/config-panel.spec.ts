/**
 * config-panel.spec.ts — /config 交互式设置面板（双栏 framed overlay）单测。
 *
 * 覆盖：控制器状态机（导航/切栏/Enter 分派/Esc 关闭/只读提示/游标保持的
 * refresh）、framed 渲染（标题/双栏/状态行/页脚/宽度截断/窗口滚动）。
 * 主题与 actions 均为测试桩（纯渲染层，无服务）。
 */
import { describe, expect, it, vi } from 'vitest'
import { ConfigPanelController, type ConfigFieldAction, type ConfigPanelData } from '../src/config-panel.js'
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
  return lines.map(line => line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

/** 两类目 × 若干字段的标准数据桩。 */
function sampleData(): ConfigPanelData {
  return {
    categories: [
      {
        key: 'model',
        label: '模型',
        fields: [
          { key: 'default', label: '默认模型', value: 'openrouter/stealth/ox-alpha', editable: true, action: { kind: 'edit-default-model' } },
          { key: 'effort', label: '推理档位', value: 'max', editable: true, action: { kind: 'edit-effort' }, hint: 'off = 不思考' },
          { key: 'vision', label: '视觉模型', value: '跟随默认', editable: true, action: { kind: 'edit-role', role: 'vision' } },
        ],
      },
      {
        key: 'overview',
        label: '概览',
        fields: [
          { key: 'ns:a', label: 'llm-deepseek', value: '—', editable: false, action: { kind: 'none' } },
        ],
      },
    ],
  }
}

/** 装配控制器：edit/close 记录调用；返回面板与桩。 */
function makePanel() {
  const edit = vi.fn()
  const close = vi.fn()
  const panel = new ConfigPanelController({ getTheme: fakeTheme, edit, close })
  return { panel, edit, close }
}

describe('ConfigPanelController — 导航与分派', () => {
  it('右/Enter 下钻到字段栏；↑↓ 环移；Enter 分派编辑动作', () => {
    const { panel, edit } = makePanel()
    panel.open(sampleData())
    panel.handleKey('right', '')
    panel.handleKey('return', '')
    expect(edit).toHaveBeenCalledWith({ kind: 'edit-default-model' })
    panel.handleKey('down', '')
    panel.handleKey('return', '')
    expect(edit).toHaveBeenCalledWith({ kind: 'edit-effort' })
    panel.handleKey('down', '')
    panel.handleKey('return', '')
    expect(edit).toHaveBeenCalledWith({ kind: 'edit-role', role: 'vision' })
  })

  it('Tab/左键回类目栏；类目栏 Enter 下钻到字段', () => {
    const { panel, edit } = makePanel()
    panel.open(sampleData())
    panel.handleKey('tab', '')
    panel.handleKey('return', '') // 类目栏 Enter = 下钻到字段
    panel.handleKey('return', '') // 字段栏 Enter = 分派
    expect(edit).toHaveBeenCalledWith({ kind: 'edit-default-model' })
  })

  it('只读字段 Enter 给状态行提示、不分派；Esc 请求关闭', () => {
    const { panel, edit, close } = makePanel()
    panel.open(sampleData())
    // 类目栏下移到「概览」，Enter 下钻到其只读字段。
    panel.handleKey('down', '')
    panel.handleKey('return', '')
    panel.handleKey('return', '')
    expect(edit).not.toHaveBeenCalled()
    expect(plain(panel.render(60, 14)).join('\n')).toContain('该项只读')
    panel.handleKey('escape', '')
    expect(close).toHaveBeenCalledOnce()
    expect(panel.wantsClose()).toBe(true)
  })

  it('refresh 按键保持游标（编辑回开后停在原字段）', () => {
    const { panel, edit } = makePanel()
    panel.open(sampleData())
    panel.handleKey('right', '')
    panel.handleKey('down', '') // effort
    panel.refresh(sampleData())
    panel.handleKey('return', '')
    expect(edit).toHaveBeenCalledWith({ kind: 'edit-effort' })
  })

  it('空类目字段列表：Enter 不下钻、右键不切栏；渲染占位', () => {
    const { panel, edit } = makePanel()
    panel.open({ categories: [{ key: 'empty', label: '空', fields: [] }] })
    panel.handleKey('right', '')
    panel.handleKey('return', '')
    expect(edit).not.toHaveBeenCalled()
    expect(plain(panel.render(50, 10)).join('\n')).toContain('（无配置项）')
  })
})

describe('ConfigPanelController — framed 渲染', () => {
  it('标题 + 双栏 + 状态行 + 页脚键位 + 框线', () => {
    const { panel } = makePanel()
    panel.open(sampleData())
    const lines = plain(panel.render(64, 14))
    const text = lines.join('\n')
    expect(text).toContain('⚙ 配置')
    expect(text).toContain('模型')
    expect(text).toContain('概览')
    expect(text).toContain('默认模型')
    expect(text).toContain('openrouter/stealth/ox-alpha')
    expect(text).toContain('↑↓ 移动 · ←→ 切栏 · Enter 编辑 · Esc 退出')
    expect(lines[0]).toContain('┌')
    expect(lines.at(-1)).toContain('└')
  })

  it('字段选中时状态行显示 hint', () => {
    const { panel } = makePanel()
    panel.open(sampleData())
    panel.handleKey('right', '')
    panel.handleKey('down', '') // effort 带 hint
    expect(plain(panel.render(64, 14)).join('\n')).toContain('off = 不思考')
  })

  it('类目栏焦点时状态行显示类目回退提示', () => {
    const { panel } = makePanel()
    panel.open(sampleData())
    expect(plain(panel.render(64, 14)).join('\n')).toContain('←→ 切栏')
  })

  it('窄宽/矮高退化：超窄单行、行宽截断不越框', () => {
    const { panel } = makePanel()
    panel.open(sampleData())
    expect(panel.render(3, 10)).toEqual(['⚙ …'])
    for (const line of plain(panel.render(30, 12))) {
      expect(line.length).toBeLessThanOrEqual(30)
    }
    expect(plain(panel.render(30, 12)).join('\n')).toContain('…')
  })

  it('长字段列表窗口滚动：选中项保持在窗口内、远处项不在', () => {
    const { panel } = makePanel()
    const fields = Array.from({ length: 30 }, (_, i) => ({
      key: `f${i}`,
      label: `字段${i}`,
      value: `v${i}`,
      editable: false,
      action: { kind: 'none' } as ConfigFieldAction,
    }))
    panel.open({ categories: [{ key: 'big', label: '大', fields }] })
    panel.handleKey('right', '')
    for (let i = 0; i < 15; i++) panel.handleKey('down', '')
    const text = plain(panel.render(50, 12)).join('\n')
    expect(text).toContain('字段15')
    expect(text).not.toContain('字段0')
  })
})
