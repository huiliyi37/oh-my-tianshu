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
import { BlockAssembler, createUserMessage, deepFreeze, ReasoningEffortId } from '@huiliyi37/dsh-llm'
import type { FinishReason, GenerateOptions, LlmService } from '@huiliyi37/dsh-llm'
import { MEMORY_KEY } from '@huiliyi37/dsh-memory'
import type { EmbeddingProvider } from '@huiliyi37/dsh-semantic-index'
import { deadline } from '@huiliyi37/dsh-timeout'
import { createHttpEmbedder } from './embedder.ts'
import { createLlmKeywordExpander } from './expander.ts'
import type { ExpansionInvoke, KeywordExpander } from './expander.ts'
import type { JournalMode } from './schema.ts'
import { SqliteMemoryStore } from './store.ts'

export const name = 'memory-sqlite'

/** 关键词扩展辅助调用的超时 reason code（能力自有，与 memory-consolidate 同例）。 */
const EXPANSION_TIMEOUT_CODE = 'MEMORY_SQLITE_EXPANSION_TIMEOUT'

/**
 * 装配结构化 LTM 存储。
 * @param ctx - cordis 上下文。
 * @param config - 路径与预算（缺省值见 schema）。
 * @param embedder - 显式注入的嵌入 provider（优先于 Config 的 embedding* 字段；
 *   两者皆缺 = 禁用嵌入，纯 BM25）。
 * @param keywordExpander - 显式注入的关键词扩展器（优先于 Config 的
 *   keywordExpansion* 字段；两者皆缺/为 'off' = 禁用扩展，零额外调用）。
 */
export function apply(
  ctx: Context,
  config: MemorySqliteConfig = {},
  embedder?: EmbeddingProvider,
  keywordExpander?: KeywordExpander,
): void {
  const resolved = resolveConfig(config)
  const mdRoot = join(resolved.root, '.dsh/memory')
  const store = new SqliteMemoryStore({
    dbPath: resolved.dbPath === '' ? join(mdRoot, 'ltm.sqlite') : resolved.dbPath,
    mdRoot,
    journalMode: resolved.journalMode,
    importMaxFileBytes: resolved.importMaxFileBytes,
    embedder: embedder ?? resolveEmbedder(resolved),
    keywordExpander: keywordExpander ?? resolveKeywordExpander(ctx, resolved),
    onExpansionError: (error) => {
      ctx.logger.warn(`memory-sqlite: 关键词扩展失败，本次按未扩展落库：${String(error)}`)
    },
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
  /** 嵌入 provider（'' = 禁用（缺省，零额外调用、纯 BM25）；'http' = OpenAI 兼容 embeddings 端点）。 */
  embeddingProvider?: '' | 'http'
  /** 嵌入端点完整 URL（embeddingProvider 为 'http' 时必填，半配在装配时 fail loud）。 */
  embeddingUrl?: string
  /** 嵌入模型名（'http' 必填；并入 embedder 戳记——换模型触发检索时惰性重嵌）。 */
  embeddingModel?: string
  /** 嵌入端点的可选 bearer key。 */
  embeddingApiKey?: string
  /** 嵌入请求的端到端超时毫秒数（缺省 30000）。 */
  embeddingTimeoutMs?: number
  /**
   * 关键词扩展（阶段二d；缺省 'off' = 零额外调用）：'llm' 时每次 save 用内置
   * chat 模型做一次有界扩展调用，产出的同义/释义/跨语言/相关术语并入落库
   * 关键词，FTS/BM25 因而能命中释义查询；失败仅记日志、按未扩展落库。
   */
  keywordExpansion?: 'off' | 'llm'
  /** 扩展调用的显式路由对（与 keywordExpansionModel 成对；'llm' 必填——save 路径无会话路由可推导）。 */
  keywordExpansionProvider?: string
  /** 扩展调用的显式路由对（与 keywordExpansionProvider 成对；'llm' 必填）。 */
  keywordExpansionModel?: string
  /** 扩展调用的 reasoning effort（缺省 'off'：扩展是机械生成，不烧思考 token）。 */
  keywordExpansionEffort?: string
  /** 扩展输入的条目文本字符上限（缺省 4000；超出截断）。 */
  keywordExpansionMaxInputChars?: number
  /** 扩展调用的输出 token 上限（缺省 300）。 */
  keywordExpansionMaxOutputTokens?: number
  /** 扩展调用的端到端超时毫秒数（缺省 30000）。 */
  keywordExpansionTimeoutMs?: number
}

export const Config: z<MemorySqliteConfig> = z.object({
  root: z.string().default(process.cwd()),
  dbPath: z.string().default(''),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
  importMaxFileBytes: z.number().default(1_048_576),
  embeddingProvider: z.union(['', 'http'] as const).default(''),
  embeddingUrl: z.string(),
  embeddingModel: z.string(),
  embeddingApiKey: z.string(),
  embeddingTimeoutMs: z.number().default(30_000),
  keywordExpansion: z.union(['off', 'llm'] as const).default('off'),
  keywordExpansionProvider: z.string(),
  keywordExpansionModel: z.string(),
  keywordExpansionEffort: z.string().default('off'),
  keywordExpansionMaxInputChars: z.number().default(4000),
  keywordExpansionMaxOutputTokens: z.number().default(300),
  keywordExpansionTimeoutMs: z.number().default(30_000),
})

/** 解析后配置的公共字段（schema 缺省 + 直接 apply 调用的回落，与 tool-memory 同例）。 */
interface ResolvedCommon {
  root: string
  dbPath: string
  journalMode: JournalMode
  importMaxFileBytes: number
  embeddingProvider: '' | 'http'
  embeddingUrl?: string
  embeddingModel?: string
  embeddingApiKey?: string
  embeddingTimeoutMs: number
  keywordExpansionEffort: string
  keywordExpansionMaxInputChars: number
  keywordExpansionMaxOutputTokens: number
  keywordExpansionTimeoutMs: number
}

/** 解析后的配置：'llm' 分支静态保证路由对齐全（resolveConfig 在半配/缺配时 fail loud）。 */
type ResolvedConfig = ResolvedCommon & (
  | { keywordExpansion: 'off'; keywordExpansionProvider?: string; keywordExpansionModel?: string }
  | { keywordExpansion: 'llm'; keywordExpansionProvider: string; keywordExpansionModel: string }
)

/** 配置解析（单一缺省来源：schema 缺省与回落值保持一致；provider 取值由 schema 的 closed union 校验）。 */
function resolveConfig(config: MemorySqliteConfig): ResolvedConfig {
  const common: ResolvedCommon = {
    root: config.root ?? process.cwd(),
    dbPath: config.dbPath ?? '',
    journalMode: config.journalMode ?? 'wal',
    importMaxFileBytes: config.importMaxFileBytes ?? 1_048_576,
    embeddingProvider: config.embeddingProvider ?? '',
    ...(config.embeddingUrl === undefined ? {} : { embeddingUrl: config.embeddingUrl }),
    ...(config.embeddingModel === undefined ? {} : { embeddingModel: config.embeddingModel }),
    ...(config.embeddingApiKey === undefined ? {} : { embeddingApiKey: config.embeddingApiKey }),
    embeddingTimeoutMs: config.embeddingTimeoutMs ?? 30_000,
    keywordExpansionEffort: config.keywordExpansionEffort ?? 'off',
    keywordExpansionMaxInputChars: config.keywordExpansionMaxInputChars ?? 4000,
    keywordExpansionMaxOutputTokens: config.keywordExpansionMaxOutputTokens ?? 300,
    keywordExpansionTimeoutMs: config.keywordExpansionTimeoutMs ?? 30_000,
  }
  const hasProvider = config.keywordExpansionProvider !== undefined
  const hasModel = config.keywordExpansionModel !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('memory-sqlite: keywordExpansionProvider 与 keywordExpansionModel 必须成对配置')
  }
  const expansion = config.keywordExpansion ?? 'off'
  if (expansion === 'llm') {
    // save 路径没有会话日志可推导路由（与 memory-consolidate 的会话路由不同），'llm' 必须显式配置。
    if (config.keywordExpansionProvider === undefined || config.keywordExpansionModel === undefined) {
      throw new Error('memory-sqlite: keywordExpansion "llm" requires keywordExpansionProvider and keywordExpansionModel')
    }
    return {
      ...common,
      keywordExpansion: 'llm',
      keywordExpansionProvider: config.keywordExpansionProvider,
      keywordExpansionModel: config.keywordExpansionModel,
    }
  }
  return {
    ...common,
    keywordExpansion: 'off',
    ...(hasProvider
      ? { keywordExpansionProvider: config.keywordExpansionProvider, keywordExpansionModel: config.keywordExpansionModel }
      : {}),
  }
}

/** 从解析后配置装配命名 embedder（'' = 禁用；'http' 缺 URL/模型半配 fail loud）。 */
function resolveEmbedder(config: ResolvedConfig): EmbeddingProvider | undefined {
  if (config.embeddingProvider === '') return undefined
  if (config.embeddingUrl === undefined || config.embeddingUrl === ''
    || config.embeddingModel === undefined || config.embeddingModel === '') {
    throw new Error('memory-sqlite: embeddingProvider "http" requires embeddingUrl and embeddingModel')
  }
  return createHttpEmbedder({
    url: config.embeddingUrl,
    model: config.embeddingModel,
    apiKey: config.embeddingApiKey,
    timeoutMs: config.embeddingTimeoutMs,
  })
}

/** 内部信号：provider 在 I/O 前拒绝显式 reasoning effort（适配器未声明 reasoning 能力）。 */
class EffortUnsupported extends Error {}

/**
 * 装配插件侧的扩展调用执行体：经 ctx.llm 做一次有界流式调用（BlockAssembler
 * 聚合文本块），与 memory-consolidate 的 createPluginInvoke 同构。llm 服务在
 * 调用时探测（'llm' 而未装配 llm 服务 = 本次扩展失败，store 记录后按未扩展
 * 落库）。扩展是机械生成：缺省关思考，避免推理模型把输出预算烧在思考 token 上。
 * @param ctx - 插件上下文（reflect 取 llm 服务）。
 * @param config - 解析后的配置（路由对、输出上限与超时）。
 * @returns 扩展调用执行体。
 */
function createExpansionInvoke(ctx: Context, config: ResolvedConfig): ExpansionInvoke {
  return async ({ system, user, route }) => {
    const llm = ctx.reflect.get('llm', false) as LlmService | undefined
    if (llm === undefined) {
      throw new Error('memory-sqlite: keywordExpansion "llm" 需要装配 llm 服务（当前未装配）')
    }
    /** 单次扩展调用；withEffort=false 时不携带 reasoningEffort 字段。 */
    const attempt = async (withEffort: boolean): Promise<string> => {
      using callDeadline = deadline(undefined, config.keywordExpansionTimeoutMs, EXPANSION_TIMEOUT_CODE)
      const options: GenerateOptions = deepFreeze({
        provider: route.provider,
        model: route.model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: user }],
          source: { kind: 'plugin', plugin: 'dsh-memory-sqlite' },
        })],
        system,
        maxTokens: config.keywordExpansionMaxOutputTokens,
        ...(withEffort ? { reasoningEffort: ReasoningEffortId(config.keywordExpansionEffort) } : {}),
        signal: callDeadline.signal,
      })
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream(options)) {
        assembler.push(chunk)
      }
      const finish: FinishReason = assembler.finish
      if (finish.kind !== 'stop') {
        // 适配器边界的错误以失败 chunk 而非异常到达（llm 服务 adapterStream 的归一化），
        // effort 拒绝因此体现为 finish.failure.code；它是省 token 优化而非正确性要求。
        if ((finish.kind === 'error' || finish.kind === 'aborted')
          && finish.failure.code === 'UNSUPPORTED_REASONING_EFFORT') {
          throw new EffortUnsupported()
        }
        throw new Error(
          finish.kind === 'error' || finish.kind === 'aborted'
            ? `memory-sqlite: 关键词扩展调用失败（${finish.failure.code}: ${finish.failure.message}）`
            : `memory-sqlite: 关键词扩展调用以 ${finish.kind} 结束`,
        )
      }
      const text = assembler.blocks()
        .flatMap(block => block.type === 'text' ? [block.text] : [])
        .join('')
      if (text.trim() === '') throw new Error('memory-sqlite: 关键词扩展调用未产出文本')
      return text
    }
    try {
      return await attempt(true)
    } catch (error) {
      // 仅匹配 effort 拒绝这一种情况重试（去掉 effort 字段），不是 blanket retry。
      if (error instanceof EffortUnsupported) return await attempt(false)
      throw error
    }
  }
}

/** 按解析后配置装配关键词扩展器（'off' = 禁用；'llm' = 内置 chat 模型扩展，路由对由 ResolvedConfig 静态保证）。 */
function resolveKeywordExpander(ctx: Context, config: ResolvedConfig): KeywordExpander | undefined {
  if (config.keywordExpansion === 'off') return undefined
  return createLlmKeywordExpander({
    invoke: createExpansionInvoke(ctx, config),
    route: { provider: config.keywordExpansionProvider, model: config.keywordExpansionModel },
    maxInputChars: config.keywordExpansionMaxInputChars,
  })
}
