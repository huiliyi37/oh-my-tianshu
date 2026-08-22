/**
 * dispatch.ts — dsh 子代理 seam 派发（不搬天枢 worker/dispatcher 生命周期）。
 *
 * 子代理 = ctx.subagents.start（named provider，默认 spawn）→ prompt 注入
 * 任务文本（child 的首条用户消息）→ await run.result（结构化终态）→
 * dispose 清理。血源由 seam 自动写（parentSession/origin:'subagent'/
 * delegationDepth），子代理进入 /subagents、list_agents 与后代投影；
 * 结果经 session/event 归账回 evidence-gate（零新通道）。profile 工具
 * 限制经 toolFilter fail loud 安装：未知工具名/缺失服务中止派发，绝不
 * 静默放宽为全量工具面。
 *
 * @module @huiliyi37/dsh-agent-router/dispatch
 */

import type { Context } from '@huiliyi37/cordis'
import type { ContentBlock } from '@huiliyi37/dsh-llm'
import type { SessionId } from '@huiliyi37/dsh-session'
import type { ObjectJsonSchema } from '@huiliyi37/dsh-tools'
import { boundFinding, type RouterFinding } from './finding.js'

/**
 * Resolved delegation role (agent-definitions) merged into one dispatch: the
 * role's tool allow list already intersected with the profile ceiling, plus the
 * persona body and sandbox narrowing to transfer.
 */
export interface DispatchRole {
  /** Effective tool allow list: role tools ∩ profileTools ceiling (non-empty). */
  tools: string[]
  /** Role persona body, transferred as the child's shadowing persona. */
  persona: string
  /** Role sandbox narrowing; only `read-only` is representable. */
  sandboxMode?: 'read-only'
}

/** 子代理派发选项。 */
export interface DispatchOptions {
  /** 子代理 profile（任务语义 + 工具集限制）。 */
  profile: 'code_scout' | 'verifier'
  /** 注入子代理的任务描述。 */
  task: string
  /** 目标文件（任务文本携带；未来用于工具限制）。 */
  targets: string[]
  /** 模型选择（provider/model）。 */
  provider: string
  model: string
  /** 本 profile 允许的工具集（toolFilter allow 列表；resolveProfileTools 已校验）。 */
  tools: string[]
  /** 子代理 provider 名（ctx.subagents 注册名；apply 已校验非空）。 */
  subagentProvider: string
  /** 父会话（活 agent）身份——seam 由此派生 workspace/血统/深度。 */
  parentSessionId: SessionId
  /** 派发取消通道（execute 透传；缺省新 controller）。 */
  signal: AbortSignal
  /** 预算形状（resolveBudgetConfig + shapeWriteBudget 计算；记录用）。 */
  budget: { maxTurns: number; timeoutMs: number }
  /**
   * 相对运行预算（Phase 2 强制面）：步数与墙钟经 seam runBudget 强制，越界以
   * 可区分的 budget-exhausted 终态收敛；缺省不预算（手工 execute 路径）。
   */
  runBudget?: { maxSteps: number; timeoutMs: number }
  /** 已解析角色（agent-definitions；缺省按 profile 内置工具集派发）。 */
  role?: DispatchRole
  /**
   * 结构化 finding schema（Phase 3）：请求子代理闭合结构化输出；completed 且
   * 捕获成功时经 boundFinding 限界后写入 router/outcome。
   */
  findingSchema?: ObjectJsonSchema
}

/**
 * profile → 默认允许的工具集（restrict allow 列表；只读/验证必需工具，
 * 名称为 gen-tool-catalog 权威名单）。部署可经 config.profileTools 覆盖
 * （如只装少量工具的精简装配）——见 index.ts 的 resolveProfileTools。
 */
export const DEFAULT_PROFILE_TOOLS: Record<DispatchOptions['profile'], string[]> = {
  // 只读侦查：搜索/读取 + bash（只读命令侦查用）
  code_scout: ['grep', 'read', 'glob', 'repo_graph', 'semantic_search', 'bash'],
  // 独立复核：只读 + bash（跑测试命令验证）
  verifier: ['grep', 'read', 'glob', 'repo_graph', 'bash'],
}

/**
 * 子代理任务文本前缀（fixture 与生产共享的契约锚点）。headless e2e 的
 * cli-mock-llm 以此前缀识别子代理会话并走 mock 分支——改名必须同步
 * 该 fixture 的引用（本常量导出即耦合面，语义勿改，仅可增删后缀）。
 */
export const SUBAGENT_TASK_PREFIX = '【子代理任务'

/** dsh subagents 服务最小面（声明合并的完整面由运行时提供）。 */
interface SubagentsFacet {
  start(name: string, request: {
    label?: string
    prompt: Array<{ type: 'text'; text: string }>
    parent: unknown
    signal: AbortSignal
    agentOptions?: { provider?: string; model?: string }
    toolFilter?: { allow: string[] }
    persona?: string
    sandboxMode?: 'read-only'
    runBudget?: { maxSteps: number; timeoutMs: number }
  }): Promise<{
    id: SessionId
    result: Promise<{ stopReason: string; output: ContentBlock[]; structured?: unknown }>
    dispose(): Promise<void>
  }>
}

/** dsh agents 服务最小面（父会话解析）。 */
interface AgentsFacet {
  get(sessionId: SessionId): unknown
}

/** 派发终态（execute 回传调用方；与 run.result 一致）。 */
export interface DispatchOutcome {
  /** 子代理 sessionId（run.id）。 */
  sessionId: SessionId
  /** 终态原因（SubagentResult.stopReason 原样透传）。 */
  stopReason: string
  /** 子代理最终 assistant 输出（ContentBlock 数组）。 */
  output: ContentBlock[]
  /** 记录用预算（maxTurns + deadlineMs=派发时点+timeoutMs）。 */
  budget: { maxTurns: number; deadlineMs: number }
  /** 有界结构化 finding（completed 且捕获成功；与 router/outcome 持久值一致）。 */
  finding?: RouterFinding
}

/**
 * 派发一个子代理：subagents.start（named provider）→ prompt 注入任务 →
 * await run.result → dispose。toolFilter 经 seam 的 fail-loud 校验安装
 * （未知工具名拒绝 start）；父会话必须是活 agent（seam 从它派生血统）。
 * acceptance 时向父会话落 log-only `router/route`，settle 后落
 * `router/outcome`（终态可自日志重建）。
 * @param ctx - 宿主上下文（需 subagents 与 agents 服务）。
 * @param opts - 派发选项。
 * @returns 派发终态（sessionId/stopReason/output）。
 */
export async function dispatchSubagent(ctx: Context, opts: DispatchOptions): Promise<DispatchOutcome> {
  const subagents = ctx.reflect.get('subagents', false) as unknown as SubagentsFacet | undefined
  if (subagents === undefined) throw new Error('agent-router: subagents service unavailable (cannot dispatch subagent)')
  const agents = ctx.reflect.get('agents', false) as unknown as AgentsFacet | undefined
  if (agents === undefined) throw new Error('agent-router: agents service unavailable (cannot resolve the parent session)')
  const parent = agents.get(opts.parentSessionId)
  if (parent === undefined) {
    throw new Error(`agent-router: parent session not live (cannot dispatch subagent): ${opts.parentSessionId}`)
  }
  const taskText = [
    `${SUBAGENT_TASK_PREFIX} · ${opts.profile}】`,
    opts.task,
    opts.targets.length > 0 ? `目标文件: ${opts.targets.join(', ')}` : '',
  ].filter(Boolean).join('\n')
  const run = await subagents.start(opts.subagentProvider, {
    label: `router-${opts.profile}`,
    prompt: [{ type: 'text', text: taskText }],
    parent,
    signal: opts.signal,
    agentOptions: { provider: opts.provider, model: opts.model },
    // 角色在场时以角色工具集（已与 profile 天花板求交）收紧 toolFilter，
    // 并透传 persona 与 sandbox 收窄；缺省回落 profile 内置工具集。
    toolFilter: { allow: opts.role !== undefined ? opts.role.tools : opts.tools },
    ...opts.role?.persona !== undefined ? { persona: opts.role.persona } : {},
    ...opts.role?.sandboxMode !== undefined ? { sandboxMode: opts.role.sandboxMode } : {},
    ...opts.runBudget !== undefined ? { runBudget: opts.runBudget } : {},
    ...opts.findingSchema !== undefined ? { outputSchema: opts.findingSchema } : {},
  })
  try {
    // 路由接受记录（决策可审计）：log-only 落父会话，start 成功即写
    // （acceptance 时机，早于 result 结算，崩溃也能留痕）。
    const parentSession = (parent as { session?: { append(type: string, data: unknown): void } }).session
    if (parentSession === undefined) {
      throw new Error('agent-router: parent agent has no session (cannot record the route decision)')
    }
    const budget = { maxTurns: opts.budget.maxTurns, deadlineMs: Date.now() + opts.budget.timeoutMs }
    parentSession.append('router/route', {
      profile: opts.profile,
      task: opts.task,
      targets: opts.targets,
      subagentSessionId: run.id,
      budget,
    })
    // result 在子级失败时不 reject（stopReason: 'error'）；仅基础设施故障
    // reject——finally dispose 覆盖两条路径（含 append 抛错）。
    const result = await run.result
    // 结构化 finding：仅在 completed 且捕获成功时限界持久；错误、取消、预算
    // 终态与形状非法都不伪造 finding（父边界一次性净化，见 boundFinding）。
    const finding: RouterFinding | undefined = result.stopReason === 'completed' && result.structured !== undefined
      ? boundFinding(result.structured)
      : undefined
    parentSession.append('router/outcome', {
      subagentSessionId: run.id,
      stopReason: result.stopReason,
      ...(finding !== undefined ? { finding } : {}),
    })
    return {
      sessionId: run.id,
      stopReason: result.stopReason,
      output: result.output,
      budget,
      ...(finding !== undefined ? { finding } : {}),
    }
  } finally {
    await run.dispose()
  }
}
