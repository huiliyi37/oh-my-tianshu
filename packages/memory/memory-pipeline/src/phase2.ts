/**
 * memory-pipeline 的全局整合（codex Phase 2 的对应物）。
 *
 * 拉取 global scope 的 auto 条目，一次有界 LLM 调用产出合并计划
 * （canonical 文本 + 被吸收条目 id），先整体解析校验再应用：逐组 save
 * canonical、delete 被吸收条目（只删输入快照内的 id——防幻觉守卫）。
 * 退役节奏仍归 memory-consolidate 的 retireStale 所有，本作业不调用。
 *
 * @module @huiliyi37/dsh-memory-pipeline/phase2
 */

import type { MemoryService } from '@huiliyi37/dsh-memory'
import { acquireLease, releaseLease } from './ledger.ts'
import type { LedgerFile } from './ledger.ts'
import { PHASE2_SYSTEM_PROMPT, parseConsolidationGroups } from './invoke.ts'

/** phase2 选项（全部来自 Config）。 */
export interface Phase2Options {
  /** 输入条目数上限（取最近创建的 N 条 auto 条目）。 */
  maxInputEntries: number
  /** 输入渲染字符上限（超出截断并标注省略）。 */
  maxInputChars: number
  /** canonical 文本字符上限（解析期校验）。 */
  maxCanonicalChars: number
  /** 租约时长（毫秒）。 */
  leaseMs: number
}

/** LLM 调用预算（与回填共享 Config 家族）。 */
export type Phase2Invoke = (system: string, user: string) => Promise<string>

/** phase2 依赖（显式注入保持可无 key 单测）。 */
export interface Phase2Deps {
  /** 记忆服务（list/save/delete 面）。 */
  memory: MemoryService
  /** 台账（调用方已加载；落盘由调用方负责）。 */
  ledger: LedgerFile
  /** 选项。 */
  options: Phase2Options
  /** LLM 调用执行体。 */
  invoke: Phase2Invoke
  /** 当前时间戳（毫秒）。 */
  now(): number
  /** 结构化日志。 */
  log: { info(message: string): void; warn(message: string): void }
  /** 取消信号（应用循环间检查）。 */
  signal: AbortSignal
}

/** 渲染输入条目块：`[id] (tags) text`，总量超限截断并标注省略。 */
function renderEntries(entries: readonly { id: string; text: string; tags: string[] }[], maxChars: number): string {
  const lines = entries.map(entry => `[${entry.id}] (${entry.tags.join(', ')}) ${entry.text.replace(/\s+/gu, ' ')}`)
  let rendered = ''
  for (const line of lines) {
    if (rendered.length + line.length + 1 > maxChars) {
      return `${rendered}\n[...truncated]`
    }
    rendered += `${rendered === '' ? '' : '\n'}${line}`
  }
  return rendered
}

/**
 * 执行一次全局整合：租约 → list 过滤 auto → 有界渲染 → LLM 合并计划 →
 * 校验后应用（save canonical + delete absorbed）→ 台账记账。
 * 解析失败 = 本次整合放弃（pendingCount 保留，下次达到阈值重试），不落
 * 部分写入。
 * @param deps - phase2 依赖。
 * @param workerId - 租约持有者标识。
 * @returns 应用成功的合并组数（0 = 无重叠或放弃）。
 */
export async function runGlobalConsolidation(deps: Phase2Deps, workerId: string): Promise<number> {
  const { options, ledger } = deps
  if (!acquireLease(ledger, 'phase2', workerId, options.leaseMs, deps.now())) {
    deps.log.info('memory-pipeline: 全局整合租约被他人持有，跳过本次')
    return 0
  }
  try {
    const all = await deps.memory.list({ scope: 'global' })
    const autos = all
      .filter(entry => entry.source === 'auto')
      .slice(0, options.maxInputEntries)
    if (autos.length < 2) {
      ledger.phase2.lastRunAtMs = deps.now()
      ledger.phase2.pendingCount = 0
      return 0
    }
    const inputBlock = renderEntries(autos, options.maxInputChars)
    const userPrompt = [
      'Below are memory entries from this project (one per line, `[id] (tags) text`).',
      'Merge entries that state the same fact or experience following the output contract.',
      '',
      inputBlock,
    ].join('\n')
    const raw = await deps.invoke(PHASE2_SYSTEM_PROMPT, userPrompt)
    const validIds = new Set(autos.map(entry => entry.id))
    const groups = parseConsolidationGroups(raw, validIds, options.maxCanonicalChars)
    let applied = 0
    for (const group of groups) {
      if (deps.signal.aborted) break
      await deps.memory.save({
        text: group.text,
        scope: 'global',
        tags: group.tags,
        source: 'auto',
        confidence: group.confidence ?? 0.8,
      })
      for (const id of group.absorbs) {
        await deps.memory.delete(id)
      }
      applied += 1
    }
    ledger.phase2.lastRunAtMs = deps.now()
    ledger.phase2.pendingCount = 0
    deps.log.info(`memory-pipeline: 全局整合完成——输入 ${String(autos.length)} 条，应用 ${String(applied)} 组合并`)
    return applied
  } finally {
    releaseLease(ledger, 'phase2', workerId)
  }
}
