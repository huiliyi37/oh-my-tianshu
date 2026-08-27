/**
 * T9 CommitEngine — 将已确定的格式化内容写入终端 scrollback。
 *
 * 核心原则：
 * - 只做 append-only `stdout.write()`，不跟踪已写入内容的位置。
 * - 进入 scrollback 的内容不可被擦除、不可被重绘。
 * - 替代 Ink 的 `<Static>` 组件语义，但无需 high-water index 追踪。
 *
 * 与现有的 `committed-log.ts` 的关系：
 * - `committed-log.ts` 作为数据层保留（LogEntry 存储 + dedup），
 *   CommitEngine 是其消费端——将 LogEntry 格式化后写入 stdout。
 * - 阶段 1 会提取格式化函数，届时 CommitEngine 调用这些函数。
 */

import type { WriteStream } from 'node:tty'
import { ANSI } from './ansi.js'
import { createRingBuffer, type RingBuffer } from '../ring-buffer.js'

/** Scrollback buffer 默认行数上限（长会话防内存无限增长）。 */
const DEFAULT_SCROLLBACK_MAX_LINES = 1000

/** 一条待提交进 scrollback 的条目。ansi 优先于 text 作为写入内容。 */
export interface CommittedEntry {
  /** 原始文本内容（不含 ANSI 序列） */
  text: string
  /** 可选：已格式化的 ANSI 字符串。如果提供，直接使用此值。 */
  ansi?: string
  /** 可选：在条目后追加一个空行作为分隔 */
  trailingNewline?: boolean
}

/** CommitEngine 构造参数。 */
export interface CommitEngineOptions {
  stdout: WriteStream
  /** 是否在每次 write 后立即 drain */
  flush?: boolean
  /** Scrollback buffer 行数上限（超出后丢弃最旧条目）。默认 1000。 */
  scrollbackMaxLines?: number
}

/**
 * append-only 提交引擎：把已确定内容写入终端 scrollback，同时在内存
 * RingBuffer 里保留最近 N 行供 pager overlay 读取。写入后不可擦除、不可重绘。
 */
export class CommitEngine {
  private stdout: WriteStream
  private flush: boolean
  /**
   * Scrollback buffer: 累积所有已提交文本，供 pager overlay 读取。
   * 使用 RingBuffer 封顶——长会话下无界 string[] 会持续增长，
   * 超过上限后最旧条目被自动丢弃（保留最近的，匹配 pager 实际可见范围）。
   */
  private buffer: RingBuffer<string>
  /** Scrollback buffer 行数上限（capacity/isFull 的数据源）。 */
  private readonly cap: number

  constructor(options: CommitEngineOptions) {
    this.stdout = options.stdout
    this.flush = options.flush ?? false
    const cap = options.scrollbackMaxLines ?? DEFAULT_SCROLLBACK_MAX_LINES
    this.cap = Math.max(1, cap)
    this.buffer = createRingBuffer<string>(this.cap)
  }

  /**
   * Scrollback 缓冲当前行数（getContent() 的行数口径）。
   * @returns 当前缓冲行数。
   */
  size(): number {
    return this.buffer.size
  }

  /**
   * Scrollback 缓冲行数上限。
   * @returns 行数上限。
   */
  capacity(): number {
    return this.cap
  }

  /**
   * 缓冲是否已满（此后写入覆盖最旧行——pager 可据此提示内容截断）。
   * @returns 满时为 true。
   */
  isFull(): boolean {
    return this.buffer.size >= this.cap
  }

  /**
   * 返回 scrollback 完整文本（各条目以换行符连接，封顶后只含最近 N 条）。
   * @returns 换行符连接的 scrollback 文本
   */
  getContent(): string {
    return this.buffer.items().join('\n')
  }

  /**
   * 将一条已提交条目写入终端 scrollback。
   *
   * 写入策略：完整的 ANSI 行 + 换行符。终端驱动负责将已显示内容
   * 推入 scrollback buffer。
   *
   * 即使 live region 在底部显示，此写入也发生在 live region 的
   * 重绘区域之前（cursor save 之前），因此天然按时间顺序排列。
   * @param entry - 待写入条目（ansi 优先于 text；自动补齐末尾换行）
   */
  write(entry: CommittedEntry): void {
    let content = entry.ansi ?? entry.text
    if (!content.endsWith('\n')) content += '\n'
    if (entry.trailingNewline) content += '\n'
    this.buffer.push(content.trimEnd())
    this.stdout.write(content)
  }

  /**
   * 批量写入多条已提交条目。
   * 在同一帧中连续写入，减少系统调用次数。
   * @param entries - 按顺序写入的条目列表
   */
  writeBatch(entries: readonly CommittedEntry[]): void {
    let buf = ''
    for (const entry of entries) {
      const content = entry.ansi ?? entry.text
      const line = content + (content.endsWith('\n') ? '' : '\n') + (entry.trailingNewline ? '\n' : '')
      this.buffer.push(line.trimEnd())
      buf += line
    }
    this.stdout.write(buf)
  }

  /**
   * 写入原始 ANSI 字符串（不追加换行）。
   * 用于需要精确控制格式的场景（如分隔线、缩进）。
   * 注意：不进入 scrollback buffer，pager 读不到此内容。
   * @param ansi - 原样写入 stdout 的字符串
   */
  writeRaw(ansi: string): void {
    this.stdout.write(ansi)
  }

  /**
   * 清空 scrollback buffer（/clear 命令）。只重置内部 buffer（后续
   * getContent()/pager 读取与写入位置）；已显示的行由调用方经
   * ANSI.ERASE_SCREEN + 光标回顶擦除（见 TuiApp 的 clearScrollback）。
   */
  reset(): void {
    this.buffer.clear()
  }

  /**
   * 写入一条水平分隔线。
   * 宽度 = 终端列数 或 指定宽度。
   * @param width - 分隔线宽度（列数）；缺省取 stdout.columns
   */
  writeSeparator(width?: number): void {
    const w = width ?? this.stdout.columns
    this.stdout.write(`${ANSI.DIM}${'─'.repeat(w)}${ANSI.RESET}\n`)
  }

  /**
   * 确保输出已刷新到终端。
   */
  drain(): void {
    if (this.flush) {
      // stdout 在 TTY 模式下通常不需要手动 drain，
      // 但提供此方法作为显式刷新点。
    }
  }
}
