// codebase-index 摘要生成 —— 天枢 src/repo/codebase-index.ts 的 generateCodebaseIndexBlock
// 裁剪版：只输出统计 + Modules 表（无 CLI 条目——cli_entries 表裁剪，无 stale 标记——
// git head sha 对比后置）。注入预算 ≤2000 字符（纪律 2：索引摘要注入预算）。

import type { MeridianDb } from '@huiliyi37/dsh-meridian'

/** 注入预算上限（字符）。 */
export const CODEBASE_INDEX_CAP = 2000

/**
 * 生成紧凑的 codebase-index 块，供动态 context 注入。
 * 空索引返回空串（不注入）。
 * @param db - meridian 数据库句柄。
 * @param cap - 注入预算上限（字符）。
 * @returns 渲染好的 codebase-index 块；空索引时为空串。
 */
export function generateCodebaseIndexBlock(db: MeridianDb, cap = CODEBASE_INDEX_CAP): string {
  const modules = db.getModuleSummaries()
  const stats = db.getStats()

  if (modules.length === 0 && stats.files === 0) return ''

  const parts: string[] = []

  parts.push('<codebase-index>')
  parts.push(`Codebase: ${stats.files} files, ${stats.symbols} symbols, ${stats.edges} edges`)

  // Module summaries — compact table format
  if (modules.length > 0) {
    parts.push('')
    parts.push('Modules:')
    for (const m of modules) {
      const exports = m.keyExports.length > 0 ? ` → ${m.keyExports.slice(0, 5).join(', ')}` : ''
      parts.push(`  ${m.dirPath} ${m.summary}${exports}`)
    }
  }

  parts.push('</codebase-index>')
  const block = parts.join('\n')
  return block.length > cap ? `${block.slice(0, cap)}\n…(truncated)` : block
}
