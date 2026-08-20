/**
 * 规则兜底提醒（纯函数）：工具结果观察 → 尾部提醒的触发判定与渲染。
 *
 * 设计契约：Agent Note
 * `.agents/notes/implemented/feature/2026-08-18-adaptive-memory-stm.md`
 * 的 Retrieval 一节——工具调用触及 STM 索引外的实体/路径、或结果出现未解释
 * 的错误码时，在会话尾部追加一条提醒（memory_search 可能有帮助）。提醒经
 * `ctx.systemPrompt.context()` 的 append-on-change 通道进入模型可见面
 * （memory:reminder 贡献；绝不编辑 system prompt），由 context-snapshot
 * 机制落日志（model-visible ⟺ logged）。
 *
 * 启发式刻意保持简单（README 记录）：
 * - 「未覆盖」= 主题串不是当前 STM 快照文本的子串；
 * - 错误码来源：失败结果的 error.info.code + 任意结果文本里的
 *   `E[A-Z]{3,}` 形 token（成功结果也可能携带错误码文本）；错误码优先于
 *   路径检查；
 * - 路径形 token 取自调用参数 JSON 里含 `/` 的段；
 * - 每次触发只报第一个未覆盖的主题（每条提醒一个主题，量由预算限制）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/remind
 */

/** 路径形 token：至少一段 `/` 分隔（与 intent.ts 的实体提取同一形状）。 */
const PATH_RE = /(?:[\w@.+-]+\/)+[\w@.+-]+/g
/** 错误码形 token：ENOENT / ECONNREFUSED 风格。 */
const ERROR_CODE_RE = /\bE[A-Z]{3,}[A-Z0-9]*\b/g

/** 不触发提醒的工具名（记忆工具自身：检索/写入不应自我提醒）。 */
const MEMORY_TOOLS = new Set(['memory_search', 'memory_save'])

/** 提醒触发：未覆盖的实体/路径，或未解释的错误码（closed union）。 */
export type ReminderTrigger =
  | { kind: 'unknown-entity'; subject: string }
  | { kind: 'error-code'; subject: string }

/** detectReminder 的输入（tools/result 观察到的调用与结果切片）。 */
export interface ReminderInput {
  /** 工具名（memory_* 工具不触发）。 */
  toolName: string
  /** 调用参数的 JSON 串（路径形 token 的提取源）。 */
  argumentsJson: string
  /** 结果是否失败。 */
  isError: boolean
  /** 结构化错误码（ToolFailure.info.code；可选）。 */
  errorCode?: string | undefined
  /** 结果文本块拼接（错误码形 token 的提取源）。 */
  resultText: string
}

/**
 * 判定一次工具结果是否触发兜底提醒（确定性纯函数）。
 * @param input - 工具调用与结果切片。
 * @param stmText - 当前 STM 快照文本（'' = 无快照；「未覆盖」= 非其子串）。
 * @returns 触发主题；不触发时为 undefined。
 */
export function detectReminder(input: ReminderInput, stmText: string): ReminderTrigger | undefined {
  if (MEMORY_TOOLS.has(input.toolName)) return undefined
  const uncovered = (subject: string): boolean => subject.length <= 200 && !stmText.includes(subject)
  const codes = [
    ...input.errorCode === undefined ? [] : [input.errorCode],
    ...[...input.resultText.matchAll(ERROR_CODE_RE)].map(match => match[0]),
  ]
  for (const code of codes) {
    if (uncovered(code)) return { kind: 'error-code', subject: code }
  }
  for (const match of input.argumentsJson.matchAll(PATH_RE)) {
    if (uncovered(match[0])) return { kind: 'unknown-entity', subject: match[0] }
  }
  return undefined
}

/**
 * 渲染一条提醒（模型可见；确定性——只含触发主题，无时间戳等易变标量）。
 * @param trigger - 触发主题。
 * @returns 单行提醒文本。
 */
export function renderReminder(trigger: ReminderTrigger): string {
  if (trigger.kind === 'error-code') {
    return `记忆提示：工具结果出现错误码「${trigger.subject}」，当前记忆索引未覆盖；如有历史排查经验，可用 memory_search 检索。`
  }
  return `记忆提示：工具调用涉及「${trigger.subject}」，当前记忆索引未覆盖；如有相关历史经验，可用 memory_search 检索。`
}

/** 提醒预算状态（每会话；text 为当前挂起的提醒贡献文本，'' = 无）。 */
export interface ReminderBudget {
  /** 当前提醒文本（memory:reminder 贡献的渲染源）。 */
  text: string
  /** 本轮计数的轮次基准。 */
  turn: number
  /** 本轮已发提醒数。 */
  turnCount: number
  /** 本 intent 计数的 intent 基准。 */
  intentId: string
  /** 本 intent 已发提醒数。 */
  intentCount: number
}

/**
 * 空预算状态（会话首次触发前）。
 * @returns 全零的预算状态（无挂起文本）。
 */
export function emptyReminderBudget(): ReminderBudget {
  return { text: '', turn: 0, turnCount: 0, intentId: '', intentCount: 0 }
}

/**
 * 消费一次提醒预算：按轮次/intent 滚动复位后检查上限；允许时计数 +1。
 * intent 切换同时清空挂起文本（旧 intent 的提醒不带进新 intent）。
 * @param budget - 会话预算状态（就地更新）。
 * @param turn - 当前轮次。
 * @param intentId - 当前 intent（无 STM 状态时调用方传 'pre-intent'）。
 * @param maxPerTurn - 每轮提醒上限（插件 Config）。
 * @param maxPerIntent - 每 intent 提醒上限（插件 Config）。
 * @returns 本次是否允许发提醒。
 */
export function consumeReminderBudget(
  budget: ReminderBudget,
  turn: number,
  intentId: string,
  maxPerTurn: number,
  maxPerIntent: number,
): boolean {
  if (budget.intentId !== intentId) {
    budget.intentId = intentId
    budget.intentCount = 0
    budget.text = ''
  }
  if (budget.turn !== turn) {
    budget.turn = turn
    budget.turnCount = 0
  }
  if (budget.turnCount >= maxPerTurn || budget.intentCount >= maxPerIntent) return false
  budget.turnCount += 1
  budget.intentCount += 1
  return true
}
