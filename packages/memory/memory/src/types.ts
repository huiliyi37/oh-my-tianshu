/**
 * dsh-memory 公共类型：MemoryEntry 与 MemoryService 契约（P2 Wave 1）。
 *
 * 能力缝三角色：本文件是 Service Definition；MarkdownMemoryStore 是 provider
 * （经 `ctx.provide('memory', ...)` 注册）；TUI /remember、/memory 与
 * tool-memory 的 memory_save/memory_search 是 consumers（经
 * `ctx.reflect.get('memory', false)` 动态获取——不静态 import 本包）。
 *
 * @module @huiliyi37/dsh-memory/types
 */

/** 记忆作用域：项目全局，或绑定到具体会话。 */
export type MemoryScope = 'global' | `session:${string}`

/** 记忆来源：用户手动（/remember）、agent 工具调用、自动摘要。 */
export type MemorySource = 'user' | 'agent' | 'auto'

/** 记忆事件种类（结构化存储的事件分类；缺省 'observation'，带结构化 fact 时缺省 'fact'）。 */
export type MemoryKind = 'fact' | 'experience' | 'observation'

/** 结构化事实三元组（缺省时 provider 以条目 id 为 subject、'note' 为 predicate、text 为 value 派生）。 */
export interface MemoryFactShape {
  /** 事实主体（实体名/路径等）。 */
  subject: string
  /** 谓词（关系名，如 'uses-db'）。 */
  predicate: string
  /** 当前值（同 subject+predicate 的不同 value 触发 supersede）。 */
  value: string
}

/** 事实的来源引用（会话日志事件区间；审计链，可回溯到原始证据）。 */
export interface MemorySourceRef {
  /** 来源会话 id。 */
  sessionId: string
  /** 该会话日志中的事件序号。 */
  eventSeqs: number[]
}

/**
 * save 的输入：基础条目字段 + 可选结构化字段。结构化字段由实现了物化视图的
 * provider 消费；Markdown provider 忽略它们（纯文本存储）。
 */
export type MemorySaveInput = Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string } & {
  /** 事件种类（缺省见 MemoryKind）。 */
  kind?: MemoryKind
  /** 主题分区（缺省取首个 tag，无 tag 时 'general'；写入会推进该 topic 的版本号）。 */
  topic?: string
  /** 实体清单（精确匹配的检索过滤维度）。 */
  entities?: string[]
  /** 置信度 0..1（缺省 1；未验证的经验由巩固流程赋低值）。 */
  confidence?: number
  /** 结构化事实三元组（缺省派生规则见 MemoryFactShape）。 */
  fact?: MemoryFactShape
  /** 来源引用（缺省空数组）。 */
  sourceRefs?: MemorySourceRef[]
}

/** search 的过滤与分页选项。 */
export interface MemorySearchOptions {
  /** scope 过滤（'global' 精确；'session' 匹配全部会话记忆；'session:<id>' 精确）。 */
  scope?: string
  /** 截断返回条数（缺省不限）。 */
  limit?: number
  /** 跳过前 N 条。 */
  offset?: number
  /** 按 id 或 id 前缀排除条目（供调用方排除已进入当前请求上下文、无需重复的条目）。 */
  excludeIds?: string[]
  /** 实体精确过滤：条目 entities 须包含全部给定实体（Markdown provider 退化为 tags 匹配）。 */
  entities?: string[]
  /** 主题精确过滤（Markdown provider 退化为 tags 匹配）。 */
  topic?: string
}

/**
 * search 命中项：MemoryEntry + 归一化相关性得分。仅支持排序的 provider
 * 设置 score（0..1，越高越相关；归一化公式由 provider 文档化）；Markdown
 * provider 的子串扫描不产出得分。
 */
export interface MemorySearchResult extends MemoryEntry {
  /** 归一化相关性得分（0..1；未排序 provider 不设置）。 */
  score?: number
}

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
  /**
   * 来源引用（读取面透传：结构化 provider 从持久行提供；Markdown 纯文本
   * 存储按契约不携带）。消费方做溯源去重/审计回溯；缺席不参与判定。
   */
  sourceRefs?: MemorySourceRef[]
}

/** 一次巩固期退役的输入（retireStale 可选能力；时间由调用方注入以保证确定性）。 */
export interface MemoryRetireOptions {
  /** 当前时间戳（毫秒）。 */
  now: number
  /** superseded 版本的保留时长（毫秒）：validTo 早于 now − 此值的版本退役。 */
  supersededRetentionMs: number
  /** 巩固期未使用阈值：连续这么多次巩固期未被检索命中的事实退役。 */
  unusedConsolidations: number
}

/** 一次巩固期退役的结果统计。 */
export interface MemoryRetireReport {
  /** 本次之后的巩固期计数（每次 retireStale 调用 = 一个巩固期）。 */
  consolidations: number
  /** 因超出 superseded 保留期而退役的事实数。 */
  retiredSuperseded: number
  /** 因跨巩固期未使用而退役的事实数。 */
  retiredUnused: number
}

/** memory 服务的最小读写面（provider 与 consumer 的契约）。 */
export interface MemoryService {
  /**
   * 保存或更新一条记忆。id 缺省时新建（生成 uuid + createdAt）；带 id 且
   * 同 scope 已存在时覆盖文本/标签/来源并设置 updatedAt（更新仅同 scope
   * 语义；跨 scope 的 id 视为新建）。结构化 provider 的同 subject+predicate
   * 不同 value 走 supersede（旧版本保留为 superseded，不删除）。
   * @param entry - 记忆内容（id 与结构化字段可选）。
   * @returns 落盘后的完整条目。
   */
  save(entry: MemorySaveInput): Promise<MemoryEntry>
  /**
   * 按关键词搜索记忆（排序与得分由 provider 决定：Markdown 为朴素子串匹配
   * 无得分；支持排序的 provider 设置归一化 score）。
   * @param query - 搜索词；空串匹配全部。
   * @param opts - 过滤与分页（见 MemorySearchOptions）。
   * @returns 命中的记忆（Markdown 按 createdAt 倒序；结构化 provider 按得分降序）。
   */
  search(query: string, opts?: MemorySearchOptions): Promise<MemorySearchResult[]>
  /**
   * 列出全部记忆（按 createdAt 倒序；结构化 provider 读物化当前视图，
   * 不含已 superseded 的版本）。
   * @param opts - scope 过滤（语义同 search）；limit 截断；offset 跳过前 N 条。
   */
  list(opts?: { scope?: string; limit?: number; offset?: number }): Promise<MemoryEntry[]>
  /** 删除一条记忆；不存在的 id 静默 no-op（幂等）。结构化 provider 落 tombstone（不擦除事件日志）。 */
  delete(id: string): Promise<void>
  /**
   * 可选能力：topic → 单调版本号（按 topic 分区的失效信号；该 topic 下有
   * 事实写入/废止时 +1）。仅结构化 provider 实现；消费方以
   * `typeof memory.topicVersions === 'function'` 探测。
   * @returns 全量 topic 版本表。
   */
  topicVersions?(): Promise<Record<string, number>>
  /**
   * 可选能力：把 (scope, subject, predicate) 的当前 active 事实标记为
   * uncertain——巩固流程检测到无明确 supersede 顺序的冲突观察时使用（不删除、
   * 不取代，只降级；检索降权但保留）。仅结构化 provider 实现；消费方以
   * `typeof memory.markUncertain === 'function'` 探测。
   * @param scope - 事实作用域。
   * @param subject - 事实主体。
   * @param predicate - 谓词。
   * @returns 是否有 active 事实被标记（无该对 active 事实时为 false）。
   */
  markUncertain?(scope: MemoryScope, subject: string, predicate: string): Promise<boolean>
  /**
   * 可选能力：巩固期退役——每次调用计为一个巩固期，把超出保留期的
   * superseded 版本与跨巩固期未被检索命中的事实标记为 retired（事件日志保持
   * append-only，只有物化视图变化；retired 事实退出检索与 list）。仅结构化
   * provider 实现；消费方以 `typeof memory.retireStale === 'function'` 探测。
   * 每个巩固期至多调用一次（巩固期计数驱动未使用判定）。
   * @param options - 时间与两个退役阈值（见 MemoryRetireOptions）。
   * @returns 本次退役统计。
   */
  retireStale?(options: MemoryRetireOptions): Promise<MemoryRetireReport>
}
