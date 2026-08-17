/**
 * dsh-memory-sqlite 的关键词扩展 seam（阶段二d）：不依赖外部 embedding
 * provider 的语义召回路径——save 时用内置 chat 模型为条目生成同义/释义/
 * 跨语言/相关技术术语，并入该版本落库的关键词，FTS/BM25 因此能命中词面
 * 零交叠的释义查询（如 重复收费 → 扣款）。不涉及任何向量。
 *
 * 契约（Agent Note
 * `.agents/notes/proposed/feature/2026-08-16-adaptive-memory-cache-contract.md`
 * 的阶段二d）：
 * - 缺省关闭（Config `keywordExpansion: 'off'`——零额外调用的缺省不变）；
 *   'llm' 时每次 save 一次有界调用（不在请求路径上），失败仅记 log-only
 *   提示、按未扩展落库——扩展是召回增强，永不是正确性依赖。
 * - 扩展词并入落库 keywords：原始 tags 在前（tags[0] 作为 topic 代理的
 *   消费侧契约不变），扩展词在后、精确去重；FTS 索引与事件日志携带合并后
 *   的清单（索引可见 ⟺ 日志可重建）。
 * - 扩展词不做检索侧加权：FTS5 的列加权只区分 text/keywords 两列，词级
 *   权重不可得，故存储侧也不做标记（README Known Limitations 记录）。
 *
 * 本模块是 pure 部分：seam 类型 + LLM 扩展器（invoke 注入，不依赖 cordis
 * Context，保持可无 key 单测）。插件 glue（ctx.llm 调用装配）在 plugin.ts。
 *
 * @module @huiliyi37/dsh-memory-sqlite/expander
 */

/** 一次关键词扩展的输入（save 时已解析的条目字段）。 */
export interface KeywordExpansionInput {
  /** 条目文本。 */
  text: string
  /** 原始关键词（调用方 tags 的拷贝；扩展词不得重复）。 */
  keywords: string[]
  /** 解析后的 topic（tags[0] 代理已生效）。 */
  topic: string
}

/**
 * 关键词扩展执行体：save 时调用，返回扩展词清单（插件侧用内置 chat 模型
 * 实现；测试侧注入脚本化实现）。抛错 = 本次不扩展（store 记录后继续落库）。
 */
export type KeywordExpander = (input: KeywordExpansionInput) => Promise<string[]>

/** 一次扩展调用的模型路由（provider + model 成对；store 无会话可推导，须显式配置）。 */
export interface ExpansionRoute {
  /** 提供方路由名。 */
  provider: string
  /** 模型 id。 */
  model: string
}

/** 一次扩展调用的输入（system/user 已装配，route 已解析）。 */
export interface ExpansionInvokeRequest {
  /** 系统提示（固定输出契约）。 */
  system: string
  /** 用户提示（有界条目文本 + 输出指令）。 */
  user: string
  /** 模型路由（Config 显式对——save 路径没有会话日志可推导）。 */
  route: ExpansionRoute
}

/**
 * 扩展调用的执行体（与 memory-consolidate 的 LlmInvoke 同形，独立定义：
 * 依赖方向是 consolidate → sqlite，反向引入不成立）。
 */
export type ExpansionInvoke = (request: ExpansionInvokeRequest) => Promise<string>

/** createLlmKeywordExpander 的装配参数（全部来自插件 Config + invoke 注入）。 */
export interface LlmKeywordExpanderOptions {
  /** 扩展调用执行体。 */
  invoke: ExpansionInvoke
  /** 模型路由（Config keywordExpansionProvider/keywordExpansionModel 对）。 */
  route: ExpansionRoute
  /** 条目文本字符上限（超出截断；Config keywordExpansionMaxInputChars）。 */
  maxInputChars: number
}

/** 扩展词数上限（模型被要求产出 5–10 个；边界再截到 12 兜底，协议常量）。 */
const MAX_EXPANSION_TERMS = 12

/** 输出契约系统提示（固定文本；逐字节稳定）。 */
const SYSTEM_PROMPT = [
  'You expand a memory entry into extra search keywords for a keyword (BM25) retrieval index.',
  'Return ONLY a JSON array (no Markdown fences, no commentary) of 5-10 short expansion terms:',
  'synonyms, paraphrases, English<->Chinese cross-language equivalents, and related technical',
  'terms a user might search for. Single words or short phrases; do not repeat the given keywords.',
].join('\n')

/**
 * 模型输出 → 扩展词清单（model/JSON 边界校验点）。整体非 JSON 或非数组即
 * 抛错（store 按未扩展落库）；单个非字符串/空白项只丢弃；精确去重、截到
 * MAX_EXPANSION_TERMS。
 * @param raw - 模型原始输出文本（允许 ```json 围栏）。
 * @returns 校验后的扩展词清单（可为空数组）。
 */
export function parseExpansionOutput(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`memory-sqlite: 关键词扩展输出不是合法 JSON: ${String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('memory-sqlite: 关键词扩展输出不是 JSON 数组')
  }
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (term === '' || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
    if (terms.length >= MAX_EXPANSION_TERMS) break
  }
  return terms
}

/**
 * 装配 LLM 关键词扩展器：有界条目文本 → 一次性结构化调用 → 边界校验后的
 * 扩展词。零重试——失败由 store 记录并按未扩展落库（save 绝不因扩展失败
 * 而失败）。
 * @param options - invoke 注入 + 显式路由对 + 输入上限。
 * @returns 关键词扩展执行体。
 */
export function createLlmKeywordExpander(options: LlmKeywordExpanderOptions): KeywordExpander {
  return async (input) => {
    const text = input.text.length > options.maxInputChars
      ? `${input.text.slice(0, options.maxInputChars)}\n… (entry truncated at ${options.maxInputChars} chars)`
      : input.text
    const raw = await options.invoke({
      system: SYSTEM_PROMPT,
      user: [
        `Entry topic: ${input.topic}`,
        `Existing keywords: ${input.keywords.join(', ')}`,
        '',
        'Entry:',
        text,
      ].join('\n'),
      route: options.route,
    })
    return parseExpansionOutput(raw)
  }
}
