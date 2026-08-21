/**
 * dsh-memory-sqlite 公共类型：事件日志行与物化事实行的内存形状。
 *
 * @module @huiliyi37/dsh-memory-sqlite/types
 */

import type { MemoryKind, MemoryScope, MemorySource, MemorySourceRef } from '@huiliyi37/dsh-memory'

/** 事件种类（seam 的三种 + 本 provider 内部的 'tombstone' 废止事件）。 */
export type MemoryEventKind = MemoryKind | 'tombstone'

/** 事实状态：当前生效 / 已被取代 / 有效但未验证（巩固流程标记冲突）/ 已退役（退出检索，仅留审计）。 */
export type MemoryFactStatus = 'active' | 'superseded' | 'uncertain' | 'retired'

/** events 表行（append-only 日志的一条事件）。 */
export interface MemoryEventRow {
  /** 事件 id（uuid）。 */
  id: string
  /** 来源会话 id（scope 为 session 时派生；否则 null）。 */
  sessionId: string | null
  /** 作用域。 */
  scope: MemoryScope
  /** 事件种类。 */
  kind: MemoryEventKind
  /** 事件文本。 */
  text: string
  /** 关键词（反序列化后）。 */
  keywords: string[]
  /** 实体清单。 */
  entities: string[]
  /** 主题分区。 */
  topic: string
  /** 置信度 0..1。 */
  confidence: number
  /** 来源引用（会话日志事件区间）。 */
  sourceRefs: MemorySourceRef[]
  /** 事件时间戳（毫秒）。 */
  createdAt: number
}

/** facts 表行（物化视图的一个版本；同一条目可有多行版本）。 */
export interface MemoryFactRow {
  /** 版本 id（uuid，主键；每个版本一行）。 */
  versionId: string
  /** 逻辑条目 id（跨版本稳定；MemoryEntry.id）。 */
  id: string
  /** 作用域。 */
  scope: MemoryScope
  /** 事实主体。 */
  subject: string
  /** 谓词。 */
  predicate: string
  /** 当前值。 */
  value: string
  /** 检索/渲染文本（MemoryEntry.text）。 */
  text: string
  /** 关键词（MemoryEntry.tags）。 */
  keywords: string[]
  /** 实体清单。 */
  entities: string[]
  /** 主题分区。 */
  topic: string
  /** 来源分类。 */
  source: MemorySource
  /** 本版本生效时间（毫秒）。 */
  validFrom: number
  /** 本版本失效时间（superseded 时设置；否则 null）。 */
  validTo: number | null
  /** 置信度 0..1。 */
  confidence: number
  /** 版本状态。 */
  status: MemoryFactStatus
  /** 被本版本取代的上一版本 version_id（首版本为 null）。 */
  supersedes: string | null
  /** 产生本版本的事件 id（→ events.id）。 */
  sourceEventId: string
  /** 首版本时间（跨版本继承；MemoryEntry.createdAt）。 */
  createdAt: number
  /** 最近一次被检索命中（或创建）时的巩固期计数（未使用退役的依据）。 */
  usedAtConsolidation: number
  /** 来源引用（经 source_event_id 关联回源事件行读出；读取面透传）。 */
  sourceRefs: MemorySourceRef[]
}
