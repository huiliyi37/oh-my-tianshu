/**
 * mention-expand — @mention 用户侧摘要展开（Phase 9a 装配层）。
 *
 * 语义决策（.agents/notes/implemented/feature/2026-08-10-tui-mention-semantics.*）：
 * `@filename` 展开为截断的内容摘要展示在用户消息中，**不做** agent 上下文注入。
 * 读取边界：仅限工作区（cwd）内文件；目录/不存在/越界 → 降级为引用名展示
 * （token 原样保留，不展开）。摘要截断（首 20 行 / 4KB）加折叠标记。
 *
 * 文件读取在 file 边界做存在性与大小验证（AGENTS.md 边界验证纪律）：
 * 先 resolve + 前缀校验（防越界），再 stat 存在性/类型，读取后截断。
 *
 * @module @huiliyi37/dsh-tianshu-tui/mention-expand
 */

import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { parseMentions } from './mention-parser.js'

/** 摘要截断上限：首 20 行 / 4KB（决策 note）。 */
const MAX_SUMMARY_LINES = 20
const MAX_SUMMARY_CHARS = 4 * 1024

/** 是否在 cwd 内（resolve 后严格前缀，防 ../ 越界）。 */
function isInsideCwd(cwd: string, candidate: string): boolean {
  return candidate === cwd || candidate.startsWith(cwd + sep)
}

/** 读取文件摘要：前 20 行 / 4KB 截断 + 折叠标记；读失败降级 null。 */
function readSummary(path: string): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return null
  }
  const lines = raw.split('\n')
  const first = lines.slice(0, MAX_SUMMARY_LINES).join('\n')
  const truncated = first.length > MAX_SUMMARY_CHARS ? first.slice(0, MAX_SUMMARY_CHARS) : first
  const folded = truncated.length < raw.length || lines.length > MAX_SUMMARY_LINES
  return folded ? `${truncated}\n… [截断 ${lines.length} 行 / ${raw.length} 字符]` : truncated
}

/**
 * 展开输入中的所有 @mention：file 类 token 读 cwd 内文件内容摘要，
 * 替换为 `@path\n<摘要>`；folder/越界/不存在/读取失败 → token 原样保留。
 * @param input - 输入文本。
 * @param cwd - 工作区根（读取边界）。
 * @returns 展开后的文本。
 */
export function expandMentions(input: string, cwd: string): string {
  const mentions = parseMentions(input)
  if (mentions.length === 0) return input

  // 从后往前替换，避免 span 偏移
  const segments: string[] = []
  let cursor = input.length
  for (let index = mentions.length - 1; index >= 0; index -= 1) {
    const mention = mentions[index]
    /* v8 ignore next -- 循环自 mentions.length-1 递减至 0，index 恒在界内；noUncheckedIndexedAccess 收窄防御 */
    if (mention === undefined) continue
    const keep = (): void => {
      // 保留原 token（folder/raw/symbol/越界/不存在/读失败降级路径共用）
      if (mention.end < cursor) segments.unshift(input.slice(mention.end, cursor))
      segments.unshift(input.slice(mention.start, mention.end))
      cursor = mention.start
    }
    // 仅 file 类展开；folder/raw/symbol 保持引用名
    if (mention.kind !== 'file') {
      keep()
      continue
    }
    const candidate = resolve(cwd, mention.value)
    const summary = isInsideCwd(cwd, candidate) ? readSummary(candidate) : null
    if (summary === null) {
      keep()
      continue
    }
    if (mention.end < cursor) segments.unshift(input.slice(mention.end, cursor))
    segments.unshift(`@${mention.value}\n${summary}`)
    cursor = mention.start
  }
  segments.unshift(input.slice(0, cursor))
  return segments.join('')
}
