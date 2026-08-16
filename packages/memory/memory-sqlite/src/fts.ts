/**
 * FTS 文本规范化与 MATCH 构造（索引侧与查询侧共用同一规范化，保证可匹配性）。
 *
 * unicode61 把整段 CJK 连续字符切成单个 token（「项目记忆服务」一整个 token），
 * 子串查询（「记忆」）无法命中。规范化为索引与查询两侧的 CJK 连续段生成二元组
 * （「项目 目记 记忆 忆服 服务」），恢复 CJK 子串召回；拉丁文本原样保留，
 * 由 unicode61 自行分词。单字符 CJK 段保留为单字 token。
 *
 * @module @huiliyi37/dsh-memory-sqlite/fts
 */

/** CJK 字符判定（汉/平假名/片假名/谚文）。 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** FTS 词元切分（对齐 unicode61：字母与数字为词元字符，其余为分隔符）。 */
const TOKEN_SPLIT_RE = /[^\p{L}\p{N}]+/u

/**
 * 规范化待索引/待查询文本：CJK 连续段展开为二元组序列，其余原样保留。
 * @param text - 原始文本（事实文本、关键词或用户查询）。
 * @returns 规范化文本（空白分隔的 token 序列）。
 */
export function ftsNormalize(text: string): string {
  const parts: string[] = []
  let cjk = ''
  let rest = ''
  const flushCjk = (): void => {
    if (cjk.length === 1) {
      parts.push(cjk)
    } else if (cjk.length > 1) {
      for (let i = 0; i + 1 < cjk.length; i++) parts.push(cjk.slice(i, i + 2))
    }
    cjk = ''
  }
  const flushRest = (): void => {
    if (rest !== '') parts.push(rest)
    rest = ''
  }
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      flushRest()
      cjk += ch
    } else {
      flushCjk()
      rest += ch
    }
  }
  flushCjk()
  flushRest()
  return parts.join(' ')
}

/**
 * 查询 → 规范化词元清单。
 * @param query - 用户查询。
 * @returns 词元数组（无词元时为空数组）。
 */
export function ftsTerms(query: string): string[] {
  return ftsNormalize(query).split(TOKEN_SPLIT_RE).filter(term => term !== '')
}

/**
 * 构造 FTS5 MATCH 表达式：每个词元转义为字面短语（查询语法保持惰性数据），
 * 以 OR 连接（任一词命中即召回，排序交给 BM25）。
 * @param query - 用户查询。
 * @returns MATCH 表达式；查询无词元时为 null（调用方走空查询路径）。
 */
export function buildFtsMatch(query: string): string | null {
  const terms = ftsTerms(query)
  if (terms.length === 0) return null
  return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}
