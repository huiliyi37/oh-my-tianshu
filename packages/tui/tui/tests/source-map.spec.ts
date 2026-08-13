/**
 * SOURCE-MAP.md 覆盖护栏：src 下每个 .ts 文件在映射表中恰有一条，状态取自
 * 封闭枚举，映射不含指向已删除文件的幽灵条目。只护覆盖与取值——上游快照
 * 不在仓内，同一性核验做不了诚实的（见 SOURCE-MAP.md 图例）。新增/移动/
 * 删除 src 文件时同 PR 更新映射，本 spec 即强制点。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PKG_ROOT = resolve(import.meta.dirname, '..')
const MAP_PATH = join(PKG_ROOT, 'SOURCE-MAP.md')
const SRC_ROOT = join(PKG_ROOT, 'src')

/** 封闭状态枚举；SOURCE-MAP.md 图例是取值语义的唯一出处。 */
const STATUSES = ['ported', 'modified', 'new'] as const

/** 递归列出 src 下全部 .ts 文件，返回 `src/...` 相对路径（posix 分隔）。 */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(abs))
    else if (entry.name.endsWith('.ts')) {
      out.push(`src/${relative(SRC_ROOT, abs).split('\\').join('/')}`)
    }
  }
  return out.sort()
}

/** 解析映射表的数据行：`| src/... | ... | status |` → target → status 单元格。 */
function parseMapEntries(markdown: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const line of markdown.split('\n')) {
    const match = /^\|\s*(src\/\S+\.ts)\s*\|[^|]*\|\s*(.+?)\s*\|\s*$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      expect(entries.has(match[1]), `SOURCE-MAP.md 重复条目：${match[1]}`).toBe(false)
      entries.set(match[1], match[2])
    }
  }
  return entries
}

describe('SOURCE-MAP.md 覆盖护栏', () => {
  const entries = parseMapEntries(readFileSync(MAP_PATH, 'utf8'))
  const sources = listSourceFiles(SRC_ROOT)

  it('src 下每个文件都有映射条目', () => {
    const unmapped = sources.filter(path => !entries.has(path))
    expect(unmapped, 'src 新增文件需同 PR 补 SOURCE-MAP.md 条目').toEqual([])
  })

  it('映射不含指向已删除文件的幽灵条目', () => {
    const tree = new Set(sources)
    const ghosts = [...entries.keys()].filter(path => !tree.has(path))
    expect(ghosts, 'src 删除/移动文件需同 PR 清理 SOURCE-MAP.md 条目').toEqual([])
  })

  it('状态取自封闭枚举（允许括注说明）', () => {
    const malformed = [...entries.entries()].filter(([, cell]) => {
      return !STATUSES.some(status =>
        cell === status || cell.startsWith(`${status}（`) || cell.startsWith(`${status} (`))
    })
    expect(malformed).toEqual([])
  })
})
