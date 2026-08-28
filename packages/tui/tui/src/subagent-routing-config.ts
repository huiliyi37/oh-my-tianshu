/**
 * subagent-routing-config — 子代理路由授权的推荐与校验纯函数（回流自
 * opencode-tui 01313be6c 的引导三件套，适配本仓 llm 活目录接缝）。
 *
 * 目录成员资格是 advisory：校验只产生 ⚠ 提示，不阻断已存授权（适配器
 * 仍可能接受目录外精确 id）；推荐只在已注册 provider 的目录内挑目标。
 *
 * @module @huiliyi37/dsh-tui/subagent-routing-config
 */

/** llm 活目录的最小投影（listProviders × listModels）。 */
export interface RoutingDirectoryProvider {
  readonly id: string
  readonly models: readonly string[]
}

/** 一条已授权的精确路由。 */
export interface RoutingRoute {
  readonly provider: string
  readonly model: string
}

/**
 * 推荐路由目标探测：模型 id 含 flash 优先，其次 deepseek 系，最后第一个
 * 目录内模型。目录为空返回 null（调用方转空态引导）。
 * @param providers - llm 活目录投影。
 * @returns 推荐的精确路由；无候选为 null。
 */
export function findRecommendedRoute(
  providers: readonly RoutingDirectoryProvider[],
): RoutingRoute | null {
  const all = providers.flatMap(provider => provider.models.map(model => ({ provider: provider.id, model })))
  if (all.length === 0) return null
  const flash = all.find(route => /flash/i.test(route.model))
  if (flash !== undefined) return flash
  const deepseek = all.find(route => /deepseek/i.test(route.provider) || /deepseek/i.test(route.model))
  if (deepseek !== undefined) return deepseek
  return all[0] ?? null
}

/**
 * 路由目标存在性校验（⚠ 警告 hint 用）：provider 已注册且目录含该 model id。
 * @param route - 待校验的精确路由。
 * @param providers - llm 活目录投影。
 * @returns 目录内可解析为 true。
 */
export function routeResolvesDirectory(route: RoutingRoute, providers: readonly RoutingDirectoryProvider[]): boolean {
  return providers.some(
    provider => provider.id === route.provider && provider.models.includes(route.model),
  )
}

/**
 * 委派树面板的路由发现性提示行（每会话一次；仅选择关且无授权路由时出现）。
 * @returns 提示文本。
 */
export function subagentRoutingNudgeText(): string {
  return 'ℹ 子代理当前跟随主模型——/config「子代理模型」可为委派配置独立路由（新顶层会话生效）'
}
