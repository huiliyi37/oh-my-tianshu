/**
 * memory-consolidate 的成功门控：会话事件日志 → 通过/否决判定（纯函数、确定性）。
 *
 * 契约（Agent Note
 * `.agents/notes/implemented/feature/2026-08-18-memory-consolidate.md`
 * 的"New experience is admitted only behind a success signal"）：
 * - 两个级别都要求至少一个 turn 以 completed 结束（否则无从谈成功）。
 * - 未解决的工具错误 = 某工具的 tool/result 带 error，且其后（按 seq）没有同
 *   工具名的成功 tool/result。`standard`（缺省）只看最后一个 turn 的未解决
 *   错误；`strict` 看整个会话。
 * - 可观察的测试运行（tool/call 的名称或参数匹配 test/spec/vitest/pytest/
 *   jest）结果文本出现失败计数而其后没有通过计数时，按同级别范围记一条
 *   未解决测试失败。
 * 门控失败时不提取成功候选；失败由 extract.ts 的 failureCandidates 单独记录
 * （topic failure-pattern，绝不混入成功事实）。
 *
 * @module @huiliyi37/dsh-memory-consolidate/gate
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'

/** 门控级别：standard（缺省；末轮范围）或 strict（全会话范围）。 */
export type GateLevel = 'standard' | 'strict'

/** 门控判定结果（passed=false 时 reasons 非空，供日志诊断）。 */
export interface GateVerdict {
  /** 是否通过成功门控。 */
  passed: boolean
  /** 否决原因（稳定字符串；log-only 诊断用）。 */
  reasons: string[]
}

/** 一次未解决的失败信号（工具错误或测试失败）。 */
export interface UnresolvedFailure {
  /** 信号来源（工具名或 'test-run'）。 */
  subject: string
  /** 失败码或匹配到的失败文本摘要。 */
  detail: string
  /** 失败事件的 seq（provenance）。 */
  seq: number
  /** 失败所在 turn。 */
  turn: number
}

/** 测试运行的 tool/call 识别（名称或参数含测试运行器特征）。 */
const TEST_RUN_RE = /test|spec|vitest|pytest|jest/i

/** 结果文本里的失败计数（"3 failed" / "2 tests failing" / "FAIL"）。 */
const TEST_FAIL_RE = /\b\d+\s+(?:tests?\s+)?fail(?:ed|ing)\b|\bFAIL(?:ED)?\b/

/** 结果文本里的通过计数（"5 passed" / "all tests pass"）。 */
const TEST_PASS_RE = /\b\d+\s+(?:tests?\s+)?pass(?:ed|ing)\b|\ball tests pass\b/i

/** tool/result 事件的模型可见文本（ToolResultMessage 内层 content 的文本块拼接）。
 * @param event - 一条 tool/result 会话事件。
 * @returns 结果文本（文本块以换行拼接；非文本块忽略）。
 */
export function toolResultText(event: SessionEvent<'tool/result'>): string {
  const [block] = event.data.message.content
  return block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : []).join('\n')
}

/** callId → 工具名（tool/call 事件的配对表）。 */
function toolNamesByCallId(events: readonly SessionEvent[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call') names.set(event.data.callId, event.data.name)
  }
  return names
}

/** 测试运行可观察的 callId 集合（tool/call 名称或参数匹配 TEST_RUN_RE）。 */
function testRunCallIds(events: readonly SessionEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool/call' && (TEST_RUN_RE.test(event.data.name) || TEST_RUN_RE.test(event.data.arguments))) {
      ids.add(event.data.callId)
    }
  }
  return ids
}

/** 会话的最后 turn 号（无 turn 事件时按 1 计）。 */
function lastTurnOf(events: readonly SessionEvent[]): number {
  let turn = 1
  for (const event of events) {
    if (event.type === 'turn/start' && event.data.turn > turn) turn = event.data.turn
  }
  return turn
}

/**
 * 收集会话日志里的未解决失败信号（工具错误 + 可观察的测试失败），按 seq 升序。
 * 一个错误在其后存在同工具名的成功结果即视为已解决；一个测试失败在其后存在
 * 通过计数即视为已解决。
 * @param events - 会话事件日志。
 * @returns 未解决失败信号（空数组 = 无未解决失败）。
 */
export function unresolvedFailures(events: readonly SessionEvent[]): UnresolvedFailure[] {
  const names = toolNamesByCallId(events)
  const testRuns = testRunCallIds(events)
  const results = events.filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
  const failures: UnresolvedFailure[] = []
  for (const [index, event] of results.entries()) {
    const later = results.slice(index + 1)
    const toolName = names.get(event.data.message.content[0].toolCallId)
    if (event.data.error !== undefined && toolName !== undefined) {
      const resolved = later.some(candidate =>
        candidate.data.error === undefined && names.get(candidate.data.message.content[0].toolCallId) === toolName)
      if (!resolved) {
        failures.push({
          subject: toolName,
          detail: event.data.error.code,
          seq: event.seq,
          turn: event.data.turn,
        })
      }
      continue
    }
    const callId = event.data.message.content[0].toolCallId
    if (event.data.error === undefined && testRuns.has(callId)) {
      const text = toolResultText(event)
      const failure = TEST_FAIL_RE.exec(text)
      if (failure !== null && !later.some(candidate => TEST_PASS_RE.test(toolResultText(candidate)))) {
        failures.push({ subject: 'test-run', detail: failure[0], seq: event.seq, turn: event.data.turn })
      }
    }
  }
  return failures
}

/**
 * 成功门控：至少一个 completed turn 且范围内无未解决失败。
 * @param events - 会话事件日志。
 * @param level - standard 只看最后一个 turn；strict 看整个会话。
 * @returns 判定结果（含否决原因）。
 */
export function evaluateSuccessGate(events: readonly SessionEvent[], level: GateLevel): GateVerdict {
  const reasons: string[] = []
  if (!events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')) {
    reasons.push('no-completed-turn')
  }
  const lastTurn = lastTurnOf(events)
  for (const failure of unresolvedFailures(events)) {
    if (level === 'standard' && failure.turn !== lastTurn) continue
    reasons.push(
      failure.subject === 'test-run'
        ? `unresolved-test-failure:${failure.detail}`
        : `unresolved-tool-error:${failure.subject}:${failure.detail}`,
    )
  }
  return { passed: reasons.length === 0, reasons }
}
