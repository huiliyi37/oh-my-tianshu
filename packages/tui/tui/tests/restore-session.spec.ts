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
  formatRestorableSessions,
  formatSessionAge,
  projectRestorableSessions,
  type RestorableSession,
} from '../src/restore-session.js'

const NOW = 1_700_000_000_000

function summary(id: string, createdAt: number, over: Partial<SessionSummary> = {}): SessionSummary {
  return { id: id as SessionId, version: 0, createdAt, cwd: undefined, parentSession: undefined, ...over }
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
    { id: 's-live' as SessionId, createdAt: NOW - 60_000, cwd: '/app/x', parentSession: undefined, live: true },
    { id: 's-fork' as SessionId, createdAt: NOW - 3_600_000, cwd: undefined, parentSession: 's-parent' as SessionId, live: false },
  ]

  it('live 行带 ●、相对年龄、cwd basename 与短 id', () => {
    const lines = formatRestorableSessions(rows, { now: NOW })
    expect(lines[0]).toContain('●')
    expect(lines[0]).toContain('1 分钟前')
    expect(lines[0]).toContain('x') // /app/x 的 basename
    expect(lines[0]).toContain('#s-live')
  })

  it('live 行但无 cwd → 不渲染 cwd 段', () => {
    const row: RestorableSession = { id: 's-x' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: true }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['● 刚刚 · #s-x'])
  })

  it('persisted 行无 parentSession → 不渲染 fork 段', () => {
    const row: RestorableSession = { id: 's-y' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false }
    expect(formatRestorableSessions([row], { now: NOW })).toEqual(['○ 刚刚 · #s-y'])
  })

  it('now 缺省 → 走 Date.now()（不抛错且产出单行）', () => {
    const row: RestorableSession = { id: 's-z' as SessionId, createdAt: Date.now() - 1000, cwd: undefined, parentSession: undefined, live: false }
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
    }
    const [line] = formatRestorableSessions([row], { now: NOW })
    expect(line).toBe('○ 刚刚 · #2b054afd')
  })

  it('maxRows=1：只展示最近 1 行 + 折叠提示', () => {
    const many = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false },
      { id: 's-3' as SessionId, createdAt: NOW - 3000, cwd: undefined, parentSession: undefined, live: false },
    ]
    const lines = formatRestorableSessions(many, { now: NOW, maxRows: 1 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('s-1')
    expect(lines[0]).not.toContain('s-2')
    expect(lines[1]).toBe('… 还有 2 个会话')
  })

  it('maxRows 超过总数：不折叠、全量展示', () => {
    const two = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false },
    ]
    expect(formatRestorableSessions(two, { now: NOW, maxRows: 5 })).toHaveLength(2)
  })

  it('maxRows ≤ 0：视为不限制（兼容缺省语义）', () => {
    const two = [
      { id: 's-1' as SessionId, createdAt: NOW - 1000, cwd: undefined, parentSession: undefined, live: false },
      { id: 's-2' as SessionId, createdAt: NOW - 2000, cwd: undefined, parentSession: undefined, live: false },
    ]
    expect(formatRestorableSessions(two, { now: NOW, maxRows: 0 })).toHaveLength(2)
    expect(formatRestorableSessions(two, { now: NOW, maxRows: -3 })).toHaveLength(2)
  })

  it('空列表 → 占位提示', () => {
    expect(formatRestorableSessions([], { now: NOW })).toEqual(['（无可恢复会话）'])
  })
})
