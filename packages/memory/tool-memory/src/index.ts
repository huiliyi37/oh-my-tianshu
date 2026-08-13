/**
 * tool-memory — memory_save / memory_search 模型工具（P4 Wave 3）。
 *
 * 让 agent 在工作过程中读写项目级记忆（dsh-memory 服务）：
 * - memory_save：将重要发现（项目结构、用户偏好、关键决策）写入记忆
 * - memory_search：检索之前保存的知识（关键词子串匹配）
 *
 * memory 服务经 `ctx.reflect.get('memory', false)` 动态获取（非静态依赖；
 * 未装配时工具执行 fail loud）。system prompt 注入静态指引 + 动态记忆摘要
 * （摘要经预取缓存：apply 时与 save 后异步刷新，section text 函数同步读缓存
 * ——PromptSection.text 是同步签名，无法直接 await memory.list）。
 *
 * @module @deepseek-ai/dsh-tool-memory
 */

import { Context } from 'cordis'
import z from 'schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryService } from '@deepseek-ai/dsh-memory'

export const name = 'tool-memory'

/** 本插件依赖的工具注册表与 system prompt 服务。 */
export const inject = ['tools', 'systemPrompt']

/** memory 服务键（与 dsh-memory 的 MEMORY_KEY 对齐；经 reflect 动态获取）。 */
const MEMORY_KEY = 'memory'

/** 静态指引文本（agent 开局看到 memory 能力）。 */
const MEMORY_GUIDANCE = [
  '项目记忆（memory）：本项目有持久化记忆服务，可跨会话保存与检索知识。',
  '- 需要历史决策/项目结构/用户偏好时：用 memory_search 检索',
  '- 发现重要事实（决策、偏好、约定）时：用 memory_save 保存（scope 缺省 global）',
].join('\n')

/** 取 memory 服务（未装配返回 undefined）。 */
function getMemory(ctx: Context): MemoryService | undefined {
  return ctx.reflect.get(MEMORY_KEY, false) as MemoryService | undefined
}

/** 校验 scope 参数（模型友好错误）。 */
function assertScopeArg(scope: string | undefined): 'global' | `session:${string}` {
  if (scope === undefined || scope === 'global') return 'global'
  if (scope.startsWith('session:') && scope.length > 'session:'.length) {
    return scope as `session:${string}`
  }
  throw new Error(`memory_save: invalid scope ${JSON.stringify(scope)} (expected 'global' or 'session:<id>')`)
}

/** 工具执行上下文注入（无 memory 服务时 fail loud）。 */
function requireMemory(ctx: Context): MemoryService {
  const memory = getMemory(ctx)
  if (memory === undefined) {
    throw new Error('memory 服务不可用（未加载 dsh-memory 插件）')
  }
  return memory
}

/** 插件配置。 */
export interface ToolMemoryConfig {
  /** 摘要注入开关（缺省 true）。 */
  digest?: boolean
}

export const Config = z.object({
  digest: z.boolean().default(true),
})

/**
 * 注册 memory_save / memory_search 工具 + system prompt 指引。
 * @param ctx - 插件上下文（注入 tools/systemPrompt）。
 * @param config - digest 摘要注入开关。
 */
export function apply(ctx: Context, config: ToolMemoryConfig = {}): void {
  const resolved = { digest: config.digest ?? true }
  // 摘要缓存为 apply 实例局部（多 ctx/并行测试互不串扰；section text 同步读）。
  let digestCache = '（项目记忆为空）'

  /** 刷新记忆摘要缓存（apply 时 + save 后；失败保持旧缓存）。 */
  const refreshDigest = async (): Promise<void> => {
    const memory = getMemory(ctx)
    if (memory === undefined) {
      digestCache = '（memory 服务未装配）'
      return
    }
    try {
      const all = await memory.list({ limit: 20 })
      digestCache = all.length === 0
        ? '（项目记忆为空）'
        : all.map(e => `- ${(e.text.split('\n')[0] ?? '').trim()}`).join('\n')
    } catch {
      digestCache = '（记忆读取失败）'
    }
  }

  if (resolved.digest) void refreshDigest()

  // 记忆摘要 section（text 同步读缓存；装配时即最新摘要）。
  ctx.systemPrompt.section({
    name: 'tool:memory',
    order: 130,
    text: () => `${MEMORY_GUIDANCE}\n${digestCache}`,
  })

  ctx.tools.register(defineTool({
    name: 'memory_save',
    description:
      '保存一条项目级记忆（Markdown 文本）。在工作过程中将重要发现——项目结构、用户偏好、关键决策、已验证结论——写入记忆，供未来会话用 memory_search 检索。',
    parameters: {
      text: { type: 'string', required: true, description: '记忆内容（建议一句话或短段落）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '可选标签（如 tooling、architecture）',
      },
      scope: {
        type: 'string',
        description: "作用域：'global'（缺省）或 'session:<id>'",
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text' as const, text: `已保存记忆 ${value.id}: ${(value.text.split('\n')[0] ?? '').trim()}` },
      ],
    },
    async execute(args) {
      const memory = requireMemory(ctx)
      const entry = await memory.save({
        text: args.text,
        scope: assertScopeArg(args.scope),
        tags: args.tags ?? [],
        source: 'agent',
      })
      if (resolved.digest) void refreshDigest()
      return { id: entry.id, text: entry.text }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description:
      '在项目记忆中检索知识（关键词子串匹配，大小写不敏感；空 query 列出全部）。'
      + '开始新任务、需要历史决策/项目约定/用户偏好时使用。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词（空串匹配全部）' },
      limit: { type: 'number', description: '返回条数上限（缺省 10）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                text: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                createdAt: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.entries.length === 0) return [{ type: 'text' as const, text: '（无匹配记忆）' }]
        return value.entries.map(e => ({
          type: 'text' as const,
          text: `[${e.id.slice(0, 8)}] ${e.text}${e.tags.length > 0 ? ` #${e.tags.join(' #')}` : ''}`,
        }))
      },
    },
    async execute(args) {
      const memory = requireMemory(ctx)
      const entries = await memory.search(args.query, { limit: args.limit ?? 10 })
      return {
        entries: entries.map(e => ({
          id: e.id,
          text: e.text,
          tags: e.tags,
          createdAt: e.createdAt,
        })),
      }
    },
  }))
}
