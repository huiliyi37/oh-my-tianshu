/**
 * dsh-memory-sqlite 插件：注册结构化 LTM provider（memory 服务的第二个 provider）。
 *
 * provider 角色：`ctx.provide('memory', store)` 暴露 SqliteMemoryStore（与
 * dsh-memory 的 Markdown provider 同一服务键——组合里二选一挂载）。
 * consumers（tool-memory、adaptive-memory、TUI 命令）经
 * `ctx.reflect.get('memory', false)` 动态获取，不静态依赖本包。
 *
 * 存储位置：数据库缺省在 `<root>/.dsh/memory/ltm.sqlite`（Markdown 共存源
 * 同目录）；root 缺省 process.cwd()——部署可变，均为 Config 字段。
 *
 * @module @huiliyi37/dsh-memory-sqlite/plugin
 */

import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { MEMORY_KEY } from '@huiliyi37/dsh-memory'
import type { JournalMode } from './schema.ts'
import { SqliteMemoryStore } from './store.ts'

export const name = 'memory-sqlite'

/**
 * 装配结构化 LTM 存储。
 * @param ctx - cordis 上下文。
 * @param config - 路径与预算（缺省值见 schema）。
 */
export function apply(ctx: Context, config: MemorySqliteConfig = {}): void {
  const resolved = resolveConfig(config)
  const mdRoot = join(resolved.root, '.dsh/memory')
  const store = new SqliteMemoryStore({
    dbPath: resolved.dbPath === '' ? join(mdRoot, 'ltm.sqlite') : resolved.dbPath,
    mdRoot,
    journalMode: resolved.journalMode,
    importMaxFileBytes: resolved.importMaxFileBytes,
  })
  ctx.provide(MEMORY_KEY, store)
  ctx.effect(() => {
    // 装配即触发首轮 Markdown 导入（异步；首个操作 await 同一链，不会读到未同步状态）。
    void store.syncMarkdown()
    return () => void store.close()
  })
}

/** 插件配置。 */
export interface MemorySqliteConfig {
  /** 记忆基目录（Markdown 共存源与缺省数据库都落在 `<root>/.dsh/memory/`；缺省 process.cwd()）。 */
  root?: string
  /** SQLite 数据库路径（缺省空串 = `<root>/.dsh/memory/ltm.sqlite`；':memory:' 仅供测试）。 */
  dbPath?: string
  /** SQLite journal 模式（缺省 'wal'）。 */
  journalMode?: JournalMode
  /** 单个 Markdown 文件的导入字节上限（缺省 1 MiB；超限 fail loud）。 */
  importMaxFileBytes?: number
}

export const Config: z<MemorySqliteConfig> = z.object({
  root: z.string().default(process.cwd()),
  dbPath: z.string().default(''),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  importMaxFileBytes: z.number().default(1_048_576),
})

/** 解析后的配置（schema 缺省 + 直接 apply 调用的回落，与 tool-memory 同例）。 */
interface ResolvedConfig {
  root: string
  dbPath: string
  journalMode: JournalMode
  importMaxFileBytes: number
}

/** 配置解析（单一缺省来源：schema 缺省与回落值保持一致）。 */
function resolveConfig(config: MemorySqliteConfig): ResolvedConfig {
  return {
    root: config.root ?? process.cwd(),
    dbPath: config.dbPath ?? '',
    journalMode: config.journalMode ?? 'wal',
    importMaxFileBytes: config.importMaxFileBytes ?? 1_048_576,
  }
}
