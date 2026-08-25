/**
 * C3 项 3：rewind overlay — 双阶段回退面板（用户检查点 → 回退粒度）。
 *
 * 阶段 1（list）：展示用户检查点（turn/text/seq），↑↓/j k 移动，Enter 选中目标。
 * 阶段 2（mode）：convo（仅截断会话）/ code（仅文件回退）/ both（两者）。
 * 执行回调由装配方提供（TuiApp.rewindSession 接 FileHistory + SessionStore）。
 * list 的 Esc/Ctrl+C 由装配方关闭；mode 的 Esc 回到 list。
 *
 * 数据源：装配方过滤后的用户检查点（TranscriptMessage：seq/turn/text）。
 */

import type { OverlayRenderer } from '../engine/overlay-engine.js'
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { getTheme } from '../theme.js'
import { truncateToDisplayWidth } from '../width.js'
import { formatElapsedHuman } from './spinner-status.js'

/** rewind 可回退的消息最小形状（transcript.view.messages 满足它）。 */
export interface RewindableMessage {
  readonly seq: number
  readonly turn: number
  /** 消息归属（用户/助手；时间线类型标记）。 */
  readonly kind: 'user' | 'assistant'
  /** Unix epoch 毫秒（相对时间显示）。 */
  readonly time: number
  readonly text: string
}

/** 回退粒度（对齐天枢 RewindMode 前 3 种）。 */
export type RewindMode = 'convo' | 'code' | 'both'

/** 回退执行结果（装配方回填，渲染到完成阶段）。 */
export interface RewindResult {
  filesChanged: number
  /** 截断到的 seq（convo/both 时）。 */
  truncatedTo?: number
  /** 因快照缺失未能回退的文件数（code/both 时；0 或缺省 = 无缺口）。 */
  filesSkipped?: number
  /** 执行失败时的错误信息（filesChanged = -1）。 */
  error?: string
}

/** 装配方在用户确认后执行回退；返回文件变更数。 */
export type RewindExecutor = (mode: RewindMode, atSeq: number) => Promise<RewindResult>

const MODE_LABELS: Record<RewindMode, string> = {
  convo: '只截断会话（保留文件）',
  code: '只回退文件（保留会话）',
  both: '会话 + 文件都回退',
}

const MODE_KEYS: ReadonlyArray<{ key: string; mode: RewindMode }> = [
  { key: '1', mode: 'convo' },
  { key: '2', mode: 'code' },
  { key: '3', mode: 'both' },
]

/** 双阶段回退面板：消息列表选目标 → 粒度选择 → 执行 → 结果展示（纯状态机 + 渲染，零 I/O）。 */
export class RewindOverlay implements OverlayRenderer {
  private messages: readonly RewindableMessage[] = []
  /** 阶段：list → mode → executing → done；null = 未激活。 */
  private phase: 'list' | 'mode' | 'executing' | 'done' | null = null
  private selected = 0
  private mode: RewindMode | null = null
  private result: RewindResult | null = null
  private readonly theme: RivetTheme
  private executor: RewindExecutor | null = null
  private readonly onSettled: (() => void) | null

  constructor(theme?: RivetTheme, options?: { onSettled?: () => void }) {
    this.theme = theme ?? getTheme()
    this.onSettled = options?.onSettled ?? null
  }

  /**
   * 装配方提供检查点快照 + 执行回调；重复设置重置状态。
   * @param messages - 用户检查点快照（过滤后的 transcript 行）。
   * @param executor - 用户确认后执行回退的回调。
   */
  setMessages(messages: readonly RewindableMessage[], executor: RewindExecutor): void {
    this.messages = messages
    this.executor = executor
    this.phase = 'list'
    this.selected = Math.max(0, messages.length - 1) // 默认选最后（最近的）消息
    this.mode = null
    this.result = null
  }

  /**
   * 当前选中的 seq；无消息返回 -1。
   * @returns 选中消息的 seq，或 -1。
   */
  selectedSeq(): number {
    const m = this.messages[this.selected]
    return m === undefined ? -1 : m.seq
  }

  /**
   * done 阶段（结果已显示，装配方应关闭 overlay）。
   * @returns 处于 done 阶段时 true。
   */
  isDone(): boolean {
    return this.phase === 'done'
  }

  /**
   * list 阶段由装配方对 Esc/Ctrl+C 直接关闭；mode 阶段 Esc 先回到 list。
   * @returns 处于 list 阶段时 true。
   */
  isListPhase(): boolean {
    return this.phase === 'list'
  }

  /**
   * 处理按键；返回 true 表示已消费。
   * @param name - 按键名（up/down/return/escape/ctrl_c 等）。
   * @param char - 可打印字符（j/k 移动，1/2/3 选粒度）。
   * @returns 已消费时 true（list 的 Esc/Ctrl+C 由装配方关闭；mode 的 Esc 回到 list）。
   */
  handleKey(name: string, char: string): boolean {
    if (this.phase === 'list') {
      if (name === 'up' || char === 'k') {
        this.selected = Math.max(0, this.selected - 1)
        return true
      }
      if (name === 'down' || char === 'j') {
        this.selected = Math.min(this.messages.length - 1, this.selected + 1)
        return true
      }
      if (name === 'return') {
        if (this.selectedSeq() >= 0) this.phase = 'mode'
        return true
      }
      return name === 'escape' || name === 'ctrl_c'
    }
    if (this.phase === 'mode') {
      if (char === '1' || char === '2' || char === '3') {
        // MODE_KEYS 覆盖 '1'/'2'/'3' 全部键；find 失败时降级为不执行（无崩溃）。
        this.mode = MODE_KEYS.find(k => k.key === char)?.mode ?? null
        void this.run()
        return true
      }
      if (name === 'escape') {
        this.phase = 'list'
        return true
      }
      return name === 'ctrl_c'
    }
    // done 阶段：任何键关闭（由装配方 deactivate）。
    return this.phase === 'done'
  }

  /** 执行回退（mode 阶段选中后）。 */
  private async run(): Promise<void> {
    const executor = this.executor
    const mode = this.mode
    const atSeq = this.selectedSeq()
    if (executor === null || mode === null || atSeq < 0) return
    this.phase = 'executing'
    try {
      this.result = await executor(mode, atSeq)
    } catch (error: unknown) {
      this.result = {
        filesChanged: -1,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.phase = 'done'
    // 执行是异步的：按键驱动的同步重绘只画得出 executing 帧；落到 done 时
    // 通知装配方补一帧，否则完成/失败页永不出现（渲染停在静止的执行帧）。
    try {
      this.onSettled?.()
    } catch {
      // 重绘回调是尽力而为：抛错不得打回已提交的 rewind 结果，也不得卡住 phase。
    }
  }

  render(width: number, height: number): string[] {
    if (this.phase === null) return []
    const theme = this.theme
    const title = color('⟲ rewind 回退', theme.secondary)
    const contentWidth = Math.max(1, width - 2)
    const bodyBudget = Math.max(0, height - 2)

    if (this.phase === 'list') {
      // 时间线（参考 Claude Code checkpoint 浏览器）：
      // - turn 变化时输出 dim 分隔线（回合边界可视化）
      // - 类型标记：用户 ❯ / 助手 ✦（语义色）
      // - 相对时间（如 3m 前）
      // - 滚动窗口跟随选中；先留出底栏提示行再切窗，避免 OverlayEngine 裁掉操作说明
      const body: string[] = []
      let selectedRow = 0
      let lastTurn = -1
      this.messages.forEach((m, i) => {
        if (m.turn !== lastTurn) {
          body.push(color(`── turn ${m.turn} ──`, theme.muted))
          lastTurn = m.turn
        }
        if (i === this.selected) selectedRow = body.length
        const isSel = i === this.selected
        const mark = m.kind === 'user' ? '❯' : '✦'
        const markColor = m.kind === 'user' ? theme.userColor : theme.assistantColor
        const age = formatElapsedHuman(Date.now() - m.time)
        const line = truncateToDisplayWidth(
          `${color(mark, markColor)} ${age} 前 ${m.text.replace(/\n/g, ' ')}`,
          contentWidth - 2,
        )
        body.push(isSel ? color(`▸ ${line}`, theme.success) : `  ${color(line, theme.dim)}`)
      })
      const start = windowStart(selectedRow, body.length, bodyBudget)
      return [
        title,
        ...body.slice(start, start + bodyBudget),
        color('↑↓/j k 选检查点 · Enter 选粒度 · Esc 取消', theme.muted),
      ]
    }

    if (this.phase === 'mode') {
      const body = [
        color(`回退到 seq ${this.selectedSeq()}，选择粒度：`, theme.primary),
        ...MODE_KEYS.map(({ key, mode }) => `  ${key}. ${MODE_LABELS[mode]}`),
      ]
      return [
        title,
        ...body.slice(0, bodyBudget),
        color('1/2/3 确认 · Esc 返回列表或取消', theme.muted),
      ]
    }

    if (this.phase === 'executing') {
      return [title, color('回退执行中…', theme.muted)]
    }

    // done
    const r = this.result
    const hint = color('任意键关闭', theme.muted)
    if (r === null) {
      return [title, color('回退已取消', theme.muted), hint]
    }
    if (r.filesChanged < 0) {
      return [title, color(`回退失败：${r.error ?? '未知错误'}`, theme.error), hint]
    }
    const skippedNote = r.filesSkipped !== undefined && r.filesSkipped > 0
      ? `（${r.filesSkipped} 个文件因快照缺失未回退）`
      : ''
    return [
      title,
      color(`回退完成：${r.filesChanged} 个文件${skippedNote}${r.truncatedTo === undefined ? '' : `，会话截断到 seq ${r.truncatedTo}`}`, theme.success),
      hint,
    ]
  }
}

/**
 * 把选中行留在 `budget` 行窗口内；窗口比内容短时贴底对齐选中行。
 * @param selectedRow - 选中行在完整 body 中的下标。
 * @param length - body 总行数。
 * @param budget - 可渲染行数。
 * @returns 窗口起点。
 */
function windowStart(selectedRow: number, length: number, budget: number): number {
  if (length <= budget) return 0
  const start = Math.max(0, selectedRow - budget + 1)
  return start + budget > length ? Math.max(0, length - budget) : start
}
