/**
 * workflow-panel.spec.ts — 工作流运行态面板纯函数（grok workflows.rs render_list/roster 移植）。
 *
 * 覆盖：列表行（状态字形 + badge + objective + phases/agents/elapsed meta，cancelled 置灰）、
 * 展开行（roster：label + phase + 状态）、终态汇总（stopReason/agentsStarted）、
 * 窄宽截断、极端窄宽不抛错、空输入占位。数据面形状以 workflow 包 types.ts 实测为准
 * （WorkflowRunInfo 字段名 id；WorkflowAgentEndInfo 追加 outcome；WorkflowResultInfo 无 value）。
 */
import { describe, expect, it } from 'vitest'
import { projectWorkflow, type WorkflowRunView } from '../src/workflow-panel.js'
import { displayWidth } from '../src/width.js'

const DIM = '\x1B[2m'
const RESET = '\x1B[0m'

/** 已完成的 run：roster 全部结算 + 终态汇总。 */
const doneRun: WorkflowRunView = {
  info: {
    id: 'run-done',
    meta: {
      name: '发布脚本',
      description: '校验并发布构建产物',
      phases: [{ title: '准备' }, { title: '发布' }, { title: '收尾' }],
    },
  },
  agents: [
    { seq: 1, label: '起草发布说明', phase: '准备', childId: 'c1', outcome: 'completed' },
    { seq: 2, label: '执行发布', phase: '发布', childId: 'c2', outcome: 'failed' },
  ],
  result: { stopReason: 'completed', agentsStarted: 2 },
  elapsedMs: 80_000,
}

/** 运行中的 run：无 result、无已结算 roster、无 phases 声明。 */
const runningRun: WorkflowRunView = {
  info: { id: 'run-live', meta: { name: '调研', description: '对比候选方案' } },
  agents: [],
  elapsedMs: 45_000,
}

/** 被取消的 run：整行置灰。 */
const cancelledRun: WorkflowRunView = {
  info: { id: 'run-cancel', meta: { name: '回滚', description: '回滚上次发布' } },
  agents: [{ seq: 1, label: '确认快照', childId: 'c3', outcome: 'cancelled' }],
  result: { stopReason: 'cancelled', agentsStarted: 1 },
}

/** 出错的 run：error 消息进终态汇总。 */
const errorRun: WorkflowRunView = {
  info: { id: 'run-err', meta: { name: '迁移', description: '迁移数据表' } },
  agents: [{ seq: 1, label: '备份', phase: '准备', childId: 'c4', outcome: 'completed' }],
  result: { stopReason: 'error', error: '上游 API 超时', agentsStarted: 1 },
}

describe('面板骨架', () => {
  it('渲染标题行', () => {
    const rows = projectWorkflow([runningRun], { width: 80 })
    expect(rows[0]).toBe('📜 工作流')
  })

  it('runs 为空数组 → 标题 + 占位', () => {
    expect(projectWorkflow([], { width: 80 })).toEqual(['📜 工作流', '（暂无工作流）'])
  })
})

describe('列表行', () => {
  it('运行中（result 未结算）→ 字形 ⏳，无终态段', () => {
    const rows = projectWorkflow([runningRun], { width: 80 })
    expect(rows).toContain('⏳ [调研] 对比候选方案 · 0 个 agent · 45s')
  })

  it('已完成 → 字形 ✓ + phases/agents/elapsed meta', () => {
    const rows = projectWorkflow([doneRun], { width: 80 })
    expect(rows).toContain('✓ [发布脚本] 校验并发布构建产物 · 3 阶段 · 2 个 agent · 1m20s')
  })

  it('出错 → 字形 ✗', () => {
    const rows = projectWorkflow([errorRun], { width: 80 })
    expect(rows.some(r => r.startsWith('✗ [迁移] 迁移数据表'))).toBe(true)
  })

  it('已取消 → 字形 ⊘ 且整行 DIM 置灰', () => {
    const rows = projectWorkflow([cancelledRun], { width: 80 })
    const row = rows.find(r => r.includes('⊘ [回滚] 回滚上次发布'))
    expect(row).toBeDefined()
    expect(row).toContain(`${DIM}⊘ [回滚] 回滚上次发布`)
    expect(row!.endsWith(RESET)).toBe(true)
  })

  it('未取消的 run 不置灰（无 DIM 包裹）', () => {
    const rows = projectWorkflow([doneRun], { width: 80 })
    expect(rows.join('')).not.toContain(DIM)
  })

  it('meta.phases 未声明 → 不渲染阶段段', () => {
    const rows = projectWorkflow([runningRun], { width: 80 })
    expect(rows.some(r => r.includes('阶段'))).toBe(false)
  })

  it('elapsedMs 未提供 → 不渲染时间段', () => {
    const view: WorkflowRunView = {
      info: { id: 'r', meta: { name: 'n', description: 'd' } },
      agents: [],
      result: { stopReason: 'completed', agentsStarted: 0 },
    }
    const rows = projectWorkflow([view], { width: 80 })
    expect(rows).toContain('✓ [n] d · 0 个 agent')
  })

  it('roster 空 → 0 个 agent', () => {
    const rows = projectWorkflow([runningRun], { width: 80 })
    expect(rows.some(r => r.includes('0 个 agent'))).toBe(true)
  })

  it('elapsed ≥ 1h → XhYm', () => {
    const view: WorkflowRunView = { ...runningRun, elapsedMs: 7_260_000 }
    const rows = projectWorkflow([view], { width: 80 })
    expect(rows).toContain('⏳ [调研] 对比候选方案 · 0 个 agent · 2h1m')
  })
})

describe('展开行（roster）', () => {
  it('expanded 含 id → 追加 roster 行（label + phase + 状态）', () => {
    const rows = projectWorkflow([doneRun], { width: 80, expanded: ['run-done'] })
    expect(rows).toContain('  ├ 1. 起草发布说明 · 准备 · 已完成')
    expect(rows).toContain('  ├ 2. 执行发布 · 发布 · 失败')
  })

  it('agent phase 未提供 → 行内无 phase 段', () => {
    const rows = projectWorkflow([cancelledRun], { width: 80, expanded: ['run-cancel'] })
    expect(rows).toContain('  ├ 1. 确认快照 · 已取消')
  })

  it('expanded 缺省 / 不含 id → 不渲染 roster 行', () => {
    expect(projectWorkflow([doneRun], { width: 80 }).some(r => r.includes('├'))).toBe(false)
    expect(projectWorkflow([doneRun], { width: 80, expanded: ['run-other'] }).some(r => r.includes('├'))).toBe(false)
  })

  it('outcome cancelled → 已取消', () => {
    const rows = projectWorkflow([cancelledRun], { width: 80, expanded: ['run-cancel'] })
    expect(rows).toContain('  ├ 1. 确认快照 · 已取消')
  })
})

describe('终态汇总', () => {
  it('completed → 终态：已完成 · 启动 N 个 agent', () => {
    const rows = projectWorkflow([doneRun], { width: 80, expanded: ['run-done'] })
    expect(rows).toContain('  └ 终态：已完成 · 启动 2 个 agent')
  })

  it('cancelled → 终态：已取消', () => {
    const rows = projectWorkflow([cancelledRun], { width: 80, expanded: ['run-cancel'] })
    expect(rows).toContain('  └ 终态：已取消 · 启动 1 个 agent')
  })

  it('error 带 error 消息 → 终态：出错 · {error}', () => {
    const rows = projectWorkflow([errorRun], { width: 80, expanded: ['run-err'] })
    expect(rows).toContain('  └ 终态：出错 · 上游 API 超时 · 启动 1 个 agent')
  })

  it('error 无 error 消息 → 不渲染错误段', () => {
    const view: WorkflowRunView = {
      info: { id: 'r2', meta: { name: 'n2', description: 'd2' } },
      agents: [],
      result: { stopReason: 'error', agentsStarted: 3 },
    }
    const rows = projectWorkflow([view], { width: 80, expanded: ['r2'] })
    expect(rows).toContain('  └ 终态：出错 · 启动 3 个 agent')
  })

  it('运行中 run（无 result）→ 无终态行', () => {
    const rows = projectWorkflow([runningRun], { width: 80, expanded: ['run-live'] })
    expect(rows.some(r => r.includes('终态'))).toBe(false)
  })
})

describe('多 run 顺序与展开定位', () => {
  it('按输入顺序渲染，roster 紧跟其 run 的列表行', () => {
    const rows = projectWorkflow([doneRun, runningRun], { width: 80, expanded: ['run-done'] })
    expect(rows).toContain('✓ [发布脚本] 校验并发布构建产物 · 3 阶段 · 2 个 agent · 1m20s')
    expect(rows).toContain('  ├ 1. 起草发布说明 · 准备 · 已完成')
    expect(rows).toContain('⏳ [调研] 对比候选方案 · 0 个 agent · 45s')
    const doneIdx = rows.findIndex(r => r.includes('[发布脚本]'))
    const rosterIdx = rows.findIndex(r => r.includes('起草发布说明'))
    const liveIdx = rows.findIndex(r => r.includes('[调研]'))
    expect(doneIdx).toBeGreaterThanOrEqual(0)
    expect(rosterIdx).toBe(doneIdx + 1)
    expect(liveIdx).toBeGreaterThan(rosterIdx)
  })
})

describe('窄宽截断', () => {
  it('窄宽下所有行（含 ANSI 置灰行）不超过 width', () => {
    const rows = projectWorkflow([doneRun, cancelledRun], { width: 16, expanded: ['run-done'] })
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(16)
    }
  })

  it('长行在窄宽下截断补 …', () => {
    const rows = projectWorkflow([doneRun], { width: 20 })
    const objectiveRow = rows.find(r => r.includes('…'))
    expect(objectiveRow).toBeDefined()
    expect(displayWidth(objectiveRow!)).toBeLessThanOrEqual(20)
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() => projectWorkflow([doneRun], { width: 1, expanded: ['run-done'] })).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectWorkflow([doneRun], { width: 80 })
    expect(rows).toContain('✓ [发布脚本] 校验并发布构建产物 · 3 阶段 · 2 个 agent · 1m20s')
  })
})
