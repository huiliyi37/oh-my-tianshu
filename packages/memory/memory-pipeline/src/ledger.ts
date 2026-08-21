/**
 * memory-pipeline 的持久台账：会话处理水位线、作业租约与 phase2 状态。
 *
 * 台账是机器态 JSON（`<cwd>/.dsh/memory/pipeline/ledger.json`，与记忆库同根），
 * 与记忆库共享同一边界假设：单进程写（见 dsh-memory README 的 Known
 * Limitations）。租约是建议性的跨进程协调——同一工作区并发宿主本就不被
 * 记忆库支持，租约只保证「同机多宿主不重复扫描」的常见情形。
 *
 * @module @huiliyi37/dsh-memory-pipeline/ledger
 */

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { writeFileAtomic } from '@huiliyi37/dsh-atomic-write'

/** 台账格式版本（不兼容变更时递增并拒绝旧文件——与 SESSION_FORMAT_VERSION 同策略）。 */
export const LEDGER_VERSION = 1

/** 作业种类（租约的命名空间；回填扫描与全局整合各自持锁）。 */
export type PipelineJobKind = 'sweep' | 'phase2'

/** 单个持久会话的处理记录（幂等键 = sessionId）。 */
export interface SessionRecord {
  /** 该会话最后一次被观察到的事件 seq（-1 = 空会话）。 */
  lastEventSeq: number
  /** 该会话最后一次被观察到的事件时间戳（毫秒；空会话 = firstSeenAtMs）。 */
  lastEventTimeMs: number
  /** 首次进入台账的时间戳（毫秒）。 */
  firstSeenAtMs: number
  /**
   * 处理结论：`ok`（已抽取，终态）、`expired`（超出年龄窗，终态）、
   * `idle`（尚不满足闲置时长，下次扫描复查）、`failed`（本次抽取失败，
   * retries 未达上限前复查）。
   */
  outcome: 'ok' | 'expired' | 'idle' | 'failed'
  /** 已执行的抽取尝试次数（含失败）。 */
  retries: number
  /** 抽取完成时间戳（毫秒；仅 outcome 'ok'）。 */
  extractedAtMs?: number
  /** 抽取器标识（仅 outcome 'ok'；'heuristic' | 'llm'）。 */
  extractor?: string
  /** 最近一次失败的错误摘要（仅 outcome 'failed'）。 */
  error?: string
}

/** 活跃租约（过期即可被其他 worker 接管）。 */
export interface ActiveLease {
  /** 持有者标识（进程内随机 UUID）。 */
  workerId: string
  /** 过期时间戳（毫秒）。 */
  expiresAtMs: number
}

/** phase2 全局整合的状态。 */
export interface Phase2State {
  /** 上次全局整合完成时间戳（毫秒；未运行过则缺省）。 */
  lastRunAtMs?: number
  /** 上次整合后累计的新增候选数（达到阈值即触发下次整合）。 */
  pendingCount: number
}

/** 台账文件形状（version 不符即拒绝——不迁移，与预发布立场一致）。 */
export interface LedgerFile {
  version: typeof LEDGER_VERSION
  /** 按作业种类的活跃租约。 */
  leases: Partial<Record<PipelineJobKind, ActiveLease>>
  /** 会话处理水位线（幂等键 = sessionId）。 */
  sessions: Record<string, SessionRecord>
  /** phase2 全局整合状态。 */
  phase2: Phase2State
}

/**
 * 全新空台账。
 * @returns 无会话记录、无租约、phase2 计数归零的台账。
 */
export function emptyLedger(): LedgerFile {
  return { version: LEDGER_VERSION, leases: {}, sessions: {}, phase2: { pendingCount: 0 } }
}

/**
 * 读取台账；文件不存在时返回全新台账。版本不符或形状损坏拒绝（durable
 * 边界 fail loud，不猜测修复）。
 * @param path - 台账文件绝对路径。
 * @returns 解析后的台账。
 */
export async function loadLedger(path: string): Promise<LedgerFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyLedger()
  }
  // 先按 unknown 校验形状再收窄——台账是 durable 边界，绝不带假设解析。
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('memory-pipeline: ledger 形状损坏（顶层不是对象），拒绝加载')
  }
  const candidate = parsed as { version?: unknown; leases?: unknown; sessions?: unknown; phase2?: unknown }
  if (typeof candidate.version !== 'number' || candidate.version !== LEDGER_VERSION) {
    throw new Error(`memory-pipeline: ledger version ${String(candidate.version)} 不受支持（期望 ${String(LEDGER_VERSION)}），拒绝加载`)
  }
  if (typeof candidate.leases !== 'object' || candidate.leases === null
    || typeof candidate.sessions !== 'object' || candidate.sessions === null
    || typeof candidate.phase2 !== 'object' || candidate.phase2 === null) {
    throw new Error('memory-pipeline: ledger 形状损坏（leases/sessions/phase2 缺失），拒绝加载')
  }
  return parsed as LedgerFile
}

/**
 * 原子写回台账（writeFileAtomic：同目录 tmp + rename；同进程串行调用方
 * 负责——租约持有者独写）。
 * @param path - 台账文件绝对路径。
 * @param ledger - 要写回的台账。
 */
export async function saveLedger(path: string, ledger: LedgerFile): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 })
}

/**
 * 尝试为作业种类获取租约；持有者自身续期也走这里。
 * @param ledger - 当前台账（原地修改）。
 * @param kind - 作业种类。
 * @param workerId - 本 worker 标识。
 * @param leaseMs - 租约时长（毫秒）。
 * @param now - 当前时间戳（毫秒；调用方注入保证确定性）。
 * @returns 获取成功返回 true；他人持有未过期返回 false。
 */
export function acquireLease(ledger: LedgerFile, kind: PipelineJobKind, workerId: string, leaseMs: number, now: number): boolean {
  const existing = ledger.leases[kind]
  if (existing !== undefined && existing.workerId !== workerId && existing.expiresAtMs > now) return false
  ledger.leases[kind] = { workerId, expiresAtMs: now + leaseMs }
  return true
}

/**
 * 释放租约（仅持有者本人生效；过期后他人接管过则 no-op）。以重建对象替代
 * 动态 delete（no-dynamic-delete 门禁；键集恒小，开销可忽略）。
 * @param ledger - 当前台账（原地修改）。
 * @param kind - 作业种类。
 * @param workerId - 本 worker 标识。
 */
export function releaseLease(ledger: LedgerFile, kind: PipelineJobKind, workerId: string): void {
  const existing = ledger.leases[kind]
  if (existing !== undefined && existing.workerId === workerId) {
    ledger.leases = Object.fromEntries(
      Object.entries(ledger.leases).filter(([key]) => key !== kind),
    )
  }
}

/**
 * 本进程的 worker 标识（每次插件装配生成一次；同进程内所有作业共享）。
 * @returns 随机 UUID。
 */
export function newWorkerId(): string {
  return randomUUID()
}
