/**
 * dsh-adaptive-memory 公共类型：intent 状态、STM 候选项与 log-only 会话事件。
 *
 * 设计契约见 Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`：
 * STM 快照经 `ctx.systemPrompt.context()` 的 append-on-change 通道进入模型
 * 可见面；本文件的 retrieval/refresh 决策事件只进会话日志（无 surfaceOp），
 * 不进模型可见面（model-visible ⟺ logged：STM 本身由 context-snapshot 机制记录）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/types
 */

/** STM 刷新触发原因（closed union；记录在 log-only 事件上）。 */
export type StmRefreshReason = 'initial' | 'intent-change' | 'topic-version' | 'new-entity' | 'pressure-turns'

/** 一个会话的 intent 状态（阶段一：纯启发式推导，无额外模型调用）。 */
export interface IntentState {
  /** 确定性 intent 序号：`intent-<目标锚点序号>`（锚点 = 首个用户消息或之后含目标动词的用户消息）。 */
  intentId: string
  /** 规范化 intent 键（锚点消息的关键词签名；同一 intent 逐字节稳定）。 */
  intentKey: string
  /** 当前 intent 锚点所在的轮次。 */
  startedAtTurn: number
  /** 最近一次 STM 刷新发生的轮次（pressure 阀门的基准）。 */
  lastReviewedTurn: number
  /** 当前 intent 期间从工具调用提取的实体（文件路径、错误码；按首次出现排序）。 */
  entities: string[]
  /** 相关 topic 的版本指纹（候选条目 id+版本戳的确定性摘要；仅用于门控比较，绝不渲染）。 */
  topicVersions: Record<string, string>
}

/** STM 行：一条候选记忆的渲染输入。 */
export interface StmCandidate {
  /** 完整条目 id（门控签名与 memory_search excludeIds 用；渲染只展示短 id 前缀）。 */
  id: string
  /** 主题（条目的首个 tag，无 tag 时渲染 '-'）。 */
  topic: string
  /** 单行摘要（条目首行截断）。 */
  summary: string
  /** 关键词（条目 tags 截断；空时渲染 '-'）。 */
  keywords: string[]
  /**
   * 版本戳（updatedAt ?? createdAt；仅参与门控签名，绝不渲染——
   * canonicalization 不变量：易变字段不影响输出字节）。
   */
  versionStamp: number
  /**
   * 高置信层注入的条目全文（仅结构化 provider 路径由置信度门设置；渲染为
   * 缩进正文块，预算不足时降级为索引行）。fallback 路径恒不设置。
   */
  body?: string
  /** 预留的访问计数（阶段一不采集；渲染必须忽略——volatile-field 反例测试的载体）。 */
  accessCount?: number
}

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * 一次 STM 刷新的选择结果 — log-only（无 surfaceOp，不进模型可见面）。
     * 与紧随其后的 context-snapshot user/message 共同满足 model-visible ⟺
     * logged：快照里渲染的短 id 必须能以本事件 entryIds 的前缀匹配还原。
     */
    'memory/stm-selected': { intentId: string; intentKey: string; turn: number; entryIds: string[] }
    /** 门控保持：本轮评估后 STM 逐字节不变 — log-only（无 surfaceOp）。 */
    'memory/cache-hit': { intentId: string; intentKey: string; turn: number }
    /** 门控触发一次 STM 刷新 — log-only（无 surfaceOp）；选择结果见紧随的 memory/stm-selected。 */
    'memory/cache-miss': { intentId: string; intentKey: string; turn: number; reason: StmRefreshReason }
    /**
     * 一次规则兜底提醒的触发决策 — log-only（无 surfaceOp）。提醒文本本身经
     * memory:reminder context 贡献进入下一份 context-snapshot（模型可见面由
     * 快照机制记录）；本事件只记决策（kind/subject/预算基准），供指标与审计。
     */
    'memory/reminder': { intentId: string; turn: number; kind: 'unknown-entity' | 'error-code'; subject: string }
  }
}
