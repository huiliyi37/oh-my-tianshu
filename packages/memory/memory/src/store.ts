/**
 * MarkdownMemoryStore — memory 服务的 Markdown 文件后端（P2 Wave 1）。
 *
 * 存储布局（按 scope 分文件）：
 * ```
 * <root>/.dsh/memory/
 * ├── global.md          # scope 'global'
 * └── sessions/<id>.md   # scope 'session:<id>'
 * ```
 *
 * 文件格式人类可读、可手动编辑（对齐计划「Markdown 文件对人类可读、可手动
 * 编辑、可进 git」——不用 SQLite 的原因：项目级 knowledge 数据量远小于会话
 * 事件，数十条量级，文件直存最简）：
 * ```
 * <!-- dsh-memory v1 -->
 * <!-- entry id="..." scope="global" source="user" tags="a,b" created="123" [updated="456"] -->
 * 记忆文本（可多行）
 * <!-- /entry -->
 * ```
 *
 * 写入语义：整文件原子重写（temp + rename，同目录保证同设备）。目录按需
 * mkdir recursive——不依赖 git 仓库存在（待验证假设 3：非 git 目录同样可用）。
 * 手工编辑破坏格式的块被跳过（解析容错：缺结束注释的块截到文件尾）。
 *
 * 并发约束：单进程串行调用（TUI 命令与工具调用都走同事件循环）；跨进程
 * 并发写（两个 dsh 实例同 cwd）不在此保证——文档化限制。
 *
 * @module @deepseek-ai/dsh-memory/store
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MemoryEntry, MemoryScope, MemoryService } from './types.js'

/** 文件格式版本标记（解析时忽略未知行，向前兼容）。 */
const FILE_HEADER = '<!-- dsh-memory v1 -->'
/** 块起始注释（属性序列化在引号内）。 */
const ENTRY_START_RE = /^<!-- entry (.*) -->$/
/** 块结束注释。 */
const ENTRY_END = '<!-- /entry -->'

/** 校验 scope 形状：'global' 或 'session:<非空>'。 */
function assertScope(scope: string): asserts scope is MemoryScope {
  if (scope === 'global') return
  if (scope.startsWith('session:') && scope.length > 'session:'.length) return
  throw new Error(`invalid memory scope: ${JSON.stringify(scope)} (expected 'global' or 'session:<id>')`)
}

/** 属性序列 → 键值映射（`key="value"` 逐对解析）。 */
function parseAttrs(text: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const match of text.matchAll(/(\w+)="([^"]*)"/g)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) attrs.set(key, value)
  }
  return attrs
}

/** 解析一个文件的内容为记忆数组（未知行跳过；损坏块容错）。 */
function parseFile(content: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    const start = line.match(ENTRY_START_RE)
    if (start === null) {
      i++
      continue
    }
    const attrs = parseAttrs(start[1] ?? '')
    const id = attrs.get('id')
    const scope = attrs.get('scope')
    const source = attrs.get('source')
    const created = attrs.get('created')
    if (id === undefined || scope === undefined || source === undefined || created === undefined) {
      // 元数据不全的块跳过（手工编辑损坏时容错，不吞整个文件）。
      i++
      continue
    }
    const textLines: string[] = []
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (l === undefined) break
      if (l === ENTRY_END) {
        i++
        break
      }
      textLines.push(l)
      i++
    }
    // 块内结尾的空白行属于分隔（trim 尾随换行）。
    while (textLines.length > 0 && textLines[textLines.length - 1] === '') textLines.pop()
    const updated = attrs.get('updated')
    entries.push({
      id,
      text: textLines.join('\n'),
      scope: scope as MemoryScope,
      tags: (attrs.get('tags') ?? '').split(',').filter(tag => tag !== ''),
      createdAt: Number(created),
      ...(updated === undefined ? {} : { updatedAt: Number(updated) }),
      source: source as MemoryEntry['source'],
    })
  }
  return entries
}

/** 一条记忆序列化为文件块。 */
function serializeEntry(entry: MemoryEntry): string {
  const attrs = [
    `id="${entry.id}"`,
    `scope="${entry.scope}"`,
    `source="${entry.source}"`,
    `tags="${entry.tags.join(',')}"`,
    `created="${entry.createdAt}"`,
    ...(entry.updatedAt === undefined ? [] : [`updated="${entry.updatedAt}"`]),
  ].join(' ')
  return `<!-- entry ${attrs} -->\n${entry.text}\n${ENTRY_END}`
}

/** scope → 存储文件路径。 */
function fileFor(root: string, scope: MemoryScope): string {
  if (scope === 'global') return join(root, 'global.md')
  return join(root, 'sessions', `${scope.slice('session:'.length)}.md`)
}

/** 解析 scope 过滤参数 → 文件清单（scope 语义见 MemoryService.list JSDoc）。 */
function filesForScope(root: string, scope: string | undefined): string[] {
  if (scope === undefined) {
    return [fileFor(root, 'global'), join(root, 'sessions')]
  }
  if (scope === 'global') return [fileFor(root, 'global')]
  if (scope === 'session') return [join(root, 'sessions')]
  if (scope.startsWith('session:')) {
    // 精确会话（'session:<id>'）；非法形状按空清单处理（无匹配文件）。
    const id = scope.slice('session:'.length)
    if (id === '') return []
    return [fileFor(root, `session:${id}`)]
  }
  return []
}

/**
 * 文件后端记忆存储：每条记忆是 `<root>/` 下按 scope 命名的 Markdown 文件里的
 * 一段，读写都走全文件重写，无索引与并发控制——单进程单会话规模的实现。
 */
export class MarkdownMemoryStore implements MemoryService {
  private readonly root: string

  /** @param root - 记忆根目录（`<base>/.dsh/memory`；目录按需创建）。 */
  constructor(root: string) {
    this.root = root
  }

  async save(entry: Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string }): Promise<MemoryEntry> {
    assertScope(entry.scope)
    const all = await this.readAll(entry.scope)
    const existing = entry.id === undefined ? undefined : all.find(e => e.id === entry.id)
    if (existing === undefined) {
      const created: MemoryEntry = {
        id: entry.id ?? randomUUID(),
        text: entry.text,
        scope: entry.scope,
        tags: entry.tags,
        createdAt: Date.now(),
        source: entry.source,
      }
      all.push(created)
      await this.writeAll(entry.scope, all)
      return created
    }
    // 同 scope 更新（同一数组内查找 + 替换，引用有效）。跨 scope 的 id
    // 不在本文件 → 走新建分支（带给定 id）——更新仅同 scope 语义。
    const idx = all.indexOf(existing)
    const updated: MemoryEntry = {
      ...existing,
      text: entry.text,
      tags: entry.tags,
      source: entry.source,
      updatedAt: Date.now(),
    }
    all[idx] = updated
    await this.writeAll(entry.scope, all)
    return updated
  }

  async search(query: string, opts: { scope?: string; limit?: number; offset?: number } = {}): Promise<MemoryEntry[]> {
    const needle = query.toLowerCase()
    return this.list(opts).then(all =>
      all.filter(e => needle === '' || e.text.toLowerCase().includes(needle)),
    )
  }

  async list(opts: { scope?: string; limit?: number; offset?: number } = {}): Promise<MemoryEntry[]> {
    const files = await this.expandFiles(filesForScope(this.root, opts.scope))
    const all: MemoryEntry[] = []
    for (const file of files) {
      all.push(...await this.readFileOrEmpty(file))
    }
    all.sort((a, b) => b.createdAt - a.createdAt)
    const sliced = opts.offset === undefined ? all : all.slice(opts.offset)
    return applyLimit(opts.limit)(sliced)
  }

  async delete(id: string): Promise<void> {
    // 删除需知道 scope：全文件扫描（记忆量小，成本可忽略）。
    const files = await this.expandFiles(filesForScope(this.root, undefined))
    for (const file of files) {
      const entries = await this.readFileOrEmpty(file)
      const before = entries.length
      const remaining = entries.filter(e => e.id !== id)
      if (remaining.length < before) {
        await this.writeRaw(file, remaining)
        return
      }
    }
  }

  /** 把路径清单展开为文件清单（目录 → 递归其下 *.md；不存在的路径跳过）。 */
  private async expandFiles(paths: string[]): Promise<string[]> {
    const out: string[] = []
    for (const p of paths) {
      try {
        const st = await stat(p)
        if (st.isDirectory()) {
          for (const name of await readdir(p)) {
            if (name.endsWith('.md')) out.push(join(p, name))
          }
        } else {
          out.push(p)
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
    }
    return out
  }

  /** 读单文件（目录不存在/文件不存在 → 空数组）。 */
  private async readFileOrEmpty(file: string): Promise<MemoryEntry[]> {
    try {
      const content = await readFile(file, 'utf8')
      return parseFile(content)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /** 读某 scope 的当前全部条目。 */
  private async readAll(scope: MemoryScope): Promise<MemoryEntry[]> {
    return this.readFileOrEmpty(fileFor(this.root, scope))
  }

  /** 原子重写某 scope 文件（temp + rename）。 */
  private async writeAll(scope: MemoryScope, entries: MemoryEntry[]): Promise<void> {
    await this.writeRaw(fileFor(this.root, scope), entries)
  }

  /** 原子重写任意文件（含 sessions 目录聚合场景——写单文件时 entries 按文件过滤）。 */
  private async writeRaw(file: string, entries: MemoryEntry[]): Promise<void> {
    const content = [FILE_HEADER, ...entries.map(serializeEntry)].join('\n') + '\n'
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, content)
    await rename(tmp, file)
  }
}

/** limit 截断（缺省不限）。 */
function applyLimit(limit: number | undefined): (entries: MemoryEntry[]) => MemoryEntry[] {
  return entries => limit === undefined ? entries : entries.slice(0, limit)
}
