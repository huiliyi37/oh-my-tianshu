/**
 * OverlayController — overlay 生命周期 + CPR suppress/resume 协调。
 *
 * 直通 OverlayEngine 的 register/unregister/activate/deactivate/rerender；
 * 在进入/退出 alt screen 时自动调用 LiveEngine 的 suppressProbe()/resumeProbe()，
 * 把「overlay 激活期间暂停主屏污染检测」这一协调固化在装配点，调用方不会忘记。
 * 不暂停则 CPR 探针会把「光标在 overlay 里」误判为主屏污染，触发 renderLive
 * 把主屏帧写进 alt screen（picker 残影泄漏回主会话的根因）。
 *
 * 无 overlay 注册时零输出，不改变主屏行为——只是把未来 overlay 的生命周期
 * 与 CPR 协调收敛到单一装配点。
 *
 * @module @huiliyi37/dsh-tianshu-tui/engine/overlay-controller
 */

import type { WriteStream } from 'node:tty'
import { OverlayEngine, type OverlayId, type OverlayRenderer } from './overlay-engine.js'
import type { LiveEngine } from './live-engine.js'

/** OverlayController 构造参数。 */
export interface OverlayControllerOptions {
  stdout: WriteStream
  /** 当前终端尺寸获取函数（每次渲染时调用）。 */
  getSize: () => { cols: number; rows: number }
  /** LiveEngine：overlay 激活（alt screen）期间暂停 CPR 污染检测，退出时恢复。 */
  live: Pick<LiveEngine, 'suppressProbe' | 'resumeProbe'>
  /** overlay 激活/退出回调（供上层暂停 live 渲染/ticker 等）。 */
  onOverlayChange?: (active: boolean) => void
}

/**
 * overlay 生命周期协调器：直通 OverlayEngine，并在进入/退出 alt screen 时
 * 自动暂停/恢复 LiveEngine 的 CPR 污染检测（防主屏帧写进 alt screen）。
 */
export class OverlayController {
  private readonly engine: OverlayEngine

  constructor(options: OverlayControllerOptions) {
    this.engine = new OverlayEngine({
      stdout: options.stdout,
      getSize: options.getSize,
      onEnterAltScreen: () => {
        options.live.suppressProbe()
        options.onOverlayChange?.(true)
      },
      onExitAltScreen: () => {
        options.live.resumeProbe()
        options.onOverlayChange?.(false)
      },
    })
  }

  /**
   * 注册一个 overlay 渲染器（通常模块初始化时调用）。
   * @param id - overlay 标识
   * @param renderer - 该 overlay 的渲染器
   */
  register(id: OverlayId, renderer: OverlayRenderer): void {
    this.engine.register(id, renderer)
  }

  /**
   * 取消注册；若该 overlay 正活跃，先停用。
   * @param id - 要移除的 overlay 标识
   */
  unregister(id: OverlayId): void {
    this.engine.unregister(id)
  }

  /**
   * 激活指定 overlay（自动进入 alt screen 并暂停主屏污染检测）。
   * @param id - 要激活的 overlay 标识
   * @returns 激活成功为 true；id 未注册时为 false
   */
  activate(id: OverlayId): boolean {
    return this.engine.activate(id)
  }

  /** 停用当前活跃 overlay，恢复主屏并恢复污染检测。 */
  deactivate(): void {
    this.engine.deactivate()
  }

  /** 重新渲染当前 overlay（如 resize 后）。 */
  rerender(): void {
    this.engine.rerender()
  }

  /**
   * 当前是否在 overlay 中。
   * @returns 有活跃 overlay 时为 true
   */
  isActive(): boolean {
    return this.engine.isActive()
  }

  /**
   * 当前活跃的 overlay ID。
   * @returns 活跃 overlay 标识；无活跃 overlay 时为 null
   */
  activeId(): OverlayId | null {
    return this.engine.activeId()
  }
}
