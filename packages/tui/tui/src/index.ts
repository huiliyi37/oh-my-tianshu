/**
 * @huiliyi37/dsh-tui — interactive terminal UI profile bundle. The bundle
 * patch rides over dsh-base and inserts this runner under the stable
 * `tui-runner` id. Render core: the terminal rendering engine ported from
 * `.rivet/tui-source/tui/` (Apache-2.0 source; see SOURCE-MAP.md for the
 * per-file mapping). The engine is pure presentation — all agent state arrives
 * via {@link TuiPort}.
 *
 * @module @huiliyi37/dsh-tui
 */

import type { Context } from '@huiliyi37/cordis'
import type { ReadStream, WriteStream } from 'node:tty'
import type { SessionId } from '@huiliyi37/dsh-session'
import type { KeyName } from './engine/input-handler.ts'
import { WELCOME_MASCOTS, type WelcomeMascot } from './format/welcome-mascots.ts'
import { spawnSelfRestart } from './restart.ts'
import { TuiApp, type WelcomeAnimationMode } from './ui/app.ts'

/** Stable Cordis plugin name the bundle patch inserts. */
export const name = 'tui-runner'

/** 装配选项：流与起始会话可注入（测试替身），缺省走 process 全局流。 */
export interface TuiRunnerConfig {
  /** 键盘输入流；缺省 process.stdin。 */
  stdin?: ReadStream
  /** 渲染输出流；缺省 process.stdout。 */
  stdout?: WriteStream
  /** 启动即切入的会话 id；缺省恢复最近 live 会话（live store 为空才新建）。 */
  initialSessionId?: SessionId
  /** 外部编辑器触发键（Phase 6.4）；缺省 ctrl_e（ctrl+o 已恢复为推理展开）。 */
  editorKey?: KeyName
  /** 是否启用 Vim 键位（Phase 6.5）；缺省 false。 */
  vimEnabled?: boolean
  /** 欢迎策略；`auto` 与 `off` 都立即提交静态吉祥物终态。 */
  welcomeAnimation?: WelcomeAnimationMode
  /** 欢迎页吉祥物（部署级缺省；用户 /welcome 偏好覆盖之；缺省 whale）。 */
  welcomeMascot?: WelcomeMascot
  /** 主控模型的识图能力与视觉桥状态（图片附件气泡提示数据源）。 */
  vision?: {
    /** 主控模型是否原生支持识图（图片直发）。 */
    supportsVision?: boolean
    /** 是否配置了独立识图桥模型（主控不识图时经桥转文字描述）。
     *  未传入时按宿主 `visionBridge` 服务（dsh-vision-bridge 装配时应 provide）
     *  的存在性自动探测。 */
    bridgeEnabled?: boolean
    /** 识图桥来源（configured=显式配置 / auto=自动选用）。 */
    bridgeSource?: 'configured' | 'auto' | 'none'
  }
  /** 已结算 workflow run 缓存条数上限（/workflow 面板历史），超限 drop-oldest；正整数，缺省 50。 */
  workflowHistoryLimit?: number
  /** LSP 诊断桥（本地语言服务）：懒启动——agent 触碰文件时拉取该文件诊断。
   *  诊断只进 TUI 本地展示缓存（工具卡徽标 + /lsp 面板），不写会话事件、
   *  不注册任何模型面。缺省启用。 */
  lsp?: {
    /** 是否启用诊断拉取；缺省 true。 */
    enabled?: boolean
    /** 单次诊断拉取超时（毫秒）；缺省 2000。 */
    timeoutMs?: number
  }
  /** 统一活动带：活跃 item 行数封顶（正整数；超限折叠 +N 尾行）；缺省 5。 */
  activityBandMaxRows?: number
  /** 统一活动带开关；false 回退旧散行渲染（逃生门）；缺省 true。 */
  activityBand?: boolean
}

/**
 * Mount the terminal UI runner.
 * @param ctx - plugin context; the render core wires its services here.
 * @param config - stream injection and starting session (defaults to process).
 */
export function apply(ctx: Context, config: TuiRunnerConfig = {}): void {
  // 配置边界校验（cordis.yml 值在此进入）：misconfiguration fails loud at load。
  if (config.workflowHistoryLimit !== undefined
    && (!Number.isInteger(config.workflowHistoryLimit) || config.workflowHistoryLimit <= 0)) {
    throw new Error(`[tui-runner] workflowHistoryLimit must be a positive integer, got ${config.workflowHistoryLimit}`)
  }
  if (config.activityBandMaxRows !== undefined
    && (!Number.isInteger(config.activityBandMaxRows) || config.activityBandMaxRows <= 0)) {
    throw new Error(`[tui-runner] activityBandMaxRows must be a positive integer, got ${config.activityBandMaxRows}`)
  }
  const welcomeAnimation: unknown = config.welcomeAnimation
  if (welcomeAnimation !== undefined
    && welcomeAnimation !== 'auto'
    && welcomeAnimation !== 'off') {
    const received = typeof welcomeAnimation === 'string'
      ? welcomeAnimation
      : `<${welcomeAnimation === null ? 'null' : typeof welcomeAnimation}>`
    throw new Error(`[tui-runner] welcomeAnimation must be "auto" or "off", got ${received}`)
  }
  const welcomeMascot: unknown = config.welcomeMascot
  if (welcomeMascot !== undefined
    && !(WELCOME_MASCOTS as readonly string[]).includes(welcomeMascot as string)) {
    const received = typeof welcomeMascot === 'string'
      ? welcomeMascot
      : `<${welcomeMascot === null ? 'null' : typeof welcomeMascot}>`
    throw new Error(`[tui-runner] welcomeMascot must be "whale" or "fox", got ${received}`)
  }
  const stdin = config.stdin ?? process.stdin
  const stdout = config.stdout ?? process.stdout
  // 服务隔离：sessions/agents/agentDefaultModel 是注入属性，访问前必须
  // 声明依赖（Cordis 4 注入语义，未声明访问抛 "without inject"；web-app 同款
  // 模式）。goals/subagents 为可选服务、不进 inject：Cordis inject 要求全部
  // 服务可用才执行回调，缺 goal/subagent 插件时 tui-runner 会静默永不激活
  //（无报错、无 TUI，比降级更糟）。一律经 reflect.get 读取，/goal 命令与
  // 委派树在服务缺失时报不可用/面板降级（fails loud），但不阻塞装配。
  // 装配与 attach 在注入作用域内执行；生命周期仍注册在外层插件 ctx（随插件卸载）。
  ctx.inject(['sessions', 'agents', 'agentDefaultModel'], (runtimeCtx) => {
    // 退出生命周期：stdin SIGINT、Ctrl+C 空输入（onExit）与插件卸载（effect cleanup）
    // 走同一 async dispose 路径——teardown await flushAll（+ 恢复终端），退出不丢会话数据。
    // 用户主动退出（Ctrl+Q / /exit / SIGINT）在 dispose 之后还要让宿主进程退出——
    // 否则 InputHandler 已 pause stdin、TUI 仍占着 TTY，shell 收不回输入（#22）。
    // 插件卸载只 dispose，把进程生命周期留给宿主。teardown 依赖 app、onExit 依赖
    // teardown：闭包延迟求值打破循环引用。
    const requestHostExit = (): void => {
      const exit = runtimeCtx.reflect.get('appExit', false) as ((code?: number) => void) | undefined
      if (typeof exit === 'function') exit(0)
      else process.exit(0)
    }
    const teardown = async (quit: boolean, restart = false): Promise<void> => {
      await app.dispose()
      if (restart) {
        // 重启：dispose（恢复终端）后以相同命令行 spawn 新进程，成功即退出当前进程。
        // 新进程 stdio inherit 同一 TTY（POSIX detached 防 SIGHUP/SIGTTIN）。
        const ok = await spawnSelfRestart()
        if (!ok) {
          console.error('[tui-runner] 重启失败：无法重新启动当前命令，请手动运行启动命令')
        }
        requestHostExit()
        return
      }
      if (quit) requestHostExit()
    }
    let lastSigintAt = 0
    const onSigint = (): void => {
      // Windows 控制台（PowerShell/conhost）下 Ctrl+C 可能同时产生 0x03 字节
      // 与 SIGINT 信号：0x03 已走 handleAbort（打断），紧随的 SIGINT 若直接
      // teardown 会把刚打断的 TUI 拆掉（输入框消失、进程存活）——800ms 内已有
      // ctrl_c 字节处理则忽略 SIGINT（shouldDeferSigint）。SIGINT 自身去重兜底
      // （process + stdin 双注册时同一信号只处理一次）。
      const now = Date.now()
      if (app.shouldDeferSigint(now)) return
      if (now - lastSigintAt < 500) return
      lastSigintAt = now
      void teardown(true)
    }
    // SIGINT 双注册：Windows 上 stdin 流对 SIGINT 的转发不可靠，process 级
    // 注册（POSIX/Windows 均可靠）为双保险；stdin 级保留（与既有测试/语义兼容）。
    process.on('SIGINT', onSigint)
    const app = new TuiApp({
      ctx: runtimeCtx,
      stdin,
      stdout,
      onExit: () => { void teardown(true) },
      onRestart: () => { void teardown(true, true) },
      ...(config.initialSessionId === undefined ? {} : { initialSessionId: config.initialSessionId }),
      ...(config.editorKey === undefined ? {} : { editorKey: config.editorKey }),
      ...(config.vimEnabled === undefined ? {} : { vimEnabled: config.vimEnabled }),
      welcomeAnimation: config.welcomeAnimation ?? 'auto',
      ...(config.welcomeMascot === undefined ? {} : { welcomeMascot: config.welcomeMascot }),
      ...(config.vision === undefined ? {} : { vision: config.vision }),
      ...(config.workflowHistoryLimit === undefined ? {} : { workflowHistoryLimit: config.workflowHistoryLimit }),
      ...(config.lsp === undefined ? {} : { lsp: config.lsp }),
      ...(config.activityBandMaxRows === undefined ? {} : { activityBandMaxRows: config.activityBandMaxRows }),
      ...(config.activityBand === undefined ? {} : { activityBand: config.activityBand }),
    })
    stdin.on('SIGINT', onSigint)
    // 兜底：任何异常退出路径都恢复终端（raw mode off）——本体（opencode-tui）
    // 同款 best-effort。防止异常跳过 dispose 时残留 raw mode（终端乱/输入框不可见）。
    // exit 时进程将结束，handler 无需卸载。
    process.on('exit', () => {
      try { if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false) } catch { /* best-effort */ }
    })
    ctx.effect(() => () => {
      stdin.off('SIGINT', onSigint)
      process.off('SIGINT', onSigint)
      return teardown(false)
    })
    void app.attach().catch((err: unknown) => {
      // attach 失败：恢复终端（dispose 幂等）后上报，避免半初始化终端残留。
      void app.dispose().finally(() => { console.error('[tui-runner] attach failed:', err) })
    })
  })
}

// —— 渲染核心导出（纯展示，无 agent 逻辑）——

export * from './engine/ansi.js'
export * from './engine/write-batcher.js'
export * from './engine/resize-handler.js'
export * from './engine/overlay-engine.js'
export * from './engine/commit-engine.js'
export * from './engine/input-handler.js'
export * from './engine/input-line.js'
export * from './engine/input-controller.js'
export * from './commands/registry.js'
export * from './engine/live-engine.js'
export * from './engine/perf-monitor.js'
export * from './engine/image-tool.js'
export * from './engine/image-attach.js'
export * from './engine/term-image.js'
export * from './engine/stream-renderer.js'

export * from './term-caps.js'
export * from './theme-palettes.js'
export * from './theme.js'
export * from './theme-detect.js'
export * from './theme-custom.js'
export * from './box-chars.js'
export * from './braille-spinner.js'
export * from './width.js'
export * from './stream-window.js'
export * from './block-stream-writer.js'
export * from './scrollback-transcript.js'
export * from './truncation-marker.js'
export * from './statusline.js'
export * from './gutter.js'
export * from './ring-buffer.js'
export * from './live-tail-cap.js'
export * from './ui-glyphs.js'

export * from './port.js'
