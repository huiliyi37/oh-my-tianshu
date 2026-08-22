/**
 * synthesis.ts — 主代理综合提示与采用声明（闭环 Phase 2）。
 *
 * 从会话日志推导「未综合的 child 结论」（router/outcome 无配对
 * router/adoption）与「验证缺口」（最近文件改动后无新验证），渲染主代理
 * 综合提示（synthesis rubric：主代理拥有最终综合与写入、不混合不平均、
 * deferred ≠ deleted、冲突显式解决）。纯函数零状态——model-visible 内容
 * 全部派生自已落盘的日志事件。
 *
 * @module @huiliyi37/dsh-agent-router/synthesis
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import type { RouterFinding } from './finding.js'

/** 采用声明工具名。 */
export const ADOPT_TOOL_NAME = 'router_adopt'

/** 采用/拒绝判定。 */
export type AdoptVerdict = 'adopt' | 'reject'

/** 已校验的采用声明参数。 */
export interface AdoptArgs {
  /** 被采用的 child 会话 id（对应一条 router/outcome 记录）。 */
  subagentSessionId: string
  /** 判定：adopt（整合进主代理结论）/ reject（说明理由）。 */
  verdict: AdoptVerdict
  /** 判定理由（非空）。 */
  reason: string
}

/**
 * 综合提示 rubric（角色裁定纪律——天枢 team-perspectives 的提示词形态，
 * 不写合并代码）。Config `synthesis.section` 可覆盖。
 */
export const DEFAULT_SYNTHESIS_SECTION = [
  'You have received findings from dispatched subagents. For each finding, call `router_adopt` exactly once: adopt (integrate it into your work) or reject (state why).',
  'Synthesis discipline: you own the final synthesis and all writes — findings are skeleton/risk/conflict/alternative inputs, never votes; do not blend or average findings; a deferred decision is not a deletion; resolve conflicts explicitly, never drop one silently.',
].join(' ')

/** 一条未综合的 child 结论（派生自日志；finding 为持久有界值）。 */
export interface PendingOutcome {
  /** child 会话 id。 */
  subagentSessionId: string
  /** 终态原因。 */
  stopReason: string
  /** 有界结构化 finding（仅 completed 且捕获成功时存在；逐字渲染）。 */
  finding?: RouterFinding
}

/**
 * 未综合的 child 结论：router/outcome 减去已配对 router/adoption。
 * @param events - 会话事件日志（权威来源）。
 * @returns 按日志顺序的未综合结论。
 */
export function pendingOutcomes(events: readonly SessionEvent[]): PendingOutcome[] {
  const adopted = new Set<string>()
  const pending: PendingOutcome[] = []
  for (const event of events) {
    if (event.type === 'router/outcome') {
      const data = event.data as { subagentSessionId?: unknown; stopReason?: unknown; finding?: unknown }
      if (typeof data.subagentSessionId === 'string' && typeof data.stopReason === 'string') {
        pending.push({
          subagentSessionId: data.subagentSessionId,
          stopReason: data.stopReason,
          ...(data.finding !== undefined && typeof data.finding === 'object' && data.finding !== null
            ? { finding: data.finding as RouterFinding }
            : {}),
        })
      }
    } else if (event.type === 'router/adoption') {
      const { subagentSessionId } = event.data as { subagentSessionId?: unknown }
      if (typeof subagentSessionId === 'string') adopted.add(subagentSessionId)
    }
  }
  return pending.filter(entry => !adopted.has(entry.subagentSessionId))
}

/** 写/改类工具名（claim-audit 的 mutation 面）。 */
const MUTATION_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'str_replace_editor'])
/**
 * 验证类工具名（claim-audit 的 verification 面）。
 *
 * TODO: 这两个名字都由 dsh-tool-run-tests 注册，而 TUI 已停用该行，于是那里
 * 的 lastVerification 恒为 -1——任何一次写/改都判成缺口。模型实际是用 bash
 * 跑测试来验证的（doom-loop-guard 的 test-churn 检测器就按「含 test 的 bash
 * 命令」识别），本集合看不见这条路径。修法是按命令内容识别 bash 验证，而不是
 * 把工具名单继续加长。
 */
const VERIFICATION_TOOLS: ReadonlySet<string> = new Set(['run_tests', 'related_tests'])

/**
 * 验证缺口（claim-audit 新鲜度概念的 DSH 形态）：最近一次写/改类工具
 * 成功之后没有新的验证类工具成功——主代理若声称「验证通过」需自证。
 * @param events - 会话事件日志（权威来源）。
 * @returns 存在验证缺口时为 true。
 */
export function verificationGap(events: readonly SessionEvent[]): boolean {
  let lastMutation = -1
  let lastVerification = -1
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event?.type !== 'tool/call') continue
    const name = event.data.name
    if (MUTATION_TOOLS.has(name)) lastMutation = index
    if (VERIFICATION_TOOLS.has(name)) lastVerification = index
  }
  return lastMutation > lastVerification
}

/**
 * 渲染主代理综合提示：列出未综合结论（有 finding 时逐字引用持久值）+
 * rubric；含验证缺口时附软提醒（不硬拦——主代理拥有最终权）。finding 字符串
 * 在派发边界已一次性净化限界，此处不再加工——模型可见与日志持久逐字一致。
 * @param pending - 未综合结论。
 * @param gap - 验证缺口。
 * @param rubric - rubric 文本（Config 覆盖或缺省）。
 * @returns 提示文本；无未综合结论时为 ''。
 */
export function renderSynthesisSection(
  pending: readonly PendingOutcome[],
  gap: boolean,
  rubric: string,
): string {
  if (pending.length === 0) return ''
  const lines = pending.map((entry) => {
    const head = `- subagent ${entry.subagentSessionId} (${entry.stopReason})`
    if (entry.finding === undefined) return `${head} — declare adopt or reject with router_adopt`
    const verdict = entry.finding.kind === 'verify' ? ` [${entry.finding.verdict}]` : ''
    const items = entry.finding.findings.length > 0
      ? ` Findings:\n${entry.finding.findings.map(item => `  • ${item}`).join('\n')}`
      : ''
    // 行尾短语是 cli-mock-llm ADOPT_SECTION_MARKER 的契约锚点，逐字保留。
    return `${head}${verdict} — ${entry.finding.summary}.${items}\n  declare adopt or reject with router_adopt`
  })
  const gapLine = gap
    ? 'Note: recent file mutations have no fresh verification in the log — if you claim verification passed, point at the verification that proves it.'
    : ''
  return [lines.join('\n'), gapLine, rubric].filter(line => line !== '').join('\n')
}

/**
 * 校验采用声明参数（工具边界）：subagentSessionId/verdict/reason 形状，
 * 违规按契约消息拒绝。
 * @param args - 原始工具参数（wire 边界 unknown）。
 * @returns 校验后的参数。
 */
export function parseAdoptArgs(args: unknown): AdoptArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error(`${ADOPT_TOOL_NAME}: arguments must be an object with subagentSessionId, verdict, and reason`)
  }
  const raw = args as Record<string, unknown>
  const subagentSessionId = raw.subagentSessionId
  if (typeof subagentSessionId !== 'string' || subagentSessionId.trim() === '') {
    throw new Error(`${ADOPT_TOOL_NAME}: subagentSessionId must be a non-empty string`)
  }
  const verdict = raw.verdict
  if (verdict !== 'adopt' && verdict !== 'reject') {
    throw new Error(`${ADOPT_TOOL_NAME}: verdict must be 'adopt' | 'reject', got ${JSON.stringify(verdict)}`)
  }
  const reason = raw.reason
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Error(`${ADOPT_TOOL_NAME}: reason must be a non-empty string`)
  }
  return { subagentSessionId, verdict, reason: reason.trim() }
}
