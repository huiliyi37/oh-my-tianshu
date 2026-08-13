/**
 * spark reasoning-tail truncation（内部能力 · 移植自桌面端 src/pro/spark/，外部参照 opencode-tui）。
 *
 * 语义：按 token 边界保留推理文本的尾部 N token，头部（排除/分析过程）丢弃；
 * 被丢弃段中的显式排除句提取为锚点（extractExcludedClaims），由锚点插件随每轮回灌，
 * 防止模型重复推导已经排除的路径（与截断成对上线，不得单独部署截断）。
 *
 * 确定性前提：同一输入 + 同一 tokenizer → 同一输出（字节稳定，前缀缓存依赖）。
 * tokenizer 由调用方注入（truncateReasoningTail）或使用内置退化分词
 * （defaultTokenizer）：CJK 单字 + 连续拉丁·数字·下划线串 + 空白符，u flag 按码点
 * 匹配（代理对不裂）。字节稳定成立；截断位置精度低于真 BPE，属质量档差异
 * （真 tokenizer 接入点见 truncateReasoningTail 的 Tokenizer 参数）。
 *
 * @module dsh-llm-deepseek/spark
 */

/** Token 覆盖的字符区间（start 含，end 不含）。 */
export interface TokenSpan {
  start: number
  end: number
}

/** 字符串 → token 字符区间列表。注入点：可替换为真 BPE tokenizer 的等价输出。 */
export type Tokenizer = (s: string) => TokenSpan[]

/** spark 截断档位：按模型档取 N（flash 300 / pro 0 = 需显式开启）。 */
export interface SparkTruncatePolicy {
  /** flash 档保留的尾部 token 数（默认 300）。 */
  flash: number
  /** pro 档保留的尾部 token 数（默认 0 = 不截断，需显式开启）。 */
  pro: number
}

/** spark provider route（注册于 ctx.llm 的第二条 DeepSeek route）。 */
export const SPARK_PROVIDER = 'deepseek-spark'

/** spark 请求策略：enabled 开启后仅 SPARK_PROVIDER route 生效。 */
export interface SparkRequestPolicy {
  /** 总开关；false（缺省）时任何 route 都不截断。 */
  enabled: boolean
  /** 按模型档的截断 N（flash 300 / pro 0）。 */
  truncateN: SparkTruncatePolicy
}

/**
 * 保留推理文本尾部 N token；N<=0 返回空串（全截）；token 数不足 N 返回原文。
 * 输出 = 原文的连续子串（从第 len-N 个 token 的起点切到结尾）——不重组 token，
 * 保证任何 tokenizer 下字节稳定。
 * @param reasoning - 完整推理文本。
 * @param nTokens - 保留的尾部 token 数；<=0 全截。
 * @param tokenize - 分词器（wire 与锚点两侧必须同源）。
 * @returns 截断后的尾段（原文连续子串）。
 */
export function truncateReasoningTail(
  reasoning: string,
  nTokens: number,
  tokenize: Tokenizer,
): string {
  if (nTokens <= 0) return ''
  if (reasoning === '') return ''
  const spans = tokenize(reasoning)
  if (spans.length <= nTokens) return reasoning
  // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by spans.length > nTokens
  const cutStart = spans[spans.length - nTokens]!.start
  return reasoning.slice(cutStart)
}

/**
 * 确定性退化分词：CJK 单字 / 连续拉丁·数字·下划线串 / 空白 / 其余单码点。
 * 纯正则无状态——同一输入恒同输出（字节稳定）。u flag 使 `.` 按码点匹配，
 * 代理对（emoji 等 astral 字符）不再被切成两个半符。
 * @param s - 待分词文本。
 * @returns 有序 token 跨度列表（start/end 偏移）。
 */
export function defaultTokenizer(s: string): TokenSpan[] {
  const spans: TokenSpan[] = []
  const re = /[\u4e00-\u9fff\u3400-\u4dbf]|[A-Za-z0-9_]+|\s+|./gu
  for (const m of s.matchAll(re)) {
    spans.push({ start: m.index, end: m.index + m[0].length })
  }
  return spans
}

/**
 * 截断切点（内置退化分词）：token 数 ≤ N 时无截断（返回 -1），否则返回丢失前段的
 * 结束偏移。锚点插件用它判定「丢失域」，与 truncateReasoningTail 同一分词同一 N——
 * 两者精确互补：锚点只描述模型看不到的那段推理。
 * @param reasoning - 完整推理文本。
 * @param n - wire 截断保留的尾部 token 数。
 * @returns 丢失前段的结束偏移；无截断返回 -1，n<=0 返回 0。
 */
export function truncateCutStart(reasoning: string, n: number): number {
  if (n <= 0) return 0
  if (reasoning === '') return -1
  const spans = defaultTokenizer(reasoning)
  if (spans.length <= n) return -1
  // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by spans.length > n
  return spans[spans.length - n]!.start
}

/**
 * N 档解析：pro 判定用分段词匹配（deepseek-v4-pro → ['deepseek','v4','pro']），
 * 避免 'provider' / 'prophet' 类子串误命中（includes('pro') 的已知缺陷）。
 * 模型名缺失时回落 flash 档。
 * @param model - 模型 id；undefined 走 flash 档。
 * @param policy - flash/pro 两档 N 值。
 * @returns 该模型生效的截断 N。
 */
export function resolveTruncateN(model: string | undefined, policy: SparkTruncatePolicy): number {
  const isPro = (model ?? '').toLowerCase().split(/[-_./:]/).includes('pro')
  return isPro ? policy.pro : policy.flash
}

const ZH_EXCLUDE_RE =
  // oxlint-disable-next-line @stylistic/max-len -- exclusion-regex ported verbatim from the desktop source
  /(?:^|[，。；、\s])[^，。；、\s]{0,40}?(?<![是要还并])不是[^，。；、]{0,60}?(?=[，。；、]|$)|(?:^|[，。；、\s])[^，。；、\s]{0,40}?(?:不太可能|不可行|不合适|排除(?:掉)?了?|不对|不成立)[^，。；、]{0,60}?(?=[，。；、]|$)/g
/** 英文排除句式——字符类含中文句末标点：混合语言推理文本中 EN 分支不得跨
 *  中文句号吞段（`[^.;]` 不含「。」——"not the root cause" 会把前面整句中文
 *  一并捕获为锚点，把未排除的分析误当已排除路径，实测复现）。 */
const EN_EXCLUDE_RE =
  // oxlint-disable-next-line @stylistic/max-len -- exclusion-regex ported verbatim from the desktop source
  /(?:^|[.;。！？])\s*[^.;。！？]{0,80}?\b(?:is not|are not|won't work|doesn't work|reject|unlikely|exclude|not (?:the|a|likely|feasible))[^.;。！？]{0,80}?(?=[.;。！？]|$)/gi

/**
 * 排除路径锚点提取（移植自桌面端 anchor.ts）：从推理文本提取「已排除的路径/假设」，
 * 作为被截断段落的自足替代物。保守策略：只提取显式否定句，宁缺毋滥（误提会把
 * 未排除项当已排除，更伤）。
 * @param reasoning - 待提取的推理文本（通常为截断丢失段）。
 * @returns 排除路径 claim 列表（中英句式，超短匹配已过滤）。
 */
export function extractExcludedClaims(reasoning: string): string[] {
  if (!reasoning) return []
  const claims: string[] = []
  for (const m of reasoning.matchAll(ZH_EXCLUDE_RE)) {
    const s = m[0].trim()
    if (s.length > 4) claims.push(s)
  }
  for (const m of reasoning.matchAll(EN_EXCLUDE_RE)) {
    const s = m[0].trim()
    if (s.length > 8) claims.push(s)
  }
  return claims
}
