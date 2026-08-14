/**
 * MetricsGlanceController — 底部 glance 数据收集与刷新节流（Phase 5.3 数据基础）。
 *
 * 把 ui/app.ts 原先内联在 renderLive 里的状态行回退派生与错误行格式化收敛为
 * 纯函数（deriveGlanceStatus / deriveGlanceError / deriveGlance），控制器把它们
 * 包进「窗口内合并、窗口末重算」的节流。数据全部来自既有 LiveAgentState 与
 * statusLine 投影，不发明事件类型。
 *
 * 节流语义：
 * - 首次 refresh 恒同步重算（构造后立即可读，不依赖时钟）。
 * - 窗口内（throttleMs，默认 16ms 一帧）重复 refresh 合并到窗口末重算一次；
 *   窗口外 refresh 同步重算。重收集成本被节流封顶，状态行/错误行新鲜度 ≤ 一帧。
 * - 数据实际变化时经 onChange 推送（未变化不推送，避免重绘风暴）。
 *
 * @module @huiliyi37/dsh-tui/engine/metrics-glance-controller
 */

import type { LiveAgentState } from '../adapter/live.js'
import { truncateToDisplayWidth } from '../width.js'
import { useAsciiGlyphs } from '../term-caps.js'

/** 底部 glance 一行数据（纯文本，无 ANSI——着色留在装配层）。 */
export interface GlanceLine {
  /**
   * 状态行文本：WorkflowStatusLine.current 优先，否则 agent 状态派生；
   * 空闲态 null（不占位——grok minimal 布局：空闲不渲染状态行，屏占让给内容）。
   */
  status: string | null
  /** 错误行文本（glyph + 截断首行）；无错误 null。 */
  error: string | null
}

/** MetricsGlanceController 构造参数（数据源 getter + 节流窗口 + 变化回调）。 */
export interface MetricsGlanceControllerOptions {
  /** 状态行文本源（WorkflowStatusLine.current）；null = 无投影。 */
  getStatusText: () => string | null
  /** live agent 状态源；undefined = 未挂载。 */
  getLiveState: () => LiveAgentState | undefined
  /** 终端列数（错误首行截断度量）。 */
  getColumns: () => number
  /** 刷新节流窗口（毫秒）；窗口内重复 refresh 合并到窗口末重算。默认 16（一帧）。 */
  throttleMs?: number
  /** 数据实际变化时回调（节流后触发）。 */
  onChange?: (data: GlanceLine) => void
}

/**
 * 状态行派生：工作流投影优先，否则 agent 状态回退（复刻 TuiApp 旧装配）。
 * 空闲态返回 null（不渲染不占位）：空闲提示已由 footer 承载，状态行只在
 * 「有事发生」（运行中/已停止/投影文本）时出现。
 * @param statusText - WorkflowStatusLine.current；null = 无投影。
 * @param live - live agent 状态；undefined = 未挂载。
 * @returns 状态行纯文本；空闲 null。
 */
export function deriveGlanceStatus(statusText: string | null, live: LiveAgentState | undefined): string | null {
  if (statusText !== null) return statusText
  if (live === undefined || live.live) {
    return live?.status === 'running' ? '● 运行中' : null
  }
  return '✗ 已停止'
}

/**
 * 错误行派生：glyph（ascii 降级）+ 首行截断至 cols-2（复刻 TuiApp 旧装配）。
 * @param live - live agent 状态；无 lastError 或未挂载时返回 null。
 * @param columns - 终端列数。
 * @returns 错误行纯文本；无错误 null。
 */
export function deriveGlanceError(live: LiveAgentState | undefined, columns: number): string | null {
  if (live?.lastError === undefined) return null
  const raw = live.lastError.error
  const message = raw instanceof Error ? raw.message : String(raw)
  const glyph = useAsciiGlyphs() ? 'x' : '✗'
  /* v8 ignore next -- split('\n') 恒返回非空数组，[0] 恒存在；noUncheckedIndexedAccess 收窄防御 */
  const firstLine = truncateToDisplayWidth(message.split('\n')[0] ?? '', columns - 2)
  return `${glyph} ${firstLine}`
}

/**
 * 整帧 glance 派生（状态行 + 错误行一次计算）。
 * @param statusText - WorkflowStatusLine.current；null = 无投影
 * @param live - live agent 状态；undefined = 未挂载
 * @param columns - 终端列数（错误首行截断度量）
 * @returns 状态行 + 错误行数据
 */
export function deriveGlance(
  statusText: string | null,
  live: LiveAgentState | undefined,
  columns: number,
): GlanceLine {
  return { status: deriveGlanceStatus(statusText, live), error: deriveGlanceError(live, columns) }
}

/**
 * 底部 glance 数据收集 + 刷新节流控制器。
 * renderLive 每帧调用 refresh() 后读 current()：窗口内读缓存（零重收集），
 * 窗口外同步重算——收集成本与渲染节奏解耦。
 */
export class MetricsGlanceController {
  private cache: GlanceLine
  private computed = false
  private lastComputeAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly throttleMs: number
  private readonly options: MetricsGlanceControllerOptions

  constructor(options: MetricsGlanceControllerOptions) {
    this.options = options
    this.throttleMs = options.throttleMs ?? 16
    // 构造安全默认：未挂载 glance（首次 refresh 前 current() 有效）。
    this.cache = deriveGlance(null, undefined, 80)
  }

  /**
   * 当前缓存的 glance 数据（renderLive 每帧读取；新鲜度 ≤ 节流窗口）。
   * @returns 最近一次重算的 glance 数据
   */
  current(): GlanceLine {
    return this.cache
  }

  /**
   * 请求刷新。首次恒同步重算；此后窗口内合并到窗口末、窗口外同步重算。
   * 数据实际变化时经 onChange 推送。
   */
  refresh(): void {
    if (this.timer !== null) return
    if (!this.computed) {
      this.compute()
      return
    }
    const wait = this.throttleMs - (Date.now() - this.lastComputeAt)
    if (wait <= 0) {
      this.compute()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.compute()
    }, wait)
    this.timer.unref()
  }

  /** 清空待执行定时器（幂等）。 */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private compute(): void {
    this.lastComputeAt = Date.now()
    const first = !this.computed
    const next = deriveGlance(
      this.options.getStatusText(),
      this.options.getLiveState(),
      this.options.getColumns(),
    )
    const changed = first || next.status !== this.cache.status || next.error !== this.cache.error
    this.cache = next
    this.computed = true
    if (changed) this.options.onChange?.(next)
  }
}
