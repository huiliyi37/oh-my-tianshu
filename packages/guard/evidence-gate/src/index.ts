/**
 * evidence-gate — Cordis 插件接线：编辑门 + 验证归账 + 服务面（S1 最小内核）。
 *
 * 三个钩子（全部走 dsh 既有机制，不发明事件）：
 * 1. 编辑门：`ctx.tools.guard()`——编辑工具（edit_file/write_file/apply_patch/
 *    hash_edit）对 high bugfix 义务目标源文件的首次编辑，无 RED 证据时拒绝
 *    （返回 reason）；测试/scratch 豁免；once latch 重发放行。
 * 2. 验证归账：`ctx.on('session/event')`——tool/call 记 command（bash 参数），
 *    tool/result 输出文本经 detectVerification → applyVerificationEvent（RED 三规则）。
 * 3. 服务面：`ctx.provide('evidence', …)`——宿主在任务边界创建义务/supersede/查询。
 *
 * 未装配时零行为（可选插件）；headless 无 tools/events 时静默降级。
 *
 * @module @huiliyi37/dsh-evidence-gate
 */

import type { Context } from '@huiliyi37/cordis'
import type { SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import type { ToolGuard } from '@huiliyi37/dsh-tools'
import { ObligationTracker, type FinalEvaluation } from './tracker.js'
import type { EvidenceObligation, ObligationInput } from './obligation.js'
import { detectVerification } from './verification.js'
import { evaluateTddGate, TDD_BLOCK_MESSAGE, type TddMode } from './tdd-gate.ts'
import { RED_EXEMPT_PATH_RE } from './tracker.js'

/** 插件名（cordis.yml 装配用）。 */
export const name = 'evidence-gate'

/** 编辑工具 → 参数字段提取（dsh 原生工具 str_replace_editor + 天枢风格工具兼容；
 *  提取不到路径或纯读操作时保守放行）。 */
const EDIT_TOOLS: ReadonlyArray<readonly [string, (args: Record<string, unknown>) => string | undefined]> = [
  // dsh 原生编辑工具（@huiliyi37/dsh-tool-str-replace-editor）：写命令
  // create/str_replace/insert 拦；view 是读操作放行。
  ['str_replace_editor', (args) => {
    const command = asString(args.command)
    if (command === 'view') return undefined
    return asString(args.path)
  }],
  ['edit_file', args => asString(args.filePath) ?? asString(args.path)],
  ['write_file', args => asString(args.filePath)],
  ['hash_edit', args => asString(args.filePath)],
  ['apply_patch', args => asString(args.filePath)],
]

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 解析 tool/call 的 arguments JSON（bash 的 command 字段）。 */
function parseArguments(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** 从 tool/result 消息提取文本（tool-result 块内 text 拼接）。 */
function extractResultText(message: { content: unknown[] }): string {
  const first = message.content[0]
  if (first === undefined || first === null || typeof first !== 'object' || !('content' in first)) return ''
  const inner = (first as { content?: unknown[] }).content
  if (!Array.isArray(inner)) return ''
  return inner
    .filter((b): b is { type: 'text'; text: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
        && typeof (b as { text?: string }).text === 'string')
    .map(b => b.text)
    .join('\n')
}

/** 宿主服务面：任务边界创建义务 / 作废 / 查询 / final 判定。 */
export interface EvidenceService {
  /** 创建义务（upsert 幂等；同 claim+family 不重置）。 */
  createObligation(input: ObligationInput): void
  /** 任务边界：作废所有未决义务。 */
  supersedeAll(): void
  /** 未决高风险义务（供展示/升级）。 */
  unresolvedHigh(): readonly EvidenceObligation[]
  /** final 判定（continue_once 带探针建议 / honest_blocked 带披露）。 */
  evaluateFinal(): FinalEvaluation
  /** 登记 final 续轮（宿主在 continue_once 后续轮开始时调用）。 */
  markContinued(obligationId: string): void
  /** 验证计数（agent-router 消费）。 */
  verificationCount(): number
  /** 探针冷却表（agent-router 消费）。 */
  cooldownTable(): Record<string, number>
}

/** 插件配置。 */
export interface EvidenceGateConfig {
  /** 是否启用证据门编辑拦截（默认 true；false 时仅跟踪归账）。 */
  enabled?: boolean
  /** TDD 门模式：suggest（默认，提示不拦）| enforce（硬拦截）。 */
  tddMode?: TddMode
  /** TDD 门编辑阈值（默认 3）。 */
  tddThreshold?: number
}

/** 插件装配：注册编辑门 + 验证归账 + 服务面。 */
export function apply(ctx: Context, config: EvidenceGateConfig = {}): void {
  const tracker = new ObligationTracker()
  /** tool/callId → bash command（归账配对）。 */
  const pendingCommands = new Map<string, string>()

  // —— 服务面 ——
  const service: EvidenceService = {
    createObligation: (input) => { tracker.create(input) },
    supersedeAll: () => { tracker.supersedeAll() },
    unresolvedHigh: () => tracker.unresolvedHigh(),
    evaluateFinal: () => tracker.evaluateFinal(),
    markContinued: (obligationId) => { tracker.markContinued(obligationId) },
    verificationCount: () => tracker.verificationCount(),
    cooldownTable: () => tracker.cooldownTable(),
  }
  ctx.provide('evidence', service)

  // —— 编辑门（monotonic guard：返回 reason 拒绝）——
  // 双路径注册（同 guard 引用，Set 天然去重）：
  // 1. ctx.inject 声明 tools 依赖——真实装配顶层插件 apply 时 tools 可能
  //    未加载（reflect.get 提前返回 undefined → guard 静默未注册），inject
  //    等服务就绪后注册；
  // 2. 同步 reflect.get 兜底——测试环境 provide 已就绪时立即注册。
  const editGuard: ToolGuard = (execution) => {
    if (config.enabled === false) return undefined
    const extract = EDIT_TOOLS.find(([toolName]) => toolName === execution.name)?.[1]
    if (extract === undefined) return undefined
    const args = typeof execution.arguments === 'object' && execution.arguments !== null
      ? execution.arguments as Record<string, unknown>
      : undefined
    const filePath = args === undefined ? undefined : extract(args)
    if (filePath === undefined) return undefined // 路径提取不到：保守放行
    // 证据门（L1）：high bugfix 无 RED → 拒绝（消息含精准探针建议）
    const decision = tracker.evaluateSourceEditGate(filePath)
    if (decision.block) {
      const obligation = tracker.all().find(o => o.family === 'bugfix' && o.risk === 'high'
          && (o.state === 'open' || o.state === 'attempted'))
      return obligation === undefined ? decision.message : tracker.buildRedGateMessage(filePath, obligation)
    }
    // TDD 门：编辑计数 + 评估（suggest 不拦、enforce 拦）
    tracker.trackFileModified()
    const tdd = evaluateTddGate({
      mode: config.tddMode ?? 'suggest',
      editsSinceLastTest: tracker.tddState().editsSinceLastTest,
      verifications: tracker.tddState().verifications,
      targetIsTestFile: RED_EXEMPT_PATH_RE.test(filePath),
      hasTests: true,
      ...(config.tddThreshold === undefined ? {} : { threshold: config.tddThreshold }),
    })
    if (tdd === 'block') return TDD_BLOCK_MESSAGE
    return undefined
  }

  const tools = ctx.reflect.get('tools', false) as unknown as
    { guard: (guard: ToolGuard) => () => void } | undefined
  if (tools !== undefined) tools.guard(editGuard)
  ctx.inject(['tools'], (runtimeCtx) => {
    const tools = runtimeCtx.tools as unknown as { guard: (guard: ToolGuard) => () => void }
    tools.guard(editGuard)
  })

  // —— 验证归账（session 事件流）——
  ctx.on('session/event', (_owner: { id: SessionId }, event: SessionEvent) => {
    if (event.type === 'tool/call') {
      const args = parseArguments(event.data.arguments)
      const command = asString(args?.command)
      // run_tests 无命令路径：框架命令在执行期才解析，归账侧用「run_tests + 路径」合成
      // 命令记录，让 classifyVerification 把该次运行识别为测试运行。
      const rawPath = args === undefined ? undefined : args['path']
      const paths = event.data.name === 'run_tests' && Array.isArray(rawPath)
        ? rawPath.filter((entry): entry is string => typeof entry === 'string')
        : []
      const record = command ?? (paths.length > 0 ? `run_tests ${paths.join(' ')}` : undefined)
      if (record !== undefined) pendingCommands.set(String(event.data.callId), record)
      return
    }
    if (event.type === 'tool/result') {
      const callId = String(event.data.message.source.callId)
      const command = pendingCommands.get(callId)
      if (command === undefined) return
      pendingCommands.delete(callId)
      const output = extractResultText(event.data.message)
      const meta = detectVerification(command, output)
      if (meta !== null) tracker.applyVerification(meta)
    }
  })
}

export { ObligationTracker } from './tracker.js'
export type { EvidenceObligation, ObligationInput, ObligationFamily, ObligationRisk } from './obligation.js'
export {
  applyVerificationEvent,
  blockObligation,
  createObligation,
  deriveObligationId,
  hasRedEvidence,
  recordAttempt,
  satisfyObligation,
  supersedeOpenObligations,
} from './obligation.js'
export { detectVerification, classifyVerification, isTestCommand } from './verification.js'
