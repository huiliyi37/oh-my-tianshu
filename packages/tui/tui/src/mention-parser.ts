/**
 * mention-parser — @路径展开解析器（RED 基线）。
 *
 * 纯函数：输入文本 + 光标 → 光标处的候选 @token（含 span/value/引号态）。
 * 不读文件——文件内容摘要展开由装配层（后续）接线。
 *
 * token 形：裸 `@path` 与引号形 `@"a b.ts"`（路径含空格/反斜杠时）。
 */

/** 光标处的候选 @token（span 覆盖 @ 起始到 token 结束，引号形含闭合引号）。 */
export interface MentionToken {
  /** 起始偏移（@ 所在）。 */
  start: number
  /** 结束偏移（不含；引号形在闭合引号之后）。 */
  end: number
  /** 去引号后的路径值。 */
  value: string
  /** 引号形 token（路径含空格）。 */
  quoted: boolean
}

/** mention 分类：file / folder（尾斜杠）/ symbol（含 #/::）/ raw（空值）。 */
export type MentionKind = 'file' | 'folder' | 'symbol' | 'raw'

/** 带分类的 mention token（parseMentions 输出）。 */
export interface MentionReference extends MentionToken {
  kind: MentionKind
}

const BARE_MENTION_RE = /@([^\s@]+)/g
const QUOTED_MENTION_RE = /@"((?:[^"\\]|\\.)*)"/g

/**
 * 光标处候选 @token：光标在 token 内/末尾/@ 上视为编辑中；其余 null。
 * @param input - 输入框全文。
 * @param cursor - 光标偏移（越界返回 null）。
 * @returns 候选 token；光标不在任何 token 上返回 null。
 */
export function findMentionAt(input: string, cursor: number): MentionToken | null {
  if (cursor < 0 || cursor > input.length) return null
  // 引号形优先（含空格路径）
  for (const m of input.matchAll(QUOTED_MENTION_RE)) {
    const start = m.index
    const raw = m[0] as string | undefined
    /* v8 ignore next -- matchAll 成功匹配的 RegExpMatchArray 索引必有值；noUncheckedIndexedAccess 收窄防御 */
    if (raw === undefined) continue
    const end = start + raw.length
    if (cursor >= start && cursor <= end) {
      const value = m[1]
      /* v8 ignore next -- 参与匹配的捕获组必有值；noUncheckedIndexedAccess 收窄防御 */
      if (value === undefined) continue
      return { start, end, value, quoted: true }
    }
  }
  for (const m of input.matchAll(BARE_MENTION_RE)) {
    const start = m.index
    const raw = m[0] as string | undefined
    /* v8 ignore next -- matchAll 成功匹配的 RegExpMatchArray 索引必有值；noUncheckedIndexedAccess 收窄防御 */
    if (raw === undefined) continue
    const end = start + raw.length
    // 光标在 token 内（含末尾，即刚打完最后一个字符）→ 编辑中
    if (cursor >= start && cursor <= end) {
      const value = m[1]
      /* v8 ignore next -- 参与匹配的捕获组必有值；noUncheckedIndexedAccess 收窄防御 */
      if (value === undefined) continue
      return { start, end, value, quoted: false }
    }
  }
  return null
}

/**
 * 全量提取所有 mention token（裸 + 引号形）。
 * @param input - 输入框全文。
 * @returns 带分类的 token 列表（引号形优先，裸形跳过已被引号形消费的区域）。
 */
export function parseMentions(input: string): MentionReference[] {
  const out: MentionReference[] = []
  for (const m of input.matchAll(QUOTED_MENTION_RE)) {
    const start = m.index
    const raw = m[0] as string | undefined
    /* v8 ignore next -- matchAll 成功匹配的 RegExpMatchArray 索引必有值；noUncheckedIndexedAccess 收窄防御 */
    if (raw === undefined) continue
    const value = m[1]
    /* v8 ignore next -- 参与匹配的捕获组必有值；noUncheckedIndexedAccess 收窄防御 */
    if (value === undefined) continue
    out.push({ start, end: start + raw.length, value, quoted: true, kind: mentionKind(value) })
  }
  for (const m of input.matchAll(BARE_MENTION_RE)) {
    const start = m.index
    const raw = m[0] as string | undefined
    /* v8 ignore next -- matchAll 成功匹配的 RegExpMatchArray 索引必有值；noUncheckedIndexedAccess 收窄防御 */
    if (raw === undefined) continue
    // 引号形已消费的区域跳过（裸正则会在 @"..." 内部误匹配）
    if (out.some(r => start >= r.start && start < r.end)) continue
    const value = m[1]
    /* v8 ignore next -- 参与匹配的捕获组必有值；noUncheckedIndexedAccess 收窄防御 */
    if (value === undefined) continue
    out.push({ start, end: start + raw.length, value, quoted: false, kind: mentionKind(value) })
  }
  return out
}

/**
 * token 形状启发式分类：尾斜杠 → folder；含 #/:: → symbol；空 → raw；其余 file。
 * @param value - 去引号后的路径值。
 * @returns 分类结果。
 */
export function mentionKind(value: string): MentionKind {
  if (value === '') return 'raw'
  if (value.endsWith('/')) return 'folder'
  if (value.includes('#') || value.includes('::')) return 'symbol'
  return 'file'
}
