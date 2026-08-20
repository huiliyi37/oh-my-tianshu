/**
 * restore-session — 可恢复会话投影（RED 基线）。
 *
 * 纯投影：输入 adapter/sessions.ts 的 SessionSummary[] → 可恢复会话视图。
 * 不接管启动流程、不读 ctx——读取由装配层调 listSessions 后喂入。
 *
 * 覆盖：
 * - projectRestorableSessions：live 标注 + 顺序保持（新→旧）
 * - formatSessionAge：相对时间（刚刚/分钟/小时/天/日期）
 * - formatRestorableSessions：展示行（live 标记 + cwd + fork 来源）
 */

import { describe, expect, it } from 'vitest'
import type { SessionId } from '@huiliyi37/dsh-session'
import type { SessionSummary } from '../src/adapter/sessions.js'
import {
  formatRestorablePickerList,
  formatRestorableSessions,
  formatSessionAge,
  projectRestorableSessions,
  wasCrashRepaired,
  type RestorableSession,
} from '../src/restore-session.js'

const NOW = 1_700_000_000_000

function summary(id: string, createdAt: number, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId, version: 0, createdAt, cwd: undefined, parentSession: undefined,
    agentPreset: undefined, corrupt: false, ...over,
  }
}

describe('projectRestorableSessions', () => {
  it('保持输入顺序（listSessions 已按新→旧），标注 live', () => {
    const rows = projectRestorableSessions(
      [summary('s-new', NOW - 1_000), summary('s-old', NOW - 3_600_000)],
      { now: NOW, liveIds: new Set<SessionId>(['s-new' as SessionId]) },
    )
    expect(rows.map(r => r.id)).toEqual(['s-new', 's-old'])
    expect(rows[0]?.live).toBe(true)
    expect(rows[1]?.live).toBe(false)
  })

  it('liveIds 缺省 → 全部 persisted（live=false）', () => {
    const rows = projectRestorableSessions([summary('s-1', NOW - 1000)], { now: NOW })
    expect(rows[0]?.live).toBe(false)
  })

  it('透传 cwd 与 parentSession 元数据', () => {
    const rows = projectRestorableSessions(
      [summary('s-1', NOW - 1000, { cwd: '/app/x', parentSession: 's-0' as SessionId })],
      { now: NOW },
    )
    expect(rows[0]?.cwd).toBe('/app/x')
    expect(rows[0]?.parentSession).toBe('s-0')
  })

  it('now 缺省 → 使用当前时间（不抛错）', () => {
    const rows = projectRestorableSessions([summary('s-1', Date.now() - 1000)])
    expect(rows).toHaveLength(1)
  })
})

describe('formatSessionAge — 相对时间', () => {
  it('<60s → 刚刚', () => {
    expect(formatSessionAge(NOW - 5_000, NOW)).toBe('刚刚')
  })

  it('<1h → N 分钟前', () => {
    expect(formatSessionAge(NOW - 5 * 60_000, NOW)).toBe('5 分钟前')
  })

  it('<24h → N 小时前', () => {
    expect(formatSessionAge(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前')
  })

  it('<7d → N 天前', () => {
    expect(formatSessionAge(NOW - 2 * 86_400_000, NOW)).toBe('2 天前')
  })

  it('≥7d → 日期', () => {
    expect(formatSessionAge(NOW - 30 * 86_400_000, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('未来时间（时钟偏移）→ 刚刚，不出现负值', () => {
    expect(formatSessionAge(NOW + 60_000, NOW)).toBe('刚刚')
  })
})

describe('formatRestorableSessions — 展示行', () => {
  const rows: RestorableSession[] = [
    { id: 's-live' as SessionId, createdAt: NOW - 60_000, cwd: '/app/x', parentSession: undefined, live: true, agentPreset: undefined, title: undefined, corrupt: false },
    { id: 's-fork' as SessionId, createdAt: NOW - 3_600_000, cwd: undefined, parentSession: 's-parent' as SessionId, live: false, agentPreset: undefined, title: undefined, corrupt: false },
  ]

  it('live 行带 ●、相对年龄、cwd basename 与短 id', () => {
    const lines = formatRestorableSessions(rows, { now: NOW })
    expect(lines[0]).toContain('●')
    expect(lines[0]).toContain('1 分钟前')
    expect(lines[0]).toContain('x') // /app/x 的 basename
    expect(lines[0]).toContain('#s-live')
  })

  it('live 行但无 cwd → 不渲染 cwd 段', () => {
    const row: RestorableSession = { id: 's-x' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: true, agentPreset: undefined, title: undefined, corrupt: false }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['● 刚刚 · #s-x'])
  })

  it('session- 前缀 id → 短 id 去前缀（#uuid8；id 与 fork 父 id 均不出现 #session- 空壳）', () => {
    const row: RestorableSession = {
      id: 'session-3f2a1b9c-4d5e-4f60-8a7b-9c0d1e2f3a4b' as SessionId,
      createdAt: NOW - 1000,
      cwd: undefined,
      parentSession: 'session-01234567-89ab-4cde-8f01-23456789012a' as SessionId,
      live: false,
      agentPreset: undefined,
      title: undefined,
      corrupt: false,
    }
    const lines = formatRestorableSessions([row], { now: NOW })
    expect(lines[0]).toContain('#3f2a1b9c')
    expect(lines[0]).toContain('fork #01234567')
    expect(lines[0]).not.toContain('#session-')
  })

  it('persisted 行无 parentSession → 不渲染 fork 段', () => {
    const row: RestorableSession = { id: 's-y' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 刚刚 · #s-y'])
  })

  it('now 缺省 → 走 Date.now()（不抛错且产出单行）', () => {
    const row: RestorableSession = { id: 's-z' as SessionId, createdAt: Date.now() - 1000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false }
    const lines = formatRestorableSessions([row])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('s-z')
  })

  it('persisted 行带 ○ 与 fork 短父 id', () => {
    const lines = formatRestorableSessions(rows, { now: NOW })
    expect(lines[1]).toContain('○')
    expect(lines[1]).toContain('fork #s-parent')
  })

  it('长 UUID 会话 id 截为 8 位短 id（# 前缀）', () => {
    const row: RestorableSession = {
      id: '2b054afd-0fcc-414d-8358-bc2e52999d35' as SessionId,
      createdAt: NOW - 1000,
      cwd: undefined,
      parentSession: undefined,
      live: false,
      agentPreset: undefined,
      title: undefined, corrupt: false,
    }
    const [line] = formatRestorableSessions([row], { now: NOW })
    expect(line).toBe('○ 刚刚 · #2b054afd')
  })

  it('agent preset 已记录 → 行尾追加 preset 标注', () => {
    const row: RestorableSession = {
      id: 's-p' as SessionId, createdAt: NOW - 1000, cwd: undefined,
      parentSession: undefined, agentPreset: 'liangshen', live: false, title: undefined, corrupt: false,
    }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 刚刚 · #s-p · preset:liangshen'])
  })

  it('agent preset 未记录 → 不渲染 preset 段（不制造噪音）', () => {
    const row: RestorableSession = {
      id: 's-n' as SessionId, createdAt: NOW - 1000, cwd: undefined,
      parentSession: undefined, agentPreset: undefined, live: true, title: undefined, corrupt: false,
    }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['● 刚刚 · #s-n'])
  })

  it('maxRows=1：只展示最近 1 行 + 折叠提示', () => {
    const many = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
      { id: 's-3' as SessionId, createdAt: NOW - 3000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
    ]
    const lines = formatRestorableSessions(many, { now: NOW, maxRows: 1 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('s-1')
    expect(lines[0]).not.toContain('s-2')
    expect(lines[1]).toBe('… 还有 2 个会话')
  })

  it('maxRows 超过总数：不折叠、全量展示', () => {
    const two = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
    ]
    expect(formatRestorableSessions(two, { now: NOW, maxRows: 5 })).toHaveLength(2)
  })

  it('maxRows ≤ 0：视为不限制（兼容缺省语义）', () => {
    const two = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false, agentPreset: undefined, title: undefined, corrupt: false },
    ]
    expect(formatRestorableSessions(two, { now: NOW, maxRows: 0 })).toHaveLength(2)
    expect(formatRestorableSessions(two, { now: NOW, maxRows: -3 })).toHaveLength(2)
  })

  it('空列表 → 占位提示', () => {
    expect(formatRestorableSessions([], { now: NOW })).toEqual(['（无可恢复会话）'])
  })

  it('title 已计算 → 行首渲染标题（标题 · 年龄 · cwd 顺序）', () => {
    const row: RestorableSession = {
      id: 's-t' as SessionId, createdAt: NOW - 60_000, cwd: '/app/x',
      parentSession: undefined, agentPreset: undefined, live: false, title: '重构 tui 拆分', corrupt: false,
    }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 重构 tui 拆分 · 1 分钟前 · x · #s-t'])
  })

  it('title 为空串 → 不渲染标题段', () => {
    const row: RestorableSession = {
      id: 's-t2' as SessionId, createdAt: NOW - 1000, cwd: undefined,
      parentSession: undefined, agentPreset: undefined, live: false, title: '', corrupt: false,
    }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 刚刚 · #s-t2'])
  })

  it('损坏会话 → 标注「不可恢复」（年龄/cwd/血缘未知不渲染）', () => {
    const row: RestorableSession = {
      id: 's-broken' as SessionId, createdAt: 0, cwd: undefined,
      parentSession: undefined, agentPreset: undefined, live: false, title: undefined, corrupt: true,
    }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 不可恢复 · #s-broken'])
  })
})

describe('formatRestorablePickerList — 欢迎页编号列表', () => {
  const row = (id: string, createdAt: number): RestorableSession => ({
    id: id as SessionId, createdAt, cwd: '/app/x', parentSession: undefined,
    live: false, agentPreset: undefined, title: `标题-${id}`,
    corrupt: false,
  })

  it('每行 `[N]` 编号 + 展示行（行序 = 输入序）', () => {
    const lines = formatRestorablePickerList(
      [row('s-1', NOW - 1000), row('s-2', NOW - 2000)],
      { now: NOW },
    )
    expect(lines).toEqual([
      '[1] ○ 标题-s-1 · 刚刚 · x · #s-1',
      '[2] ○ 标题-s-2 · 刚刚 · x · #s-2',
    ])
  })

  it('maxRows 限高 → 编号行折叠 + 「还有 N 个会话」', () => {
    const many = [row('s-1', NOW - 1000), row('s-2', NOW - 2000), row('s-3', NOW - 3000)]
    const lines = formatRestorablePickerList(many, { now: NOW, maxRows: 2 })
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('[1] ○ 标题-s-1 · 刚刚 · x · #s-1')
    expect(lines[2]).toBe('… 还有 1 个会话')
  })

  it('空列表 → 空数组（调用方决定是否占位）', () => {
    expect(formatRestorablePickerList([], { now: NOW })).toEqual([])
  })
})

describe('wasCrashRepaired — 崩溃修复信号（尾部标记语义）', () => {
  const endSeed = { type: 'session/end-seed', seq: 0, time: NOW, data: {} } as const
  const turnEnd = (seq: number, reason: unknown) => ({ type: 'turn/end', seq, time: NOW, data: { turn: 0, reason } }) as const

  it('尾部 interrupted turn/end 标记 → true（修复刚生效）', () => {
    const events = [
      endSeed,
      turnEnd(1, { kind: 'interrupted' }),
    ]
    expect(wasCrashRepaired(events as never)).toBe(true)
  })

  it('interrupted 之后又有正常完成的回合 → false（不粘滞误报）', () => {
    // 修复标记永久留在日志里；用户恢复后正常完成新回合，之后的恢复不得
    // 再报「上次运行被中断」。
    const events = [
      endSeed,
      turnEnd(1, { kind: 'interrupted' }),
      turnEnd(2, { kind: 'completed' }),
    ]
    expect(wasCrashRepaired(events as never)).toBe(false)
  })

  it('仅正常闭合（completed）→ false', () => {
    const events = [
      endSeed,
      turnEnd(1, { kind: 'completed' }),
    ]
    expect(wasCrashRepaired(events as never)).toBe(false)
  })

  it('无 turn/end → false（空日志/仅种子）', () => {
    expect(wasCrashRepaired([endSeed] as never)).toBe(false)
  })
})
