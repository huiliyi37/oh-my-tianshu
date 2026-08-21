/**
 * activity-band.spec.ts — 统一活动带纯函数（CC 对标固定状态带）。
 *
 * 覆盖：fold 三来源（subagent/workflow/task）字段与排序、running-only；
 * 渲染的计数头（多/单 item、零计数组省略）、每 item 恒 1 行、⎿ 子行只挂
 * 最新活跃 subagent、maxRows 封顶折叠尾行、数字更新不换行、done/failed
 * 不进带、空输入不渲染、宽度截断、无主题纯文本。
 */
import { describe, expect, it } from 'vitest'
import {
  foldActivityItems,
  formatActivityBand,
  type ActivityItem,
} from '../src/format/activity-band.js'
import { displayWidth } from '../src/width.js'

/** 标准 subagent 运行项（带投影快照）。 */
const subagentRun = {
  runId: 'run-1',
  label: '探索鉴权',
  startedAt: 1000,
  progress: { toolCalls: 3, tokensUsed: 12_300, lastTool: 'read' },
}

/** 无投影源的 subagent 运行项（out-of-process 降级）。 */
const subagentRunNoProgress = {
  runId: 'run-2',
  label: '外部进程',
  startedAt: 3000,
}

/** 标准 workflow run。 */
const workflowRun = {
  id: 'wf-1',
  name: 'workflow',
  description: '客观目标',
  phase: '集成',
  agentCount: 2,
  startedAt: 2000,
}

/** 标准活跃后台任务。 */
const activeTask = {
  id: 'task-1',
  kind: 'bash',
  label: 'pnpm test',
  startedAt: 2500,
}

describe('foldActivityItems', () => {
  it('三来源折叠为统一活动项（kind/status/label/统计字段对）', () => {
    const items = foldActivityItems({
      subagentRuns: [subagentRun],
      workflowRuns: [workflowRun],
      tasks: [activeTask],
    })
    expect(items).toHaveLength(3)
    const sub = items.find(item => item.kind === 'subagent')
    expect(sub).toMatchObject({
      id: 'run-1',
      label: '探索鉴权',
      status: 'running',
      toolCalls: 3,
      tokensUsed: 12_300,
      lastTool: 'read',
    })
    const wf = items.find(item => item.kind === 'workflow')
    expect(wf).toMatchObject({ id: 'wf-1', label: '[workflow] 客观目标', phase: '集成', agents: 2 })
    const task = items.find(item => item.kind === 'task')
    expect(task).toMatchObject({ id: 'task-1', label: 'bash: pnpm test' })
  })

  it('新 startedAt 在前；缺省 startedAt 垫底', () => {
    const items = foldActivityItems({
      subagentRuns: [
        { runId: 'old', label: '旧', startedAt: 100 },
        { runId: 'none', label: '无起点' },
        { runId: 'new', label: '新', startedAt: 900 },
      ],
      workflowRuns: [],
      tasks: [],
    })
    expect(items.map(item => item.id)).toEqual(['new', 'old', 'none'])
  })

  it('workflow 无 description 时 label 只含 [name]；phase null 缺省 phase 段', () => {
    const items = foldActivityItems({
      subagentRuns: [],
      workflowRuns: [{ id: 'wf-2', name: 'ralph', description: '', phase: null, agentCount: 0 }],
      tasks: [],
    })
    expect(items[0]).toMatchObject({ label: '[ralph]', agents: 0 })
    expect(items[0]?.phase).toBeUndefined()
  })

  it('无投影源的 subagent 项不带统计字段（out-of-process 降级）', () => {
    const items = foldActivityItems({ subagentRuns: [subagentRunNoProgress], workflowRuns: [], tasks: [] })
    expect(items[0]?.toolCalls).toBeUndefined()
    expect(items[0]?.tokensUsed).toBeUndefined()
    expect(items[0]?.lastTool).toBeUndefined()
  })
})

describe('formatActivityBand 计数头', () => {
  const opts = { width: 80, maxRows: 5 }

  it('空输入/全 done 返回空数组（不渲染带）', () => {
    expect(formatActivityBand([], opts)).toEqual([])
    const done: ActivityItem = { id: 'd', kind: 'subagent', label: '已完', status: 'done' }
    expect(formatActivityBand([done], opts)).toEqual([])
  })

  it('多 item 显示分组计数头，零计数组省略；单 item 无头', () => {
    const items = foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [workflowRun], tasks: [activeTask] })
    const rows = formatActivityBand(items, opts)
    expect(rows[0]).toBe('◐ 1 子代理 · 1 工作流 · 1 后台任务')
    // 单 item：无计数头，首行为 item 行
    const single = formatActivityBand(foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }), opts)
    expect(single[0]).toContain('探索鉴权')
  })

  it('只统计 running 项（done/failed 不进计数）', () => {
    const items: ActivityItem[] = [
      { id: 'a', kind: 'subagent', label: '活', status: 'running' },
      { id: 'b', kind: 'task', label: '死', status: 'failed' },
    ]
    const rows = formatActivityBand(items, opts)
    // 过滤后仅 1 个 running → 无计数头
    expect(rows[0]).not.toContain('◐')
  })
})

describe('formatActivityBand 行形状', () => {
  const opts = { width: 80, maxRows: 5, now: 5000 }

  it('每 item 恒 1 行；⎿ 子行只挂最新活跃 subagent', () => {
    const items = foldActivityItems({
      subagentRuns: [subagentRun, { ...subagentRunNoProgress, startedAt: 4000 }],
      workflowRuns: [workflowRun],
      tasks: [],
    })
    const rows = formatActivityBand(items, opts)
    // 顺序（新在前）：run-2(4000) → wf(2000) → run-1(1000)
    expect(rows[0]).toBe('◐ 2 子代理 · 1 工作流')
    expect(rows[1]).toContain('外部进程')
    expect(rows[2]).toContain('[workflow]')
    expect(rows[3]).toContain('探索鉴权')
    // 最新 subagent（外部进程）无投影源 → 无子行；每条 item 恰 1 行
    expect(rows.some(line => line.includes('⎿'))).toBe(false)
    expect(rows).toHaveLength(5)
  })

  it('无投影源不渲染子行（out-of-process）；有 lastTool 渲染最近工具', () => {
    const withTool = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5, now: 5000 },
    )
    expect(withTool.some(line => line.includes('⎿ read'))).toBe(true)
    const without = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRunNoProgress], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5, now: 5000 },
    )
    expect(without.some(line => line.includes('⎿'))).toBe(false)
  })

  it('有投影源但零工具调用 → 子行 Initializing…', () => {
    const rows = formatActivityBand(
      foldActivityItems({
        subagentRuns: [{ runId: 'fresh', label: '刚启动', startedAt: 100, progress: { toolCalls: 0, tokensUsed: 0 } }],
        workflowRuns: [],
        tasks: [],
      }),
      { width: 80, maxRows: 5 },
    )
    expect(rows.some(line => line.includes('⎿ Initializing…'))).toBe(true)
  })

  it('统计段：subagent 工具/token/耗时；workflow phase/agent 数/耗时；零值省略', () => {
    const subRows = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5, now: 5000 },
    )
    expect(subRows[0]).toContain('3 工具')
    expect(subRows[0]).toContain('12.3k tok')
    expect(subRows[0]).toContain('4s') // 5000 - 1000
    const wfRows = formatActivityBand(
      foldActivityItems({ subagentRuns: [], workflowRuns: [workflowRun], tasks: [] }),
      { width: 80, maxRows: 5, now: 5000 },
    )
    expect(wfRows[0]).toContain('[workflow] 客观目标')
    expect(wfRows[0]).toContain('集成')
    expect(wfRows[0]).toContain('2 个 agent')
    expect(wfRows[0]).toContain('3s')
  })

  it('AC4：数字更新不换行（同 item 统计变化行数不变）', () => {
    const before = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5, now: 5000 },
    )
    const grown = foldActivityItems({
      subagentRuns: [{ ...subagentRun, progress: { toolCalls: 400, tokensUsed: 999_999, lastTool: 'bash' } }],
      workflowRuns: [],
      tasks: [],
    })
    const after = formatActivityBand(grown, { width: 80, maxRows: 5, now: 5000 })
    expect(after).toHaveLength(before.length)
    expect(after[0]).toContain('400 工具')
    expect(after[0]).toContain('1000.0k tok')
  })

  it('AC3：超 maxRows 折叠为 +N 尾行，总行数有界', () => {
    const runs = Array.from({ length: 6 }, (_, i) => ({
      runId: `run-${i}`,
      label: `代理${i}`,
      startedAt: 1000 + i,
      progress: { toolCalls: 1, tokensUsed: 100, lastTool: 'bash' },
    }))
    const rows = formatActivityBand(foldActivityItems({ subagentRuns: runs, workflowRuns: [], tasks: [] }), {
      width: 80,
      maxRows: 3,
      now: 10_000,
    })
    // 计数头 1 + item 3 + 子行 1 + 尾行 1 = 6
    expect(rows).toHaveLength(6)
    expect(rows.at(-1)).toContain('(+3) /workflow 管理')
    expect(rows.some(line => line.includes('代理5'))).toBe(true) // 最新保留
    expect(rows.some(line => line.includes('代理0'))).toBe(false) // 最旧被折叠
    expect(rows.some(line => line.includes('⎿ bash'))).toBe(true) // 最新 subagent 子行
  })

  it('未折叠时尾行为常驻入口（/workflow 管理 · /subagents 树）', () => {
    const rows = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5 },
    )
    expect(rows.at(-1)).toBe('/workflow 管理 · /subagents 树')
  })

  it('宽度截断：全部行 displayWidth ≤ width', () => {
    const rows = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [workflowRun], tasks: [activeTask] }),
      { width: 30, maxRows: 5, now: 5000 },
    )
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(30)
  })

  it('无主题输出纯文本（不含 ANSI）', () => {
    const rows = formatActivityBand(
      foldActivityItems({ subagentRuns: [subagentRun], workflowRuns: [], tasks: [] }),
      { width: 80, maxRows: 5, tick: 0 },
    )
    for (const row of rows) expect(row).not.toContain('\x1B')
  })
})
