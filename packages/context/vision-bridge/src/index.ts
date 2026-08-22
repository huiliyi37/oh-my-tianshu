/**
 * 视觉桥插件 — 主控模型不识图时，把用户图片附件转文字描述后注入。
 *
 * TUI 输入框允许用户粘贴图片（data URL 以 image ContentBlock 进入会话）。
 * 主控模型支持识图时图片直发；不支持时若配置了独立视觉模型（本插件），
 * 图片经该模型转文字描述，描述随 `agent/pre-step` 注入为 plugin-source
 * user message（Model-visible ⟺ logged：描述进 session 事件，从日志可重建；
 * 原图不落入 session——text-only 主控从未见过像素）。
 *
 * 职责边界：
 * - **主控能力声明**：`primarySupportsVision` 由装配方按主控模型事实配置
 *   （缺省 false = 不识图 → 有图即走桥）。声明 true 时本插件不干预，图片直发。
 * - **截断续写**：描述撞 `maxTokens` 上限时自动续写一次（助手截断文本 + 继续
 *   指令），拼接为完整描述；续写仍撞限或失败才落 `[图片描述被截断]` 标记——
 *   多主体图片不再因输出预算丢尾。
 * - **桥失败不炸轮**：视觉模型超时/报错/返回空，都降级为可见的桥接提示文本，
 *   让主控知道"有图但没读到"，而非静默吞图或整轮 failed。
 * - **TUI 提示一致性**：TUI 的 `vision.bridgeEnabled` 提示与本插件配置同源
 *   （装配方派生）；装配方未派生时，TUI 经本插件 provide 的 `visionBridge`
 *   探测服务自动判定桥可用性（存在即桥可用）。无桥且主控不识图时 TUI
 *   提交侧已过滤图片（气泡警告），本插件只处理"有桥"一态。
 *
 * @module @huiliyi37/dsh-vision-bridge
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { PreStepDecision } from '@huiliyi37/dsh-agent'
import { BlockAssembler, createAssistantMessage, createUserMessage, LlmError } from '@huiliyi37/dsh-llm'
import type { ContentBlock, GenerateOptions, UserMessage } from '@huiliyi37/dsh-llm'
// Type-only：让 `ctx.get('modelRoles')` 在组合装配时解析到角色 pin 服务——
// 本插件机会式消费（`ctx.get` 可选服务模式），从不硬依赖。
import type {} from '@huiliyi37/dsh-model-roles'

/** Cordis plugin name（session 事件的 source.plugin 标记）。 */
export const name = 'vision-bridge'

/** The llm service that drives the vision-model bridge calls. */
export const inject = ['llm']

/** 视觉桥探测服务面：存在即桥已装配（展示层经 `reflect.get('visionBridge', false)` 判定）。 */
export interface VisionBridgeProbe {
  /** 装配该桥的插件名（调试/日志用）。 */
  readonly providedBy: string
}

declare module '@huiliyi37/cordis' {
  interface Context {
    /** 视觉桥探测服务：vision-bridge 插件装配时 provide，随其卸载释放。 */
    visionBridge: VisionBridgeProbe
  }
}

/** 视觉桥配置：描述模型路由（role pin / 显式 / 自动）+ 主控能力声明。 */
export interface Config {
  /** 总开关；false 时不注册监听（缺省 true）。 */
  enabled?: boolean
  /** 显式视觉模型的 provider route；低于 vision 角色 pin，高于 visionAutoBridge 自动选择。 */
  provider?: string
  /** 显式视觉模型名；低于 vision 角色 pin，高于 visionAutoBridge 自动选择。 */
  model?: string
  /** 自定义描述 prompt；缺省按随图文本自动选通用/精确转写模式。 */
  prompt?: string
  /** 描述输出 token 上限（缺省 2048；撞限时自动续写一次，仍超限才落截断标记）。 */
  maxTokens?: number
  /** 主控模型是否原生支持识图（缺省 false；true 时本插件不干预，图片直发）。 */
  primarySupportsVision?: boolean
  /** 备用视觉模型（主视觉模型 error/aborted 时兜底重试一次；缺省不启用）。 */
  fallback?: {
    /** 备用视觉模型的已注册 llm provider 路由。 */
    provider: string
    /** 备用视觉模型 id。 */
    model: string
  }
  /** 未显式配置 provider/model 时，自动选第一个声明 supportsVision 的已注册模型。 */
  visionAutoBridge?: boolean
}

/**
 * Schemastery validation for {@link Config}. provider/model 在 schema 层可选——
 * 「显式缺省、装配时无 vision 角色 pin 且未开 visionAutoBridge 即 fail loud」
 * 由 {@link apply} 在装配时判定（跨字段条件约束 schemastery 表达不了）。
 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  maxTokens: z.number().step(1).min(1).default(2048),
  primarySupportsVision: z.boolean().default(false),
  // union(object, never)：fallback 缺省为 null/undefined；一旦给出则 provider/model 必填。
  fallback: z.union([
    z.object({ provider: z.string().required(), model: z.string().required() }),
    z.never(),
  ]),
  visionAutoBridge: z.boolean().default(false),
})

// ── 描述 prompt 选择（通用 / UI-OCR 精确转写）──────────────────

/** 通用模式：结构化描述，便于 text-only 主控定位关键信息。 */
const GENERAL_VISION_PROMPT =
  '请用中文分析这张图片，按以下结构输出：\n'
  + '## 文字内容\n（逐字转写图中所有可见文字，尤其是报错、代码、按钮、标签；无则写"无"）\n'
  + '## 界面元素\n（描述界面结构、控件、布局、状态）\n'
  + '## 可能意图\n（推测用户为何发这张图、想解决什么）'

/** UI/报错精确模式：截图里往往关键就一行报错，泛泛描述会丢掉它。 */
const UI_PRECISE_VISION_PROMPT =
  '这是一张 UI/终端/代码截图。请用中文精确处理：\n'
  + '## 文字内容（逐字转写，一字不差）\n'
  + '（OCR 级转写所有可见文本：报错信息、堆栈、命令、代码、日志、路径、行号，'
  + '保留原始大小写和标点。这是最重要的部分，不要概括、不要省略、不要翻译）\n'
  + '## 界面结构\n（窗口/面板/终端布局，高亮或选中的区域，光标位置）\n'
  + '## 可能意图\n（用户想解决的问题）'

/** UI/报错截图判定关键词——命中则用精确转写模式而非泛泛描述。 */
const UI_INTENT_KEYWORDS = [
  '报错', 'error', '异常', 'exception', 'traceback', '堆栈', 'stack', '失败',
  'failed', '终端', 'terminal', '命令行', 'console', '日志', 'log', '代码',
  'code', '截图', 'screenshot', '报错信息', 'panic', '警告', 'warning',
  '崩溃', 'crash', '报错行', '栈',
]
const UI_INTENT_PATTERN = new RegExp(UI_INTENT_KEYWORDS.join('|'), 'i')

/**
 * 选择识图 prompt：显式配置永远优先；否则按随图文本判定 UI/报错关键词。
 * @param configuredPrompt - 用户/配置显式给的 prompt（trim 后为空视为未给）
 * @param accompanyingText - 随图发送的用户文本
 * @returns 选定的描述 prompt 文本
 */
export function selectVisionPrompt(configuredPrompt?: string, accompanyingText?: string): string {
  if (configuredPrompt && configuredPrompt.trim()) return configuredPrompt
  if (accompanyingText && UI_INTENT_PATTERN.test(accompanyingText)) return UI_PRECISE_VISION_PROMPT
  return GENERAL_VISION_PROMPT
}

// ── 视觉路由解析（role pin / 显式 / 自动桥）──────────────────────────

/**
 * 解析视觉模型路由，回退顺序：**vision 角色 pin（`ctx.get('modelRoles')`，
 * settings.yaml 热重载即时生效的覆盖）> 显式 provider/model >
 * visionAutoBridge 自动选择**（遍历已注册 provider 的 advisory catalog，
 * 取第一个 `supportsVision === true` 的模型）。
 * @param ctx - Cordis context（llm 服务查询注册模型能力；可选 modelRoles 读取 pin）。
 * @param config - 显式 provider/model 与 visionAutoBridge 开关。
 * @returns 视觉路由；无 pin、无显式路由且（未开自动桥或找不到识图模型）时 null。
 */
async function resolveVisionRoute(
  ctx: Context,
  config: Pick<Config, 'provider' | 'model' | 'visionAutoBridge'>,
): Promise<{ provider: string; model: string } | null> {
  const pin = ctx.get('modelRoles')?.resolve('vision')
  if (pin !== undefined) return { provider: pin.provider, model: pin.model }
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  if (config.visionAutoBridge !== true) return null
  for (const provider of ctx.llm.listProviders()) {
    for (const model of await ctx.llm.listModels(provider.id)) {
      if (model.supportsVision === true) return { provider: model.provider, model: model.id }
    }
  }
  return null
}

// ── 描述生成 ───────────────────────────────────────────────

/**
 * 把图片 data URL 列表发给视觉模型，返回文字描述（one-shot 完成）。
 * 桥调用失败（error/aborted finish）抛 LlmError；返回空串 = 视觉模型给了空输出。
 * 配置了 fallback 时，主视觉模型 error/aborted 会兜底重试一次备用模型。
 * @param ctx - Cordis context（经 inject 提供 llm 服务）
 * @param config - 视觉模型路由（含可选备用）、prompt 与输出上限
 * @param images - 图片 data URL 列表（非空）
 * @param accompanyingText - 随图用户文本（prompt 未显式配置时参与模式判定）
 * @param signal - 取消信号（透传给 llm 调用）
 * @returns 描述文本（trim）；空串表示视觉模型未产出内容
 */
export async function describeImages(
  ctx: Context,
  config: Pick<Config, 'provider' | 'model' | 'prompt' | 'maxTokens' | 'fallback' | 'visionAutoBridge'>,
  images: string[],
  accompanyingText: string,
  signal?: AbortSignal,
): Promise<string> {
  if (images.length === 0) return ''
  // data URL 校验（opencode-tui 同款）：非法格式在发起模型调用前失败，
  // 不浪费一次视觉模型调用。
  for (const url of images) {
    if (!url.startsWith('data:')) throw new Error('图片 URL 不是 data URL 格式，请检查图片数据')
    const commaIdx = url.indexOf(',')
    const header = commaIdx >= 0 ? url.slice(0, commaIdx) : url
    if (!/^data:image\/(png|jpeg|gif|webp|bmp|tiff);base64$/.test(header)) {
      throw new Error(
        '图片格式不受视觉模型支持（期望 image/png, image/jpeg, image/gif, image/webp），'
        + `实际头部: ${header.slice(0, 60)}${header.length > 60 ? '…' : ''}`,
      )
    }
    const payloadLen = commaIdx >= 0 ? url.length - commaIdx - 1 : 0
    if (payloadLen < 64) {
      throw new Error(`图片数据异常短（${payloadLen} 字符），可能被截断`)
    }
  }
  const prompt = selectVisionPrompt(config.prompt, accompanyingText)
  const content: ContentBlock[] = [
    { type: 'text', text: prompt },
    ...images.map(dataUrl => ({ type: 'image' as const, dataUrl })),
  ]
  // 视觉路由：vision 角色 pin、显式 provider/model 或自动桥；三者皆无时抛错，
  // 由 bridgeOne 降级为提示。
  const route = await resolveVisionRoute(ctx, config)
  if (route === null) {
    throw new LlmError(
      'vision-bridge: 无可用视觉模型路由（请配置 provider/model 或开启 visionAutoBridge）',
      'NO_ADAPTER',
    )
  }
  /** 续写指令：让视觉模型从截断处接续，不重复已有文字。 */
  const CONTINUE_INSTRUCTION =
    '你的上一段输出在 token 上限处被截断。请从中断处直接继续输出剩余内容：'
    + '不要重复任何已输出的文字，不要重新开始，不要加前言。'
  const callOnce = async (
    options: GenerateOptions,
  ): Promise<{ text: string; truncated: boolean }> => {
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
    }
    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    return { text, truncated: finish.kind === 'max-tokens' }
  }
  const attempt = async (route: { provider: string; model: string }): Promise<string> => {
    const request: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({ content, source: { kind: 'plugin', plugin: name } })],
      ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
      purpose: 'vision-description',
      ...signal === undefined ? {} : { signal },
    }
    const first = await callOnce(request)
    if (!first.truncated) return first.text
    // 撞上限 → 自动续写一次（有界）：助手截断文本 + 继续指令；仍截断才落标记。
    // 续写自身失败不丢已有部分——部分描述 + 截断标记仍优于空描述。
    let tail = ''
    let stillTruncated = true
    try {
      const second = await callOnce({
        ...request,
        messages: [
          ...request.messages,
          createAssistantMessage({
            content: [{ type: 'text', text: first.text }],
            source: { provider: route.provider, model: route.model },
          }),
          createUserMessage({
            content: [{ type: 'text', text: CONTINUE_INSTRUCTION }],
            source: { kind: 'plugin', plugin: name },
          }),
        ],
      })
      tail = second.text
      stillTruncated = second.truncated
    } catch {
      return `${first.text}\n[图片描述被截断]`.trim()
    }
    return `${first.text}${tail}${stillTruncated ? '\n[图片描述被截断]' : ''}`.trim()
  }
  try {
    return await attempt(route)
  } catch (err) {
    // 主视觉模型 error/aborted（5xx/超时等）→ 备用视觉模型兜底重试一次；
    // 无备用或非 LlmError（传输层异常）→ 原样上抛，由 bridgeOne 降级为可见提示。
    if (config.fallback === undefined || !(err instanceof LlmError)) throw err
    return await attempt(config.fallback)
  }
}

// ── pre-step 注入 ──────────────────────────────────────────

/** 消息内所有 text block 拼接（描述注入前缀用）。 */
function flattenText(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** 含图消息 → 描述注入消息（image block 由描述文本替换；source 重归因为本插件，
 *  供 invariant 校验与日志归因——注入文本不再伪装成用户原始输入）。 */
async function bridgeOne(
  ctx: Context,
  config: Config,
  message: UserMessage,
  signal: AbortSignal,
): Promise<UserMessage> {
  const images = message.content.filter(block => block.type === 'image')
  const text = flattenText(message)
  const dataUrls = images.map(block => block.dataUrl)
  const source = { kind: 'plugin', plugin: name } as const
  try {
    const description = await describeImages(ctx, config, dataUrls, text, signal)
    if (description) {
      return { ...message, source, content: [{ type: 'text', text: `[图片描述]\n${description}\n\n${text}` }] }
    }
    return {
      ...message,
      source,
      content: [{
        type: 'text',
        text: `[图片桥接提示] 用户发送了 ${images.length} 张图片，但识图模型返回空描述——`
          + `请告知用户重发或检查识图模型配置。\n\n${text}`,
      }],
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      ...message,
      source,
      content: [{
        type: 'text',
        text: `[图片桥接失败] 用户发送了 ${images.length} 张图片，但识图桥接出错（${reason}）——`
          + `请告知用户识图暂不可用，可检查 vision-bridge 配置或稍后重试。\n\n${text}`,
      }],
    }
  }
}

/**
 * 把 decision.messages 中含图消息全部替换为描述注入消息。
 * @returns 替换后的消息数组；无任何含图消息时返回 null（调用方保持原 decision）
 */
async function bridgeImages(
  ctx: Context,
  config: Config,
  messages: UserMessage[],
  signal: AbortSignal,
): Promise<UserMessage[] | null> {
  let changed = false
  const out: UserMessage[] = []
  for (const message of messages) {
    if (message.content.some(block => block.type === 'image')) {
      changed = true
      out.push(await bridgeOne(ctx, config, message, signal))
    } else {
      out.push(message)
    }
  }
  return changed ? out : null
}

/**
 * 注册 pre-step 视觉桥监听（prepend：先于其他注入器注册；本监听先 next() 拿到
 * 其余注入器的 decision 后再改写，故描述替换对最终 decision 最后生效）。
 * 主控支持识图（primarySupportsVision）时不干预；无图消息零开销透传。
 *
 * 装配期 fail-loud：显式 provider/model、vision 角色 pin（装配时经
 * `ctx.get('modelRoles')` 判定）、visionAutoBridge 三者必有其一，缺全部即抛。
 * 注意 pin 只在**装配时已存在**才算满足——运行时后到的 pin 不豁免本检查：
 * 组合必须声明路由意图（显式配置或自动桥），pin 是用户级覆盖而非装配依据。
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - 视觉桥配置；未配置视觉模型、无 pin 且未开 visionAutoBridge 时装配即失败（fail loud）。
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  // 跨字段 fail-loud（schema 层表达不了）：显式 provider/model、装配期已存在的
  // vision 角色 pin、自动桥三者必有其一。
  const explicit = config.provider !== undefined && config.model !== undefined
  const pinned = ctx.get('modelRoles')?.resolve('vision') !== undefined
  if (!explicit && !pinned && config.visionAutoBridge !== true) {
    throw new Error('vision-bridge: 未配置视觉模型——请提供 provider/model，或开启 visionAutoBridge')
  }

  // 探测服务面：TUI 等展示层经 reflect.get('visionBridge', false) 判定桥可用性
  // （存在即已装配），装配方无需再派生 vision.bridgeEnabled 配置；随插件卸载释放。
  ctx.provide('visionBridge', { providedBy: name })

  ctx.on('agent/pre-step', async (
    { signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (config.primarySupportsVision) return decision
    const rewritten = await bridgeImages(ctx, config, decision.messages, signal)
    if (rewritten === null) return decision
    return { kind: 'enter', messages: rewritten }
  }, { prepend: true })
}
