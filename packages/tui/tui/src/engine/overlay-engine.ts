/**
 * T9 OverlayEngine — 管理全屏覆盖层的 alternate screen buffer 切换。
 *
 * 核心机制：
 * - 进入 overlay 时：`\x1B[?1049h` 切换到 alternate screen buffer
 * - overlay 内：全屏逐行渲染，用 `cursorTo(1,1)` 定位到顶部
 * - 退出 overlay 时：`\x1B[?1049l` 恢复主屏，scrollback 完整无损
 *
 * Surface 路由逻辑复用现有的 `src/tui/surface/router.ts`（纯逻辑，零依赖）。
 * OverlayEngine 只负责终端 buffer 切换和渲染调度。
 *
 * 支持的 overlay 类型（对应现有 Surface）：
 * - Starmap (星图) — 星君/星域总览
 * - Cockpit (座舱) — 运行时状态仪表盘
 * - Chronicle (编年史) — 会话回放
 * - Pager — 分页查看器
 * - CommandPalette — 命令面板
 */

import type { WriteStream } from 'node:tty'
import { ANSI, cursorTo } from './ansi.js'

/** overlay 标识。内置名之外允许任意字符串（扩展 overlay）。 */
export type OverlayId = string

/** overlay 渲染器：全屏内容生产 + 激活/失活生命周期钩子。 */
export interface OverlayRenderer {
  /** 渲染 overlay 内容。返回 ANSI 格式化后的行数组。 */
  render(width: number, height: number): string[]
  /** overlay 激活时的回调 */
  onActivate?(): void
  /** overlay 失活时的回调 */
  onDeactivate?(): void
}

/** OverlayEngine 构造参数。 */
export interface OverlayEngineOptions {
  stdout: WriteStream
  /** 当前终端尺寸获取函数（每次渲染时调用） */
  getSize: () => { cols: number; rows: number }
  /** 进入 alt screen（overlay 激活）时触发——调用方据此暂停主屏污染检测。 */
  onEnterAltScreen?: () => void
  /** 退出 alt screen（overlay 关闭）时触发——调用方据此恢复主屏污染检测。 */
  onExitAltScreen?: () => void
}

/**
 * 全屏覆盖层引擎：管理 alternate screen buffer 的进出与 overlay 渲染调度
 * （固定网格行级 diff + CSI 2026 原子刷新）。退出后主屏 scrollback 完整无损。
 */
export class OverlayEngine {
  private stdout: WriteStream
  private getSize: () => { cols: number; rows: number }
  private onEnterAltScreen?: () => void
  private onExitAltScreen?: () => void
  private active: OverlayId | null = null
  private renderers = new Map<OverlayId, OverlayRenderer>()
  private inAltScreen = false
  /** 上一帧屏上每行内容（权威缓存），用于行级 diff。空 = 需全量重绘。 */
  private lastFrame: string[] = []
  private lastCols = 0
  private lastRows = 0

  constructor(options: OverlayEngineOptions) {
    this.stdout = options.stdout
    this.getSize = options.getSize
    if (options.onEnterAltScreen !== undefined) this.onEnterAltScreen = options.onEnterAltScreen
    if (options.onExitAltScreen !== undefined) this.onExitAltScreen = options.onExitAltScreen
  }

  /**
   * 注册一个 overlay 渲染器。
   * 通常在模块初始化时调用。
   * @param id - overlay 标识（同名注册覆盖旧渲染器）
   * @param renderer - 该 overlay 的渲染器
   */
  register(id: OverlayId, renderer: OverlayRenderer): void {
    this.renderers.set(id, renderer)
  }

  /**
   * 取消注册；若该 overlay 正活跃，先停用（退出 alt screen）。
   * @param id - 要移除的 overlay 标识
   */
  unregister(id: OverlayId): void {
    if (this.active === id) {
      this.deactivate()
    }
    this.renderers.delete(id)
  }

  /**
   * 激活指定 overlay。
   * - 如果已有活跃 overlay，先停用旧的再激活新的（切换不退出 alt screen）。
   * - 自动进入 alternate screen buffer。
   * @param id - 要激活的 overlay 标识
   * @returns 激活成功为 true；id 未注册时为 false（不改变当前状态）
   */
  activate(id: OverlayId): boolean {
    const renderer = this.renderers.get(id)
    if (!renderer) return false

    // 停用当前 overlay：切换（激活期间换 renderer）不退出 alt screen——
    // CPR 抑制在整个 alt screen 会话内保持；完整退出走 deactivate()。
    if (this.active !== null) {
      const prev = this.renderers.get(this.active)
      prev?.onDeactivate?.()
      this.active = null
      this.resetFrameCache()
    }

    this.active = id
    this.enterAltScreen()
    // 进入 alt screen 后缓存作废 → 首帧全量重绘。
    this.resetFrameCache()
    renderer.onActivate?.()
    this.render()
    return true
  }

  /** 停用当前活跃的 overlay，恢复主屏。 */
  deactivate(): void {
    if (this.active === null) return
    this.deactivateInternal()
  }

  /** 重新渲染当前 overlay（如 resize 后）。 */
  rerender(): void {
    if (this.active === null) return
    this.render()
  }

  /**
   * 当前是否在 overlay 中。
   * @returns 有活跃 overlay 时为 true
   */
  isActive(): boolean {
    return this.active !== null
  }

  /**
   * 当前活跃的 overlay ID。
   * @returns 活跃 overlay 标识；无活跃 overlay 时为 null
   */
  activeId(): OverlayId | null {
    return this.active
  }

  // ── internal ─────────────────────────────────────────────────

  private enterAltScreen(): void {
    if (this.inAltScreen) return
    this.stdout.write(ANSI.ALT_SCREEN_ON)
    this.stdout.write(ANSI.HIDE_CURSOR)
    this.inAltScreen = true
    // 通知调用方：已进入 alt screen，主屏 live region 的光标位置/污染检测应暂停，
    // 否则 CPR 探针会把"光标在 overlay 里"误判为主屏污染，触发 renderLive 把
    // 主屏帧写进 alt screen（picker 残影泄漏回主会话的根因）。
    this.onEnterAltScreen?.()
  }

  private exitAltScreen(): void {
    if (!this.inAltScreen) return
    this.stdout.write(ANSI.SHOW_CURSOR)
    this.stdout.write(ANSI.ALT_SCREEN_OFF)
    this.inAltScreen = false
    // 通知调用方：已退出 alt screen 回到主屏，恢复污染检测。
    this.onExitAltScreen?.()
  }

  private deactivateInternal(): void {
    const id = this.active
    if (id === null) return
    const renderer = this.renderers.get(id)
    renderer?.onDeactivate?.()
    this.active = null
    this.resetFrameCache()
    this.exitAltScreen()
  }

  private resetFrameCache(): void {
    this.lastFrame = []
    this.lastCols = 0
    this.lastRows = 0
  }

  private render(): void {
    const activeId = this.active
    if (activeId === null) return
    const renderer = this.renderers.get(activeId)
    if (!renderer) return

    const { cols, rows } = this.getSize()
    const lines = renderer.render(cols, rows)

    // 目标帧：定长 rows，超出内容行的位置补空串（与全屏擦除语义一致）。
    const desired: string[] = new Array<string>(rows)
    for (let i = 0; i < rows; i++) {
      const line = lines[i]
      desired[i] = i < lines.length && line !== undefined ? line : ''
    }

    // 首帧 / 尺寸变化 / 缓存作废 → 全量重绘（从 (1,1) 逐行擦除+写入）。
    const cacheValid =
      this.lastFrame.length === rows && cols === this.lastCols && rows === this.lastRows
    let body: string
    if (!cacheValid) {
      let out = cursorTo(1, 1)
      for (let i = 0; i < rows; i++) {
        out += ANSI.ERASE_LINE + (desired[i] ?? '')
        if (i < rows - 1) out += '\n'
      }
      body = out
    } else {
      // 行级 diff：只重写变化的行。alt screen 是固定网格（不滚动），
      // 绝对定位 cursorTo(row,1) 安全，未变行直接跳过 → 少擦写、少闪。
      let out = ''
      for (let i = 0; i < rows; i++) {
        if (desired[i] === this.lastFrame[i]) continue
        out += cursorTo(i + 1, 1) + ANSI.ERASE_LINE + (desired[i] ?? '')
      }
      body = out
    }

    this.lastFrame = desired
    this.lastCols = cols
    this.lastRows = rows

    // 无变化短路：diff 为空则不写（idle/无操作时零输出）。
    if (body.length === 0) return
    // 整帧用 CSI 2026 同步输出包裹，原子刷新——overlay 导航（翻页/回溯）时
    // 逐行擦写不再撕裂/闪烁。
    this.stdout.write(ANSI.BEGIN_SYNC + body + ANSI.END_SYNC)
  }
}
