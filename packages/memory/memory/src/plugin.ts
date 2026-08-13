/**
 * dsh-memory 插件：注册 memory 服务（P2 Wave 1）。
 *
 * provider 角色：`ctx.provide('memory', service)` 暴露 MarkdownMemoryStore。
 * consumers（TUI /remember、/memory、未来的 memory_save/search 工具）经
 * `ctx.reflect.get('memory', false)` 动态获取——不静态 import 本包
 * （TUI 编译面约定：reflect 动态获取的服务不进 tsconfig references）。
 *
 * 存储位置：`<root>/.dsh/memory/`（root 缺省 process.cwd()，部署可变 →
 * Config 字段；目录按需创建，不依赖 git 仓库存在——非 git 目录同样可用）。
 *
 * @module @huiliyi37/dsh-memory/plugin
 */

import { join } from 'node:path'
import { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { MarkdownMemoryStore } from './store.js'

export const name = 'memory'

/** memory 服务在 ctx 上的键（消费者经 reflect.get 读取）。 */
export const MEMORY_KEY = 'memory'

/**
 * 装配 memory 服务。
 * @param ctx - cordis 上下文。
 * @param config - `root` 记忆基目录（缺省 process.cwd()；记忆落在 `<root>/.dsh/memory/`）。
 */
export function apply(ctx: Context, config: MemoryConfig = {}): void {
  const root = config.root ?? process.cwd()
  const store = new MarkdownMemoryStore(join(root, '.dsh/memory'))
  ctx.provide(MEMORY_KEY, store)
}

/** 插件配置。 */
export interface MemoryConfig {
  /** 记忆基目录（记忆文件落在 `<root>/.dsh/memory/`）。 */
  root?: string
}

export const Config = z.object({
  root: z.string().default(process.cwd()),
})
