/**
 * memory-pipeline 的回填扫描（codex Phase 1 的对应物）。
 *
 * 枚举持久会话（`SessionPersistence.list()` 轻量元数据），按台账水位线与
 * 资格窗口筛选，逐会话 `inspect()` 取只读逻辑视图，复用
 * dsh-memory-consolidate 的成功门与抽取器写入 LTM。每个会话至多处理一次
 * （outcome 'ok' 终态）；活会话的即时抽取归 memory-consolidate 所有。
 *
 * @module @huiliyi37/dsh-memory-pipeline/sweep
 */

import type { MemoryService } from '@huiliyi37/dsh-memory'
import type { SessionPersistence } from '@huiliyi37/dsh-session-persistence'
import type { SessionHeader } from '@huiliyi37/dsh-session-persistence'
import { evaluateSuccessGate, failureCandidates, saveCandidatesWithConflictMarking } from '@huiliyi37/dsh-memory-consolidate'
import type { ExperienceExtractor } from '@huiliyi37/dsh-memory-consolidate'
import { realpathSync } from 'node:fs'
import type { SessionEvent } from '@huiliyi37/dsh-session'
import { acquireLease, releaseLease } from './ledger.ts'
import type { LedgerFile, SessionRecord } from './ledger.ts'

/** 抽取边界与预算（全部来自 Config）。 */
export interface SweepOptions {
  /** 单条候选文本字符上限。 */
  maxTextChars: number
  /** 单条候选实体数上限。 */
  maxEntities: number
  /** 是否产出 procedure 条目。 */
  proceduresEnabled: boolean
  /** 门控未通过的会话是否记录 failure-pattern 经验。 */
  recordFailures: boolean
  /** 单会话写入候选数上限。 */
  maxCandidatesPerSession: number
  /** 元数据列举上限（轻量过滤阶段的最大候选池）。 */
  scanLimit: number
  /** 会话最后事件距今的最小闲置时长（毫秒）。 */
  minIdleMs: number
  /** 会话最后事件距今的最大年龄（毫秒；超出即终态过期）。 */
  maxAgeMs: number
  /** 单会话最大尝试次数（失败退避；达到后终态）。 */
  maxRetriesPerSession: number
  /** 工作区过滤：仅处理 header.cwd 等于该值的会话。 */
  workspaceCwd: string
  /** 租约时长（毫秒）。 */
  leaseMs: number
}

/** 扫描依赖（宿主服务 + 注入点；全部显式传入保持可无 key 单测）。 */
export interface SweepDeps {
  /** 持久会话存储（list + inspect）。 */
  persistence: SessionPersistence
  /** 记忆服务（写入面）。 */
  memory: MemoryService
  /** 抽取器（缺省由插件按 Config 解析；测试注入脚本化实现）。 */
  extractor: ExperienceExtractor
  /** 台账（调用方已加载；本函数写回但落盘由调用方负责）。 */
  ledger: LedgerFile
  /** 扫描选项。 */
  options: SweepOptions
  /** 当前时间戳（毫秒）。 */
  now(): number
  /** 结构化日志（决策 log-only）。 */
  log: { info(message: string): void; warn(message: string): void }
  /** 取消信号（会话间与抽取调用间检查）。 */
  signal: AbortSignal
}

/** 一次扫描的报告（任务 output 与日志共用）。 */
export interface SweepReport {
  /** 元数据列举总数。 */
  listed: number
  /** 实际 inspect 的会话数。 */
  inspected: number
  /** 成功抽取的会话数。 */
  extractedSessions: number
  /** 写入的候选总数（phase2 触发阈值依据）。 */
  savedCandidates: number
  /** 因闲置不足跳过（复查）的会话数。 */
  skippedIdle: number
  /** 因超龄终态跳过的会话数。 */
  skippedExpired: number
  /** 本次失败的会话数。 */
  failed: number
  /** 因记忆库已有该会话的 auto 溯源而跳过（去重）的会话数。 */
  dedupSkipped: number
}

/**
 * 工作区比较：字面相等优先；否则两侧 realpath（消除符号链接与尾斜杠差异——
 * 会话头的 cwd 是创建时 process.cwd() 的原样字符串，宿主经符号链接路径启动
 * 时字面不等但指向同一目录）。realpath 失败（目录已不存在）按不相等处理。
 * @param a - 会话头 cwd。
 * @param b - 配置的工作区 cwd。
 * @returns 指向同一目录返回 true。
 */
function sameWorkspace(a: string | undefined, b: string): boolean {
  if (a === undefined) return false
  if (a === b) return true
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return false
  }
}

/**
 * 收集已被抽取过的会话 id 集：global scope 的 auto 条目经 sourceRefs 溯源。
 * 覆盖 memory-consolidate 的活会话抽取与本管线的历次运行——consolidate
 * 不写本台账，「共享台账互不重复」的实际实现是这条记忆库侧溯源检查。
 * @param memory - 记忆服务。
 * @returns 已有 auto 条目溯源的会话 id 集。
 */
async function extractedSessionIds(memory: MemoryService): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const entry of await memory.list({ scope: 'global' })) {
    if (entry.source !== 'auto') continue
    for (const ref of entry.sourceRefs ?? []) ids.add(ref.sessionId)
  }
  return ids
}

/**
 * 判定会话是否为子代理/派生谱系（与 memory-consolidate 的 parentSession
 * 判定一致：fork 与子代理会话都跳过——它们继承父会话上下文，抽取只会
 * 重复父内容）。
 * @param header - 会话头。
 * @returns 是派生会话返回 true。
 */
export function isDerivedSession(header: SessionHeader): boolean {
  return header.parentSession !== undefined
    || header.origin === 'subagent'
    || (header.delegationDepth !== undefined && header.delegationDepth > 0)
}

/**
 * 处理单个会话：inspect → 时间窗检查 → 成功门 → 抽取 → 写入（含同扫描内
 * 冲突 uncertain 标记）→ 台账记录。抛错由调用方按 failed 记账。
 * @returns 本会话写入的候选数。
 */
async function processSession(deps: SweepDeps, header: SessionHeader, record: SessionRecord): Promise<number> {
  const { options } = deps
  const inspection = await deps.persistence.inspect(header.id, deps.signal)
  const events = inspection.events
  const lastEvent: SessionEvent | undefined = events.at(-1)
  record.lastEventSeq = lastEvent === undefined ? -1 : lastEvent.seq
  record.lastEventTimeMs = lastEvent === undefined ? record.firstSeenAtMs : lastEvent.time
  const ageMs = deps.now() - record.lastEventTimeMs
  if (ageMs > options.maxAgeMs) {
    record.outcome = 'expired'
    return 0
  }
  if (ageMs < options.minIdleMs) {
    record.outcome = 'idle'
    return 0
  }
  const verdict = evaluateSuccessGate(events, 'standard')
  const bounds = {
    maxTextChars: options.maxTextChars,
    maxEntities: options.maxEntities,
    proceduresEnabled: options.proceduresEnabled,
  }
  const candidates = verdict.passed
    ? await deps.extractor.extract({ sessionId: header.id, events, bounds })
    : options.recordFailures ? failureCandidates(events, bounds) : []
  const capped = candidates.slice(0, options.maxCandidatesPerSession)
  // 写入循环与 consolidate 共享（同批冲突 uncertain 标记含在内）。
  await saveCandidatesWithConflictMarking(deps.memory, header.id, capped)
  record.outcome = 'ok'
  record.extractedAtMs = deps.now()
  record.extractor = verdict.passed ? 'extractor' : 'failure-patterns'
  return capped.length
}

/**
 * 执行一次回填扫描：租约 → 枚举 → 资格过滤 → 逐会话处理 → 释放租约。
 * 单会话失败不中断扫描（台账记 failed + 退避）；abort 在会话间检查。
 * @param deps - 扫描依赖。
 * @param workerId - 租约持有者标识。
 * @returns 扫描报告。
 */
export async function runBackfillSweep(deps: SweepDeps, workerId: string): Promise<SweepReport> {
  const { options, ledger } = deps
  const report: SweepReport = {
    listed: 0, inspected: 0, extractedSessions: 0,
    savedCandidates: 0, skippedIdle: 0, skippedExpired: 0, failed: 0, dedupSkipped: 0,
  }
  if (!acquireLease(ledger, 'sweep', workerId, options.leaseMs, deps.now())) {
    deps.log.info('memory-pipeline: 回填扫描租约被他人持有，跳过本次')
    return report
  }
  try {
    const headers = (await deps.persistence.list(deps.signal)).map(entry => entry.header)
    report.listed = headers.length
    const extracted = await extractedSessionIds(deps.memory)
    const eligible = headers
      .filter(header => !isDerivedSession(header))
      .filter(header => sameWorkspace(header.cwd, options.workspaceCwd))
      .filter((header) => {
        const record = ledger.sessions[header.id]
        if (record === undefined) return true
        if (record.outcome === 'ok' || record.outcome === 'expired') return false
        if (record.outcome === 'failed' && record.retries >= options.maxRetriesPerSession) return false
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, options.scanLimit)
    for (const header of eligible) {
      if (deps.signal.aborted) break
      const record: SessionRecord = ledger.sessions[header.id] ?? {
        lastEventSeq: -1,
        lastEventTimeMs: deps.now(),
        firstSeenAtMs: deps.now(),
        outcome: 'idle',
        retries: 0,
      }
      ledger.sessions[header.id] = record
      // 溯源去重：记忆库已有该会话的 auto 条目（consolidate 活抽取或本管线
      // 旧运行——台账丢失后重建的场景）→ 记终态 ok，不再抽取。
      if (extracted.has(header.id)) {
        record.outcome = 'ok'
        record.extractor = 'provenance-dedup'
        report.dedupSkipped += 1
        continue
      }
      report.inspected += 1
      try {
        const saved = await processSession(deps, header, record)
        if (record.outcome === 'idle') {
          report.skippedIdle += 1
        } else if (record.outcome === 'expired') {
          report.skippedExpired += 1
        } else {
          report.extractedSessions += 1
          report.savedCandidates += saved
        }
      } catch (error) {
        record.outcome = 'failed'
        record.retries += 1
        record.error = String(error).slice(0, 300)
        report.failed += 1
        deps.log.warn(`memory-pipeline: 会话 "${header.id}" 回填失败（第 ${String(record.retries)} 次）：${record.error}`)
      }
    }
  } finally {
    releaseLease(ledger, 'sweep', workerId)
  }
  deps.log.info(
    `memory-pipeline: 回填扫描完成——列举 ${String(report.listed)}，复查 ${String(report.inspected)}，`
    + `抽取 ${String(report.extractedSessions)} 会话 / ${String(report.savedCandidates)} 候选，`
    + `闲置跳过 ${String(report.skippedIdle)}，过期 ${String(report.skippedExpired)}，`
    + `去重跳过 ${String(report.dedupSkipped)}，失败 ${String(report.failed)}`,
  )
  return report
}
