/**
 * verification.ts — 验证检测（零测试框架耦合，天枢同款命令文本启发式）。
 *
 * 从工具结果（bash 输出文本）识别「是否测试命令」与「结果状态」：
 * - 命令含 test 关键字（vitest/pytest/node --test/npm test/pnpm test 等）→ 识别
 * - 输出启发式：全过摘要/无失败标记 → passed；失败标记/断言错误 → failed；
 *   超时/中断 → blocked
 * 不 import 任何测试框架——命令文本 + 输出文本纯函数判定。
 *
 * @module @deepseek-ai/dsh-evidence-gate/verification
 */

import type { VerificationMetadata } from './obligation.js'

/** 一次验证的结果状态，转发义务归账用的判定域。 */
export type VerificationStatus = VerificationMetadata['status']

/** 测试命令启发式：命令文本含 test 关键字。 */
const TEST_COMMAND_RE = /\b(vitest|pytest|jest|mocha|ava|tap)\b|node --test|\b(test|tests?)\b|--coverage/

/** 失败输出标记（优先于 passed 判定——失败证据不能被摘要遮蔽）。 */
const FAILED_RE = /\b(failed|failures?|FAILED|Failing|AssertionError)\b/i
/** 超时/中断标记。 */
const BLOCKED_RE = /\b(timed out|timeout|SIGKILL|SIGTERM|killed|interrupted)\b/i

/**
 * 识别命令是否为测试命令。
 * @param command - 工具执行的命令文本。
 * @returns 是测试命令返回真。
 */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND_RE.test(command)
}

/**
 * 由命令 + 输出判定验证状态；非测试命令返回 null。
 * @param command - 命令文本。
 * @param output - 工具结果文本（可能为空）。
 * @returns passed / failed / blocked，非测试命令返回 null。
 */
export function classifyVerification(command: string, output: string | undefined): VerificationStatus | null {
  const text = output ?? ''
  if (!isTestCommand(command)) return null
  if (BLOCKED_RE.test(text)) return 'blocked'
  if (FAILED_RE.test(text)) return 'failed'
  if (text.trim().length === 0) return 'blocked' // 无输出：状态未知
  return 'passed'
}

/**
 * 从命令 + 输出构造 VerificationMetadata（供归账）；非测试命令返回 null。
 * @param command - 命令文本。
 * @param output - 输出文本（可选：命令识别不依赖输出，缺失时按无输出判定）。
 * @param targetFiles - 验证涉及的目标文件（可选，来自命令/上下文）。
 * @returns 验证元数据或 null。
 */
export function detectVerification(command: string, output?: string, targetFiles?: string[]): VerificationMetadata | null {
  const status = classifyVerification(command, output)
  if (status === null) return null
  return { status, command, ...(targetFiles === undefined ? {} : { targetFiles }) }
}
