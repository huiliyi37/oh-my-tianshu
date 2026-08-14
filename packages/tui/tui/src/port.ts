/**
 * TUI 渲染引擎数据源端口 — 天枢 agent 状态模型（cockpit/state、activity-store
 * 等）在移植时被移除；渲染引擎纯展示、无 agent 逻辑，所有数据经本端口注入。
 * 源出 .rivet/tui-source/tui/engine/app.ts 中 TuiApp 与 agent 层的耦合面
 * （Apache-2.0 来源），本包以接口形式重建接缝，供未来 app 层对接。
 *
 * @module @huiliyi37/dsh-tianshu-tui
 */

/** 会话运行状态（纯展示视图，不含 agent 内部模型）。 */
export interface SessionStatusView {
  /** 当前是否处于 agent 运行中（影响 Ctrl+C / ESC 等键路由）。 */
  isAgentActive: boolean
  /** 是否处于思考（thinking）阶段。 */
  isThinking: boolean
  /** 最近一条助手消息是否已开始输出。 */
  assistantStarted: boolean
}

/** 输入提示区状态（注入给 InputController / InputLine 的数据源）。 */
export interface InputPort {
  /** 可用的 slash 命令提示（Tab 补全目标）；由宿主注入，本包不实现命令。 */
  slashCommands: readonly { name: string; description: string; argsHint?: string }[]
}

/**
 * TUI 渲染引擎端口 — 引擎与宿主（agent loop）之间的注入边界。
 * 宿主实现本接口并提供数据；引擎只做展示与输入路由，不感知 agent 模型。
 */
export interface TuiPort {
  /** 读取当前会话状态。 */
  getSessionStatus(): SessionStatusView
  /** 输入端口。 */
  input: InputPort
}
