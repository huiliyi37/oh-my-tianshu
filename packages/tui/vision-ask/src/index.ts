/**
 * @huiliyi37/dsh-vision-ask — vision co-pilot plugin for the harness.
 *
 * Session-scoped image registry + `ask_image` tool. When a user attaches
 * images (any entry point — TUI, subagent, tool-injected messages), their
 * inline data URLs are registered under short ids; the model can then
 * re-interrogate any retained image via `ask_image` without the user
 * re-sending it.
 *
 * The plugin registers its own llm provider route with an OpenAI-compatible
 * vision adapter (for text-only primary wire routes), so description calls
 * ride the standard `ctx.llm.stream` path — retry/error/cancel semantics
 * preserved, description text lands in the tool result and the session log
 * (Model-visible ⟺ logged).
 *
 * @module @huiliyi37/dsh-vision-ask
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import type { SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import { registerAskImageTool } from './ask-tool.ts'
import { ImageRegistry } from './registry.ts'
import { VisionAdapter } from './vision-adapter.ts'

/** Stable Cordis plugin name. */
export const name = 'vision-ask'

/** llm/tools services drive the registry listener and the tool registration. */
export const inject = ['llm', 'tools']

/** Vision co-pilot configuration. */
export interface Config {
  /** Master switch; false disables registration, tool, and listener (default true). */
  enabled?: boolean
  /**
   * Provider route the plugin registers for vision calls (default 'vision-ask').
   * Independent of the primary model's provider — the adapter serializes
   * image blocks that the text-only baseline route cannot carry.
   */
  provider?: string
  /** Vision model id sent on the wire (required). */
  model: string
  /** OpenAI-compatible endpoint base (default https://api.deepseek.com). */
  baseUrl?: string
  /** Environment variable holding the API key (default DEEPSEEK_API_KEY). */
  apiKeyEnv?: string
  /** Description output token cap (default 1024). */
  maxTokens?: number
  /**
   * Primary-model vision capability override. Omitted: resolved dynamically
   * from the calling agent's model via supportsVision. true: always forward
   * the original image to the primary. false: always describe via the vision
   * adapter.
   */
  primarySupportsVision?: boolean
  /** Registry image-count cap per session (default 8). */
  registryMaxImages?: number
  /** Registry total-byte cap per session (default 24 MiB). */
  registryMaxBytes?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  provider: z.string().default('vision-ask'),
  model: z.string().required(),
  baseUrl: z.string().default('https://api.deepseek.com'),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  maxTokens: z.number().step(1).min(1).default(1024),
  primarySupportsVision: z.boolean(),
  registryMaxImages: z.number().step(1).min(1).default(8),
  registryMaxBytes: z.number().step(1).min(1).default(24 * 1024 * 1024),
})

/** Extract inline image sources (data URL + optional MIME) from one user message. */
function imageSourcesFromUserMessage(
  event: Extract<SessionEvent, { type: 'user/message' }>,
): Array<{ dataUrl: string; mime?: string }> {
  const sources: Array<{ dataUrl: string; mime?: string }> = []
  for (const block of event.data.content) {
    if (block.type !== 'image') continue
    const { dataUrl, mime } = block as { dataUrl: string; mime?: string }
    sources.push({ dataUrl, ...mime === undefined ? {} : { mime } })
  }
  return sources
}

/**
 * Mount the vision co-pilot.
 * @param ctx - plugin context; wires the registry listener, the vision adapter
 *   provider route, and the ask_image tool.
 * @param config - validated vision co-pilot configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return

  // 会话隔离注册表：sessionId → ImageRegistry；会话处置时清理。
  const registries = new Map<SessionId, ImageRegistry>()
  const registryFor = (sessionId: SessionId): ImageRegistry => {
    let registry = registries.get(sessionId)
    if (registry === undefined) {
      registry = new ImageRegistry({
        ...config.registryMaxImages === undefined ? {} : { maxImages: config.registryMaxImages },
        ...config.registryMaxBytes === undefined ? {} : { maxBytes: config.registryMaxBytes },
      })
      registries.set(sessionId, registry)
    }
    return registry
  }

  // 注册监听：user/message 事件里的图片 data URL 进注册表（所有入口覆盖）。
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return
    const sources = imageSourcesFromUserMessage(event)
    if (sources.length === 0) return
    registryFor(session.id).register(sources)
  })

  // schemastery default 在运行时兜底；类型层显式合并同一缺省值。
  const provider = config.provider ?? 'vision-ask'
  const maxTokens = config.maxTokens ?? 1024

  // 视觉 adapter 注册：provider route 独立于主控，携带 image 序列化能力。
  const disposeAdapter = ctx.llm.registerAdapter([provider], new VisionAdapter({
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
    apiKeyEnv: config.apiKeyEnv ?? 'DEEPSEEK_API_KEY',
    model: config.model,
    maxTokens,
  }))

  // ask_image 工具注册。
  const disposeTool = registerAskImageTool(ctx, {
    registries,
    visionProvider: provider,
    visionModel: config.model,
    maxTokens,
    ...config.primarySupportsVision === undefined ? {} : { primarySupportsVision: config.primarySupportsVision },
  })

  // 生命周期：注册表随插件卸载清空；registries 无其他长期持有者。
  ctx.effect(() => () => {
    disposeAdapter()
    disposeTool()
    registries.clear()
  })
}

export { ImageRegistry } from './registry.ts'
export { visionCacheKey } from './registry.ts'
export { VisionAdapter } from './vision-adapter.ts'
export { buildVisionMessage } from './vision-adapter.ts'
