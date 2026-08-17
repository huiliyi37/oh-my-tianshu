/**
 * preset-surface — agent 预设展示面纯投影契约测试。
 *
 * 覆盖：
 * - resolvePresetId：header 创建值回落 / 尾向切换值 / 空日志 / 无日志句柄
 * - wireToolNames：最近 request/header 的工具 schema 名（preset 过滤器作用后）
 * - formatWireSurface：`[a, b]` 展示文本
 * - wirePhaseLabel：双工具面 → 锚定面；run_code → PTC 面；其余不标注
 * - zenPhaseLabel：zen/phase 折叠为 zen → 徽章；晋升/未布防/无日志 → undefined
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import {
  formatWireSurface,
  resolvePresetId,
  wirePhaseLabel,
  wireToolNames,
  zenPhaseLabel,
} from '../src/preset-surface.js'

/** 最小 request/header 事件（tools 可选；config 最小面）。 */
function headerEvent(
  seq: number,
  tools: Array<{ name: string }> | undefined,
): SessionEvent {
  return {
    seq, time: seq, type: 'request/header',
    data: {
      header: { config: { provider: 'mock', model: 'mock' }, ...(tools === undefined ? {} : { tools }) },
      reason: 'initial',
    },
  } as SessionEvent
}

/** agent-preset/selected 切换事件。 */
function selectedEvent(seq: number, agentPreset: string): SessionEvent {
  return { seq, time: seq, type: 'agent-preset/selected', data: { agentPreset } }
}

describe('resolvePresetId', () => {
  it('无切换事件 → 回落 header 创建值', () => {
    const events: SessionEvent[] = [headerEvent(1, undefined)]
    expect(resolvePresetId('standard', events)).toBe('standard')
  })

  it('尾向取最后一个 agent-preset/selected 切换值', () => {
    const events: SessionEvent[] = [
      selectedEvent(1, 'minimal'),
      headerEvent(2, undefined),
      selectedEvent(3, 'liangshen'),
    ]
    expect(resolvePresetId('standard', events)).toBe('liangshen')
  })

  it('切换事件在 header 值缺失时仍生效', () => {
    const events: SessionEvent[] = [selectedEvent(1, 'ptc')]
    expect(resolvePresetId(undefined, events)).toBe('ptc')
  })

  it('空日志且无 header 值 → undefined', () => {
    expect(resolvePresetId(undefined, [])).toBe(undefined)
  })

  it('无日志句柄（events undefined）→ 直接回落 header 值', () => {
    expect(resolvePresetId('minimal', undefined)).toBe('minimal')
    expect(resolvePresetId(undefined, undefined)).toBe(undefined)
  })
})

describe('wireToolNames', () => {
  it('最近 request/header 的工具 schema 名（含 preset 过滤器作用后的最终面）', () => {
    const events: SessionEvent[] = [
      headerEvent(1, [{ name: 'bash' }, { name: 'read' }]),
      headerEvent(2, [{ name: 'bash' }, { name: 'str_replace_editor' }]),
    ]
    expect(wireToolNames(events)).toEqual(['bash', 'str_replace_editor'])
  })

  it('无 request/header → undefined', () => {
    expect(wireToolNames([])).toBe(undefined)
    expect(wireToolNames([selectedEvent(1, 'liangshen')])).toBe(undefined)
  })

  it('无日志句柄 → undefined（不抛错）', () => {
    expect(wireToolNames(undefined)).toBe(undefined)
  })

  it('header 无 tools 字段（无工具请求）→ undefined', () => {
    expect(wireToolNames([headerEvent(1, undefined)])).toBe(undefined)
  })
})

describe('formatWireSurface', () => {
  it('工具名数组 → 方括号列表', () => {
    expect(formatWireSurface(['bash', 'str_replace_editor'])).toBe('[bash, str_replace_editor]')
    expect(formatWireSurface(['run_code'])).toBe('[run_code]')
  })

  it('undefined → undefined（调用方不渲染）', () => {
    expect(formatWireSurface(undefined)).toBe(undefined)
  })
})

describe('wirePhaseLabel', () => {
  it('持久 shell + str_replace_editor 双工具面 → 锚定面', () => {
    expect(wirePhaseLabel(['bash', 'str_replace_editor'])).toBe('锚定面')
  })

  it('win32 变体（pwsh + str_replace_editor）→ 锚定面', () => {
    expect(wirePhaseLabel(['pwsh', 'str_replace_editor'])).toBe('锚定面')
  })

  it('含 run_code → PTC 面', () => {
    expect(wirePhaseLabel(['run_code'])).toBe('PTC 面')
  })

  it('其他面（完整工具目录/单 shell）→ undefined（不臆断阶段）', () => {
    expect(wirePhaseLabel(['bash', 'read', 'glob', 'grep'])).toBe(undefined)
    expect(wirePhaseLabel(['bash'])).toBe(undefined)
  })

  it('无工具面 → undefined', () => {
    expect(wirePhaseLabel(undefined)).toBe(undefined)
    expect(wirePhaseLabel([])).toBe(undefined)
  })
})

/** zen/phase 事件（arm/晋升）。 */
function zenEvent(seq: number, phase: 'zen' | 'full', reason: string): SessionEvent {
  return { seq, time: seq, type: 'zen/phase', data: { phase, reason } } as SessionEvent
}

describe('zenPhaseLabel', () => {
  it('布防中（最后 zen/phase 为 zen）→ 徽章', () => {
    expect(zenPhaseLabel([zenEvent(1, 'zen', 'arm')])).toBe('禅')
  })

  it('晋升后（最后 zen/phase 为 full）→ undefined（徽章消失）', () => {
    const events = [zenEvent(1, 'zen', 'arm'), zenEvent(2, 'full', 'anchor')]
    expect(zenPhaseLabel(events)).toBe(undefined)
  })

  it('从未布防（无 zen/phase 事件）→ undefined', () => {
    expect(zenPhaseLabel([headerEvent(1, undefined)])).toBe(undefined)
    expect(zenPhaseLabel([])).toBe(undefined)
  })

  it('无日志句柄 → undefined（不抛错）', () => {
    expect(zenPhaseLabel(undefined)).toBe(undefined)
  })
})
