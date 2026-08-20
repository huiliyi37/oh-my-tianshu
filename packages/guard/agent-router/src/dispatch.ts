/**
 * dispatch.ts — dsh 原生子代理派发（不搬天枢 worker/dispatcher 生命周期）。
 *
 * 子代理 = dsh 原生 agent 会话：ctx.agents.create（新 sessionId）→
 * followup 注入任务文本（Agent 公开方法，最简单可靠的任务入口）→
 * whenIdle 等待完成 → dispose 清理。结果经 session/event 归账回
 * evidence-gate（零新通道）。profile 工具集在 setup 内经 tools.restrict
 * fail loud 安装：未知工具名或缺失 tools 服务直接中止派发（create 回滚），
 * 绝不静默放宽为全量工具面。
 *
 * @module @huiliyi37/dsh-agent-router/dispatch
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { SessionId } from '@huiliyi37/dsh-session'
import { SessionId as brandSessionId } from '@huiliyi37/dsh-session'

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
  /** 本 profile 允许的工具集（restrict allow 列表；resolveProfileTools 已校验）。 */
  tools: string[]
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

/** dsh agents 服务最小面（声明合并的完整面由运行时提供）。 */
interface AgentsFacet {
  create(options: {
    sessionId: SessionId
    agentOptions: { provider: string; model: string }
    setup?(agentCtx: unknown): unknown
  }): Promise<{ agent: { followup(input: unknown): Promise<void>; whenIdle(): Promise<void> }; dispose(): Promise<void> }>
}

/**
 * 派发一个子代理：create（setup 内 restrict 工具集）→ followup 注入任务 →
 * whenIdle 等待 → dispose。restrict 在 agent.ctx 作用域调用（tools.restrict
 * 要求 scoped context）；未知工具名或缺失 tools 服务 fail loud——setup
 * 抛错经 create 回滚，派发整体拒绝，不静默放宽权限。
 * @param ctx - 宿主上下文（需 agents 服务）。
 * @param opts - 派发选项。
 * @returns 子代理 sessionId（结果经事件流归账）。
 */
export async function dispatchSubagent(ctx: Context, opts: DispatchOptions): Promise<SessionId> {
  const agents = ctx.reflect.get('agents', false) as unknown as AgentsFacet | undefined
  if (agents === undefined) throw new Error('agent-router: agents service unavailable (cannot dispatch subagent)')
  const id = brandSessionId(`session-router-${randomUUID()}`)
  const handle = await agents.create({
    sessionId: id,
    agentOptions: { provider: opts.provider, model: opts.model },
    setup: (agentCtx) => {
      // 工具限制：profile → allow 列表；restrict 需 scoped context（agent.ctx）。
      // 未知工具名或缺失 tools 服务都 fail loud——静默降级会让 profile
      // 带着全量写工具面运行，等于没有权限约束。
      const tools = (agentCtx as { tools?: { restrict(filter: { allow: string[] }): unknown } }).tools
      if (tools === undefined) {
        throw new Error('agent-router: subagent tools service unavailable (cannot apply the profile tool restriction)')
      }
      tools.restrict({ allow: opts.tools })
    },
  })
  try {
    const taskText = [
      `${SUBAGENT_TASK_PREFIX} · ${opts.profile}】`,
      opts.task,
      opts.targets.length > 0 ? `目标文件: ${opts.targets.join(', ')}` : '',
    ].filter(Boolean).join('\n')
    // createUserMessage 补全 id/role/source——缺 source 时 agent-loop 的
    // pre-step 监听者（如 repeat-tool-guard 读 message.source.kind）会崩。
    await handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: taskText }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
  } finally {
    await handle.dispose() // 任何路径都清理（followup 失败也 dispose）
  }
  return id
}
