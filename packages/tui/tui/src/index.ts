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
import { TuiApp } from './ui/app.ts'

/** Stable Cordis plugin name the bundle patch inserts. */
export const name = 'tui-runner'

/** 装配选项：流与起始会话可注入（测试替身），缺省走 process 全局流。 */
export interface TuiRunnerConfig {
  /** 键盘输入流；缺省 process.stdin。 */
  stdin?: ReadStream
  /** 渲染输出流；缺省 process.stdout。 */
  stdout?: WriteStream
  /** 启动即切入的会话 id；缺省新建会话。 */
  initialSessionId?: SessionId
  /** 外部编辑器触发键（Phase 6.4）；缺省 ctrl_e（ctrl+o 已恢复为推理展开）。 */
  editorKey?: KeyName
  /** 是否启用 Vim 键位（Phase 6.5）；缺省 false。 */
  vimEnabled?: boolean
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
    // 走同一 async dispose 路径——teardown await flushAll，退出不丢会话数据。
    // teardown 依赖 app、onExit 依赖 teardown：闭包延迟求值打破循环引用。
    const teardown = async (): Promise<void> => { await app.dispose() }
    const onSigint = (): void => { void teardown() }
    const app = new TuiApp({
      ctx: runtimeCtx,
      stdin,
      stdout,
      onExit: () => { void teardown() },
      ...(config.initialSessionId === undefined ? {} : { initialSessionId: config.initialSessionId }),
      ...(config.editorKey === undefined ? {} : { editorKey: config.editorKey }),
      ...(config.vimEnabled === undefined ? {} : { vimEnabled: config.vimEnabled }),
      ...(config.vision === undefined ? {} : { vision: config.vision }),
      ...(config.workflowHistoryLimit === undefined ? {} : { workflowHistoryLimit: config.workflowHistoryLimit }),
    })
    stdin.on('SIGINT', onSigint)
    ctx.effect(() => () => {
      stdin.off('SIGINT', onSigint)
      return teardown()
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
