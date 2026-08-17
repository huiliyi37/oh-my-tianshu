/**
 * preset-surface — agent 预设展示面的纯投影（只读，不写回）。
 *
 * 数据源全部是日志事实：
 * - preset 名：session.header.agentPreset（创建/初始值）+ `agent-preset/selected`
 *   事件（blank 窗口切换值），等价宿主 dsh-agent-presets 的 resolveSessionPreset。
 * - wire 工具面：`request/header` 快照是「最近一次请求实际使用的工具 schema」
 *   （含 preset 过滤器作用后的最终面），经官方 `foldRequestHeader` 折叠。
 * - 禅相位：`zen/phase` 事件经官方 `foldZenPhase` 折叠（dsh-zen 的导出 fold，
 *   非插件私有状态）；compaction 剪除后折回 'full'，徽章保守消失。
 *
 * 纪律：本模块不重放任何 preset 插件的私有晋升逻辑（decidePromotion 是
 * (日志 × 配置 × 代码版本) 的函数，配置与版本不在日志里）；只展示日志中
 * 已经存在的事实，compaction 剪除后自然降级（无记录 ≠ 零值）。
 *
 * @module @huiliyi37/dsh-tui/preset-surface
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import { foldRequestHeader } from '@huiliyi37/dsh-session'
import { foldZenPhase } from '@huiliyi37/dsh-zen'

/**
 * 会话当前 preset id：尾向找最后一个 `agent-preset/selected` 切换值，
 * 无则回落 header 的创建值（官方 resolveSessionPreset 的等价 fold）。
 * @param headerAgentPreset - session.header.agentPreset（创建值）。
 * @param events - 会话事件日志（log 顺序）；undefined（无日志句柄）按无记录处理。
 * @returns 当前 preset id；无任何记录返回 undefined。
 */
export function resolvePresetId(
  headerAgentPreset: string | undefined,
  events: readonly SessionEvent[] | undefined,
): string | undefined {
  if (events === undefined) return headerAgentPreset
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event === undefined) continue
    if (event.type === 'agent-preset/selected') {
      const data = event.data as { agentPreset?: string }
      if (typeof data.agentPreset === 'string' && data.agentPreset !== '') return data.agentPreset
    }
  }
  return headerAgentPreset
}

/**
 * 最近一次请求的 wire 工具名集合（`request/header` 快照；含 preset 过滤器
 * 作用后的最终面）。无 request/header 事件（尚未发请求）返回 undefined。
 * @param events - 会话事件日志（log 顺序）；undefined（无日志句柄）按无快照处理。
 * @returns 工具名数组（保持 schema 顺序）；无快照为 undefined。
 */
export function wireToolNames(events: readonly SessionEvent[] | undefined): readonly string[] | undefined {
  if (events === undefined) return undefined
  const header = foldRequestHeader(events)
  return header?.tools?.map(tool => tool.name)
}

/**
 * wire 工具面的展示文本：`[bash, str_replace_editor]` 形式。
 * @param names - wireToolNames 的输出。
 * @returns 方括号列表文本；undefined → undefined。
 */
export function formatWireSurface(names: readonly string[] | undefined): string | undefined {
  if (names === undefined) return undefined
  return `[${names.join(', ')}]`
}

/**
 * wire 工具面的保守阶段标签——只描述「最近一次请求的实际工具面形态」，
 * 不宣称 preset 插件内部状态（晋升与否由插件决定，本模块无从读取）。
 * @param names - wireToolNames 的输出。
 * @returns 阶段标签；无法判定时 undefined。
 */
export function wirePhaseLabel(names: readonly string[] | undefined): string | undefined {
  if (names === undefined || names.length === 0) return undefined
  const set = new Set(names)
  // 锚定面：Minimal/梁神 phase1 的双工具面（持久 shell + str_replace_editor）。
  const shellish = set.has('bash') || set.has('pwsh') || set.has('powershell')
  if (shellish && set.has('str_replace_editor') && set.size === 2) return '锚定面'
  // PTC 面：Code Mode 晋升后 wire 上模型只能直呼 run_code。
  if (set.has('run_code')) return 'PTC 面'
  return undefined
}

/**
 * 禅相位徽章：`zen/phase` 日志折叠为 'zen'（已布防未晋升）时返回徽章文本，
 * 晋升后 / 从未布防 / compaction 剪除后折回 'full' → undefined（徽章消失，
 * 保守降级——无记录 ≠ 禅相位）。
 * @param events - 会话事件日志（log 顺序）；undefined（无日志句柄）按无记录处理。
 * @returns 徽章文本 `禅`；非禅相位为 undefined。
 */
export function zenPhaseLabel(events: readonly SessionEvent[] | undefined): string | undefined {
  if (events === undefined) return undefined
  return foldZenPhase(events) === 'zen' ? '禅' : undefined
}
