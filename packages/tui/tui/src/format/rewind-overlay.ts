/**
 * C3 项 3：rewind overlay — 双阶段回退面板（消息列表 → 回退粒度）。
 *
 * 阶段 1（list）：展示会话消息（turn/text/seq），↑↓/j k 移动，Enter 选中目标。
 * 阶段 2（mode）：convo（仅截断会话）/ code（仅文件回退）/ both（两者）。
 * 执行回调由装配方提供（TuiApp.rewindSession 接 FileHistory + SessionStore）。
 *
 * 数据源：transcript.view.messages（TranscriptMessage：seq/turn/text）。
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

  constructor(theme?: RivetTheme) {
    this.theme = theme ?? getTheme()
  }

  /**
   * 装配方提供消息快照 + 执行回调；重复设置重置状态。
   * @param messages - 会话消息快照（transcript.view.messages）。
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
   * 处理按键；返回 true 表示已消费。
   * @param name - 按键名（up/down/return/escape/ctrl_c 等）。
   * @param char - 可打印字符（j/k 移动，1/2/3 选粒度）。
   * @returns 已消费时 true（Esc/Ctrl+C 由装配方关闭 overlay）。
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
      return name === 'escape' || name === 'ctrl_c'
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
  }

  render(width: number, height: number): string[] {
    if (this.phase === null) return []
    const theme = this.theme
    const rows: string[] = [color('⟲ rewind 回退', theme.secondary)]
    const contentWidth = Math.max(1, width - 2)
    const bodyHeight = Math.max(1, height - 3)

    if (this.phase === 'list') {
      // 时间线（参考 Claude Code checkpoint 浏览器）：
      // - turn 变化时输出 dim 分隔线（回合边界可视化）
      // - 类型标记：用户 ❯ / 助手 ✦（语义色）
      // - 相对时间（如 3m 前）
      // - 滚动窗口跟随选中（可滚到更早消息，此前固定渲染末尾 N 条）
      const sel = Math.max(0, Math.min(this.selected, this.messages.length - 1))
      const start = Math.max(0, sel - bodyHeight + 1)
      const window = this.messages.slice(start, start + bodyHeight)
      let lastTurn = -1
      window.forEach((m, i) => {
        const idx = start + i
        const isSel = idx === this.selected
        // turn 分隔线（换 turn 时插入，紧跟在前一行后）
        if (m.turn !== lastTurn) {
          rows.push(color(`── turn ${m.turn} ──`, theme.muted))
          lastTurn = m.turn
        }
        const mark = m.kind === 'user' ? '❯' : '✦'
        const markColor = m.kind === 'user' ? theme.userColor : theme.assistantColor
        const age = formatElapsedHuman(Date.now() - m.time)
        const line = truncateToDisplayWidth(
          `${color(mark, markColor)} ${age} 前 ${m.text.replace(/\n/g, ' ')}`,
          contentWidth - 2,
        )
        rows.push(isSel ? color(`▸ ${line}`, theme.success) : `  ${color(line, theme.dim)}`)
      })
      rows.push(color('↑↓/j k 选择 · Enter 回退到此处 · Esc 取消', theme.muted))
      return rows
    }

    if (this.phase === 'mode') {
      rows.push(color(`回退到 seq ${this.selectedSeq()}，选择粒度：`, theme.primary))
      MODE_KEYS.forEach(({ key, mode }) => {
        rows.push(`  ${key}. ${MODE_LABELS[mode]}`)
      })
      rows.push(color('Esc 取消', theme.muted))
      return rows
    }

    if (this.phase === 'executing') {
      rows.push(color('回退执行中…', theme.muted))
      return rows
    }

    // done
    const r = this.result
    if (r === null) {
      rows.push(color('回退已取消', theme.muted))
      return rows
    }
    if (r.filesChanged < 0) {
      rows.push(color(`回退失败：${r.error ?? '未知错误'}`, theme.error))
    } else {
      const skippedNote = r.filesSkipped !== undefined && r.filesSkipped > 0
        ? `（${r.filesSkipped} 个文件因快照缺失未回退）`
        : ''
      rows.push(color(`回退完成：${r.filesChanged} 个文件${skippedNote}${r.truncatedTo === undefined ? '' : `，会话截断到 seq ${r.truncatedTo}`}`, theme.success))
    }
    rows.push(color('任意键关闭', theme.muted))
    return rows
  }
}
