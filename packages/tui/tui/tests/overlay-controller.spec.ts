/**
 * OverlayController — overlay 生命周期 + CPR suppress/resume 协调契约测试。
 *
 * - activate：进入 alt screen（ALT_SCREEN_ON + HIDE_CURSOR）、暂停主屏 CPR
 *   污染检测（suppressProbe）、渲染首帧；退出时恢复（resumeProbe）。
 * - 未注册 id 的 activate 是 no-op（false，零输出）。
 * - 切换 overlay：旧 overlay 先 deactivate（onDeactivate + 退出 alt screen）。
 *
 * 防回归根因：overlay 激活期间光标在 alt screen，CPR 响应不代表主屏 live region
 * ——不 suppress 会把「光标在 overlay 里」误判为主屏污染，触发主屏帧写进
 * alt screen（picker 残影泄漏回主会话）。
 */

import { describe, expect, it, vi } from 'vitest'
import type { WriteStream } from 'node:tty'
import { ANSI } from '../src/engine/ansi.js'
import { OverlayController } from '../src/engine/overlay-controller.js'
import type { OverlayRenderer } from '../src/engine/overlay-engine.js'

/** 最小 stdout 替身：只记录写入。 */
function makeStdout(): WriteStream & { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn() } as unknown as WriteStream & { write: ReturnType<typeof vi.fn> }
}

/** LiveEngine 污染检测替身（控制器只依赖 suppressProbe/resumeProbe）。 */
function makeLive() {
  return { suppressProbe: vi.fn(), resumeProbe: vi.fn() }
}

/** 记录渲染次数的 overlay 渲染器。 */
function makeRenderer(rows: string[] = ['overlay line']): OverlayRenderer & {
  renderCount: number
  onActivate: ReturnType<typeof vi.fn>
  onDeactivate: ReturnType<typeof vi.fn>
} {
  const renderer = {
    renderCount: 0,
    render: () => { renderer.renderCount++; return rows },
    onActivate: vi.fn(),
    onDeactivate: vi.fn(),
  } as unknown as OverlayRenderer & {
    renderCount: number
    onActivate: ReturnType<typeof vi.fn>
    onDeactivate: ReturnType<typeof vi.fn>
  }
  return renderer
}

function makeController(over: { onOverlayChange?: (active: boolean) => void } = {}) {
  const stdout = makeStdout()
  const live = makeLive()
  const onOverlayChange = over.onOverlayChange ?? vi.fn()
  const ctrl = new OverlayController({
    stdout,
    getSize: () => ({ cols: 80, rows: 24 }),
    live,
    onOverlayChange,
  })
  return { ctrl, stdout, live, onOverlayChange }
}

describe('activate / deactivate 生命周期', () => {
  it('activate 注册过的 overlay：进入 alt screen + suppressProbe + 渲染首帧', () => {
    const { ctrl, stdout, live, onOverlayChange } = makeController()
    const renderer = makeRenderer()
    ctrl.register('pager', renderer)
    const ok = ctrl.activate('pager')

    expect(ok).toBe(true)
    expect(stdout.write).toHaveBeenCalledWith(ANSI.ALT_SCREEN_ON)
    expect(stdout.write).toHaveBeenCalledWith(ANSI.HIDE_CURSOR)
    expect(live.suppressProbe).toHaveBeenCalledTimes(1)
    expect(live.resumeProbe).not.toHaveBeenCalled()
    expect(renderer.renderCount).toBeGreaterThanOrEqual(1)
    expect(onOverlayChange).toHaveBeenLastCalledWith(true)
    expect(ctrl.isActive()).toBe(true)
    expect(ctrl.activeId()).toBe('pager')
  })

  it('deactivate：退出 alt screen + resumeProbe + 回调 false', () => {
    const { ctrl, stdout, live, onOverlayChange } = makeController()
    ctrl.register('pager', makeRenderer())
    ctrl.activate('pager')
    ctrl.deactivate()

    expect(stdout.write).toHaveBeenCalledWith(ANSI.SHOW_CURSOR)
    expect(stdout.write).toHaveBeenCalledWith(ANSI.ALT_SCREEN_OFF)
    expect(live.resumeProbe).toHaveBeenCalledTimes(1)
    expect(onOverlayChange).toHaveBeenLastCalledWith(false)
    expect(ctrl.isActive()).toBe(false)
    expect(ctrl.activeId()).toBeNull()
  })

  it('activate 未注册 id：no-op，零输出、不碰 CPR', () => {
    const { ctrl, stdout, live } = makeController()
    const ok = ctrl.activate('ghost')
    expect(ok).toBe(false)
    expect(stdout.write).not.toHaveBeenCalled()
    expect(live.suppressProbe).not.toHaveBeenCalled()
    expect(ctrl.isActive()).toBe(false)
  })

  it('激活期间切换 overlay：旧 renderer onDeactivate，新 renderer 接管', () => {
    const { ctrl, live, onOverlayChange } = makeController()
    const first = makeRenderer(['first'])
    const second = makeRenderer(['second'])
    ctrl.register('a', first)
    ctrl.register('b', second)
    ctrl.activate('a')
    expect(first.onDeactivate).not.toHaveBeenCalled()
    ctrl.activate('b')
    expect(first.onDeactivate).toHaveBeenCalledTimes(1)
    expect(second.renderCount).toBeGreaterThanOrEqual(1)
    expect(ctrl.activeId()).toBe('b')
    // CPR 在整个 alt screen 会话内保持抑制
    expect(live.suppressProbe).toHaveBeenCalledTimes(1)
    expect(live.resumeProbe).not.toHaveBeenCalled()
    expect(onOverlayChange).toHaveBeenLastCalledWith(true)
  })

  it('rerender 重绘当前 overlay；无激活时 no-op', () => {
    const { ctrl } = makeController()
    const renderer = makeRenderer()
    ctrl.register('pager', renderer)
    ctrl.rerender()
    expect(renderer.renderCount).toBe(0)
    ctrl.activate('pager')
    const before = renderer.renderCount
    ctrl.rerender()
    expect(renderer.renderCount).toBeGreaterThan(before)
  })

  it('unregister 激活中的 overlay：先 deactivate（退出 alt screen + resumeProbe）', () => {
    const { ctrl, live, stdout } = makeController()
    ctrl.register('pager', makeRenderer())
    ctrl.activate('pager')
    ctrl.unregister('pager')
    expect(live.resumeProbe).toHaveBeenCalledTimes(1)
    expect(stdout.write).toHaveBeenCalledWith(ANSI.ALT_SCREEN_OFF)
    expect(ctrl.isActive()).toBe(false)
  })
})
