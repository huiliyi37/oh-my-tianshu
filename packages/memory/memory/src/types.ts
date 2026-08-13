/**
 * dsh-memory 公共类型：MemoryEntry 与 MemoryService 契约（P2 Wave 1）。
 *
 * 能力缝三角色：本文件是 Service Definition；MarkdownMemoryStore 是 provider
 * （经 `ctx.provide('memory', ...)` 注册）；TUI /remember、/memory 与未来的
 * memory_save/memory_search 工具是 consumers（经 `ctx.reflect.get('memory', false)`
 * 动态获取——不静态 import 本包）。
 *
 * @module @deepseek-ai/dsh-memory/types
 */

/** 记忆作用域：项目全局，或绑定到具体会话。 */
export type MemoryScope = 'global' | `session:${string}`

/** 记忆来源：用户手动（/remember）、agent 工具调用、自动摘要。 */
export type MemorySource = 'user' | 'agent' | 'auto'

/** 一条记忆（持久化形状；id 由存储生成或更新时沿用）。 */
export interface MemoryEntry {
  /** 稳定 id（uuid 或手工编辑时用户给定）。 */
  id: string
  /** Markdown 文本内容。 */
  text: string
  /** 作用域（决定存储文件）。 */
  scope: MemoryScope
  /** 标签（可空数组）。 */
  tags: string[]
  /** 创建时间戳（毫秒）。 */
  createdAt: number
  /** 最近更新时间戳（更新过才存在）。 */
  updatedAt?: number
  /** 来源分类。 */
  source: MemorySource
}

/** memory 服务的最小读写面（provider 与 consumer 的契约）。 */
export interface MemoryService {
  /**
   * 保存或更新一条记忆。id 缺省时新建（生成 uuid + createdAt）；带 id 且
   * 同 scope 已存在时覆盖文本/标签/来源并设置 updatedAt（更新仅同 scope
   * 语义；跨 scope 的 id 视为新建）。
   * @param entry - 记忆内容（id 可选）。
   * @returns 落盘后的完整条目。
   */
  save(entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string }): Promise<MemoryEntry>
  /**
   * 按关键词搜索记忆（朴素子串匹配，大小写不敏感）。
   * @param query - 搜索词；空串匹配全部。
   * @param opts - scope 过滤（'global' 精确；'session' 匹配全部会话记忆；
   *   'session:<id>' 精确）；limit 截断（缺省不限）。
   * @returns 命中的记忆（按 createdAt 倒序）。
   */
  search(query: string, opts?: { scope?: string; limit?: number; offset?: number }): Promise<MemoryEntry[]>
  /**
   * 列出全部记忆（按 createdAt 倒序）。
   * @param opts - scope 过滤（语义同 search）；limit 截断；offset 跳过前 N 条。
   */
  list(opts?: { scope?: string; limit?: number; offset?: number }): Promise<MemoryEntry[]>
  /** 删除一条记忆；不存在的 id 静默 no-op（幂等）。 */
  delete(id: string): Promise<void>
}
