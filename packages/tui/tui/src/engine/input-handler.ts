/**
 * T9 InputHandler — 统一键盘输入处理（替代 Ink 的 useInput hooks）。
 *
 * 核心功能：
 * - 设置 stdin raw mode，逐字节读取
 * - 解析 UTF-8 字符 + ANSI escape sequences（方向键、功能键等）
 * - 支持多种输入模式：normal / input / overlay / vim
 * - 分发按键事件到注册的处理器
 *
 * 按键类型分类（参考 Node.js readline + Ink 的 keypress 解析）：
 * - 可打印字符（UTF-8）：直接分发
 * - 控制字符（Ctrl+A..Z, Tab, Enter, Escape, Backspace）
 * - ANSI escape sequences（方向键、Home/End、PgUp/PgDn、F1-F12）
 * - 鼠标事件（SGR mouse protocol）— 暂不处理
 */

import type { ReadStream } from 'node:tty'

/** 一次按键事件的解析结果（原始字节 + 语义名称 + 修饰键状态）。 */
export interface KeyPress {
  /** 按键原始字符串 */
  raw: string
  /** 可打印字符（如 'a', '你'），控制键为 '' */
  char: string
  /** 按键名称 */
  name: KeyName
  /** Ctrl 是否按下 */
  ctrl: boolean
  /** Alt/Meta 是否按下 */
  meta: boolean
  /** Shift 是否按下 */
  shift: boolean
  /**
   * 该键之后同一输入缓冲内还有后续字节（非 bracketed paste 终端的粘贴流特征：
   * 终端一次 flush 多行，行尾 CR 后紧跟下一行文本；用户按 Enter 时缓冲已空）。
   * 输入行据此把内联 return 当作行分隔累积，流结束后一次提交——避免粘贴的
   * 换行被逐行解析为 Enter 而分批发送。bracketed paste 模式下整段经 onPaste
   * 到达，不经过此标志。
   */
  inline?: boolean
}

/** 可识别的按键语义名称；未映射的可打印字符与无法识别的序列为 'unknown'。 */
export type KeyName =
  | 'return'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'insert'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12'
  | 'space'
  | 'ctrl_c'
  | 'ctrl_d'
  | 'ctrl_h'
  | 'ctrl_j'
  | 'ctrl_z'
  | 'ctrl_l'
  | 'ctrl_u'
  | 'ctrl_a'
  | 'ctrl_e'
  | 'ctrl_k'
  | 'ctrl_w'
  | 'ctrl_n'
  | 'ctrl_o'
  | 'ctrl_p'
  | 'ctrl_r'
  | 'ctrl_s'
  | 'ctrl_t'
  | 'ctrl_v'
  | 'ctrl_b'
  | 'ctrl_f'
  | 'ctrl_x'
  | 'ctrl_]'
  | 'ctrl_minus'
  | 'ctrl_.'
  | 'ctrl_y'
  | 'ctrl_q'
  | 'ctrl_return'
  | 'shift_tab'
  | 'unknown'

/** 按键事件处理器。 */
export type KeyHandler = (key: KeyPress) => void

/** InputHandler 构造参数。 */
export interface InputHandlerOptions {
  stdin: ReadStream
  /** 初始输入模式 */
  mode?: InputMode
  /** 单独 ESC 字节的刷新超时（ms）。期间无后续字节则派发 escape。
   *  80ms 平衡低延迟和高延迟 SSH（原 40ms 在 150ms+ RTT 连接上会导致方向键序列被拆包）。
   *  这个值直接决定按 ESC 打断的响应速度，不能为了兼容慢终端而拉长。 */
  escapeTimeoutMs?: number
  /**
   * 不完整 CSI/SS3 序列的兜底超时（ms）。
   *
   * 与 `escapeTimeoutMs` 分开：buffer 已经是 `\x1B[…` 时就确定不是孤立 ESC 键
   * （用户敲不出这个组合），超时只为兜「终端半途断供导致 buffer 永久滞留」，
   * 不影响任何按键响应速度，故给足余量。此前两者共用 80ms，等于把兜底的宽容度
   * 绑死在 ESC 响应速度上——高负载或 SSH 下 stdin 分包间隔轻易超过 80ms，
   * 正常序列被腰斩后残体会被当成普通字符送进输入框。
   * 500ms 对齐 Node readline 的 `escapeCodeTimeout` 默认值。
   */
  partialSequenceTimeoutMs?: number
  /**
   * 缓冲末尾的 return 先按住再派发（ms）。下一 chunk 若立刻到达，把这次
   * return 标成 inline——非 bracketed paste 终端把粘贴拆成「一行一个 data
   * 事件」时，行尾 \\r 不再被当成用户 Enter 逐行提交。仅当同一 chunk 在
   * return 之前已有其它字节时按住；孤立 \\r 立即派发。
   */
  returnHoldMs?: number
}

/** Bracketed paste 标记（DEC 2004） */
const PASTE_START = '\x1B[200~'
const PASTE_END = '\x1B[201~'

/**
 * 尚未收完的 CPR 响应形状：`\x1B[66`、`\x1B[66;`、`\x1B[66;1`（缺结尾的 `R`）。
 *
 * CPR 是终端对 DSR `\x1B[6n` 探针的自动回吐，不是用户按键。它一旦被超时兜底
 * 腰斩，剩余部分不该退化成可打印字符——那会让 `[66;` 这样的残片出现在输入框里。
 * 完整体由 parseInput 的 CPR 分支正常消费，这里只管被截断的半截。
 */
const CPR_PARTIAL_RE = /^\x1B\[\d+(;\d*)?$/

/** 输入模式：作为 `mode:keyName` 前缀参与处理器路由（见 onKey）。 */
export type InputMode = 'normal' | 'input' | 'overlay' | 'approval'

/**
 * Ctrl+key 的 ASCII 范围：Ctrl+A = 0x01 .. Ctrl+Z = 0x1A
 * 以及一些特殊控制字符。
 */
const CTRL_CODES: Record<number, KeyName> = {
  0x01: 'ctrl_a',
  0x02: 'ctrl_b',
  0x03: 'ctrl_c',
  0x04: 'ctrl_d',
  0x05: 'ctrl_e',
  0x06: 'ctrl_f',
  0x08: 'ctrl_h', // 同时也映射为 backspace
  0x09: 'tab',
  0x0a: 'ctrl_j', // Ctrl+J = LF
  0x0b: 'ctrl_k',
  0x0c: 'ctrl_l',
  0x0d: 'return',
  0x0e: 'ctrl_n',
  0x0f: 'ctrl_o',
  0x10: 'ctrl_p',
  0x11: 'ctrl_q', // Ctrl+Q — C4 概念稿菜单「退出」
  0x12: 'ctrl_r',
  0x13: 'ctrl_s', // Ctrl+S — C4 概念稿菜单「恢复会话」
  0x14: 'ctrl_t',
  0x15: 'ctrl_u',
  0x16: 'ctrl_v',
  0x17: 'ctrl_w',
  0x18: 'ctrl_x',
  0x19: 'ctrl_y', // Ctrl+Y — redo（fish undo 的对偶）
  0x1a: 'ctrl_z',
  0x1d: 'ctrl_]',
  0x1e: 'ctrl_.', // Ctrl+. —— RS 字符（传统终端；kitty 协议走 CSI u）
  0x1f: 'ctrl_minus', // Ctrl+- / Ctrl+_（部分终端 Ctrl+/ 同码）——fish 式 undo
  0x1b: 'escape',
  0x7f: 'backspace',
}

const ANSI_ESCAPE_MAP: Record<string, KeyName> = {
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[H': 'home',
  '[F': 'end',
  '[2~': 'insert',
  '[3~': 'delete',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  'OP': 'f1',
  'OQ': 'f2',
  'OR': 'f3',
  'OS': 'f4',
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
  '[Z': 'shift_tab',
}

/**
 * 统一键盘输入处理器：构造时把 stdin 置为 raw mode 并接管 data 事件，
 * 解析 UTF-8 字符 / ANSI 转义序列 / bracketed paste / CPR 响应后分发给
 * 注册的处理器。用完必须调用 dispose() 恢复终端默认行为。
 */
export class InputHandler {
  private stdin: ReadStream
  private mode: InputMode
  private handlers = new Map<string, Set<KeyHandler>>()
  private pasteHandlers = new Set<(text: string) => void>()
  /** CPR（cursor position report）处理器：终端对 DSR `\x1B[6n` 的响应
   *  `\x1B[{row};{col}R` 不是按键，单独走这个通道（LiveEngine 自愈用）。 */
  private cprHandlers = new Set<(row: number, col: number) => void>()
  private escapeTimeoutMs: number
  private partialSequenceTimeoutMs: number
  private returnHoldMs: number
  private escapeTimer: ReturnType<typeof setTimeout> | null = null
  private returnHoldTimer: ReturnType<typeof setTimeout> | null = null
  private heldReturn: KeyPress | null = null
  /** 当为 true 时，单独的 ESC 字节立即派发为 escape，不等待超时。
   *  用于 overlay 激活场景，避免 ESC 关闭/退出有 40ms 可感知延迟。 */
  private escapeImmediate = false
  private pasteActive = false
  private pasteBuffer = ''
  /**
   * 跨 chunk 不完整代理对缓冲：上游（stdin）可能把同一 UTF-16 代理对的两个
   * code unit 拆到两个 `data` 事件里（高强度输入 + 终端流量控制时偶发）。
   * 若不缓冲，第一段被当成"可打印字符"派发，char 字段就是孤立的
   * high-surrogate `\uD83D`——输入框会显示成豆腐方块，emoji 簇不可用。
   * 这里在 handleData 入口预拼，在派发前剥离尾部 high-surrogate。
   */
  private pendingData = ''
  /**
   * 跨 chunk 输入字节缓冲。ESC 序列、bracketed paste 起止标记都可能被拆到
   * 多个 `data` 事件里；保留未处理完的尾部，等待后续字节完整后再派发。
   */
  private inputBuffer = ''
  /** Bound data listener registered on stdin while attached. */
  private readonly handleDataListener = (data: string): void => {
    this.handleData(data)
  }

  constructor(options: InputHandlerOptions) {
    this.stdin = options.stdin
    this.mode = options.mode ?? 'input'
    this.escapeTimeoutMs = options.escapeTimeoutMs ?? 80
    this.partialSequenceTimeoutMs = options.partialSequenceTimeoutMs ?? 500
    this.returnHoldMs = options.returnHoldMs ?? 12
    // WSL 边缘情况：stdin 可能不是 TTY（如管道输入），setRawMode 会抛错
    if (this.stdin.isTTY) {
      try { this.stdin.setRawMode(true) } catch { /* best-effort */ }
    }
    this.stdin.resume()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', this.handleDataListener)
  }

  /**
   * 注册按键处理器。
   * @param event - 按键名（KeyName）、`'*'` 通配、或 `mode:keyName` 模式限定形式
   * @param handler - 命中时调用的处理器
   * @returns 取消注册的函数
   */
  onKey(event: string, handler: KeyHandler): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => { set.delete(handler) }
  }

  /**
   * 注册所有按键的处理器（通配符）。
   * @param handler - 每个按键事件都会调用的处理器
   * @returns 取消注册的函数
   */
  onAnyKey(handler: KeyHandler): () => void {
    return this.onKey('*', handler)
  }

  /**
   * 注册 bracketed paste 处理器（一次性收到整段粘贴文本，已规范化换行）。
   * @param handler - 接收整段粘贴文本的处理器
   * @returns 取消注册的函数
   */
  onPaste(handler: (text: string) => void): () => void {
    this.pasteHandlers.add(handler)
    return () => { this.pasteHandlers.delete(handler) }
  }

  /**
   * 注册 CPR 处理器（终端光标位置报告，row/col 为 1-based）。
   * @param handler - 接收 row/col 的处理器
   * @returns 取消注册的函数
   */
  onCpr(handler: (row: number, col: number) => void): () => void {
    this.cprHandlers.add(handler)
    return () => { this.cprHandlers.delete(handler) }
  }

  /**
   * 切换输入模式（影响 `mode:keyName` 形式处理器的路由）。
   * @param mode - 新的输入模式
   */
  setMode(mode: InputMode): void {
    this.mode = mode
  }

  /**
   * 获取当前输入模式。
   * @returns 当前输入模式
   */
  getMode(): InputMode {
    return this.mode
  }

  /**
   * 设置单独 ESC 字节是否立即派发。
   * overlay 激活时设为 true，避免 ESC 关闭/退出等待超时。
   * @param immediate - true 立即派发孤立 ESC；false 恢复超时判定
   */
  setEscapeImmediate(immediate: boolean): void {
    this.escapeImmediate = immediate
  }

  /** 关闭 raw mode，恢复终端默认行为。 */
  /**
   * Temporarily detaches from the stdin data stream.
   *
   * Terminal capability probes (theme detection, live-engine CPR) read the
   * same stream; without coordination their responses would also reach the
   * key parser and leak into the input line. Call {@link resume} afterwards to
   * reattach; any bytes arriving while suspended are consumed by the probe.
   */
  suspend(): void {
    this.stdin.removeListener('data', this.handleDataListener)
  }

  /** Reattaches the stdin data listener after a {@link suspend}. */
  resume(): void {
    this.stdin.on('data', this.handleDataListener)
  }

  /**
   * Tear down the handler: clear pending escape/return-hold timers, drop
   * buffered state, and detach the stdin data listener.
   */
  dispose(): void {
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
    }
    if (this.returnHoldTimer) {
      clearTimeout(this.returnHoldTimer)
      this.returnHoldTimer = null
    }
    this.heldReturn = null
    this.pendingData = ''
    this.inputBuffer = ''
    this.stdin.removeAllListeners('data')
    // WSL: 若 stdin 不是 TTY，setRawMode 会抛错
    if (this.stdin.isTTY) {
      try { this.stdin.setRawMode(false) } catch { /* best-effort */ }
    }
    this.stdin.pause()
    this.handlers.clear()
    this.pasteHandlers.clear()
    this.cprHandlers.clear()
  }

  // ── internal ─────────────────────────────────────────────────

  private handleData(data: string): void {
    // 跨 chunk 粘贴：上一包停在行尾 return 上，本包到达 → 那次 return 是行分隔。
    if (this.heldReturn !== null) this.flushHeldReturn(true)

    // 0. 拼接上次未处理完的代理对片段
    if (this.pendingData) {
      data = this.pendingData + data
      this.pendingData = ''
    }

    // 0b. 若末尾是孤立的 high-surrogate，剥出留到下个 chunk 拼接。
    if (data.length > 0) {
      const lastCode = data.charCodeAt(data.length - 1)
      if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
        this.pendingData = data.slice(-1)
        data = data.slice(0, -1)
        if (!data) return
      }
    }

    this.inputBuffer += data

    // 新字节到达 → 取消待定的 lone-ESC 超时（后续序列接管解析）
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
    }

    this.processInputBuffer()
  }

  /**
   * 从缓冲区起始位置连续派发普通按键，直到遇到不完整序列或缓冲区末尾。
   * 返回实际消费的字节数。
   */
  private dispatchKeys(buf: string): number {
    let i = 0
    while (i < buf.length) {
      const parsed = this.parseInput(buf.slice(i))
      if (parsed.consumed === 0) break // 未完整序列，等后续字节
      if (parsed.key) {
        // 内联 return：该键后同一缓冲还有字节 → 非 paste 终端粘贴流的行分隔
        //（用户 Enter 时缓冲无剩余）。输入行据此合并多行粘贴为一次提交。
        if (parsed.key.name === 'return' && i + parsed.consumed < buf.length) {
          parsed.key.inline = true
        }
        // 同一 chunk 里文本后面跟着行尾 return（「一行一个 flush」的粘贴）才按住：
        // 孤立的 \r（用户 Enter）立即派发；Shift/Meta/Ctrl+Enter 不是粘贴 CR。
        const holdable = parsed.key.name === 'return'
          && parsed.key.inline !== true
          && i + parsed.consumed >= buf.length
          && i > 0
          && !parsed.key.shift
          && !parsed.key.meta
          && !parsed.key.ctrl
        if (holdable) {
          this.holdReturn(parsed.key)
          i += parsed.consumed
          break
        }
        this.dispatch(parsed.key) // CPR 等非按键事件只消费不派发
      }
      i += parsed.consumed
    }
    return i
  }

  /** 缓冲末尾的 return 先按住：等下一 chunk 或超时再派发。 */
  private holdReturn(key: KeyPress): void {
    if (this.returnHoldTimer !== null) {
      clearTimeout(this.returnHoldTimer)
      this.returnHoldTimer = null
    }
    this.heldReturn = key
    this.returnHoldTimer = setTimeout(() => {
      this.returnHoldTimer = null
      this.flushHeldReturn(false)
    }, this.returnHoldMs)
  }

  /**
   * 派出按住的 return。
   * @param inline - true：后续 chunk 已到，当作粘贴行分隔；false：超时，当作用户 Enter。
   */
  private flushHeldReturn(inline: boolean): void {
    if (this.returnHoldTimer !== null) {
      clearTimeout(this.returnHoldTimer)
      this.returnHoldTimer = null
    }
    const key = this.heldReturn
    this.heldReturn = null
    if (key === null) return
    if (inline) key.inline = true
    this.dispatch(key)
  }

  /** 处理跨 chunk 缓冲的输入缓冲区，按 paste → ESC 序列 → 普通字符优先级解析。 */
  private processInputBuffer(): void {
    while (this.inputBuffer.length > 0) {
      // 1. 进行中的 paste：累积直到结束标记
      if (this.pasteActive) {
        const endIdx = this.inputBuffer.indexOf(PASTE_END)
        if (endIdx !== -1) {
          this.pasteBuffer += this.inputBuffer.slice(0, endIdx)
          // 归一化换行；剥离 C0 控制符（保留 \n \t）与 ESC——防终端转义注入
          //（粘贴携带的 SGR/控制序列原样进 buffer 会改色/移动光标，2026-07-23 P1-3）。
          const text = this.pasteBuffer
            .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
          this.pasteActive = false
          this.pasteBuffer = ''
          for (const handler of this.pasteHandlers) handler(text)
          this.inputBuffer = this.inputBuffer.slice(endIdx + PASTE_END.length)
          continue
        }

        const partial = getPartialSuffix(this.inputBuffer, PASTE_END)
        if (partial > 0) {
          this.pasteBuffer += this.inputBuffer.slice(0, -partial)
          this.inputBuffer = this.inputBuffer.slice(-partial)
          break
        }

        this.pasteBuffer += this.inputBuffer
        this.inputBuffer = ''
        break
      }

      // 2. 检测 paste 起始标记（前面可能还有普通按键）
      const startIdx = this.inputBuffer.indexOf(PASTE_START)
      if (startIdx !== -1) {
        const prefix = this.inputBuffer.slice(0, startIdx)
        const consumed = this.dispatchKeys(prefix)
        if (consumed < prefix.length) {
          // 前缀里有未完整的按键，先保留，等下一 chunk 再处理
          this.inputBuffer = this.inputBuffer.slice(consumed)
          break
        }
        // 前缀派发完毕，进入 paste 模式
        this.inputBuffer = this.inputBuffer.slice(startIdx + PASTE_START.length)
        this.pasteActive = true
        this.pasteBuffer = ''
        continue
      }

      // 3. paste 起始标记被拆到 chunk 边界，保留可能的部分标记
      const partialStart = getPartialSuffix(this.inputBuffer, PASTE_START)
      if (partialStart > 0) {
        const prefixLen = this.inputBuffer.length - partialStart
        const consumed = this.dispatchKeys(this.inputBuffer.slice(0, prefixLen))
        this.inputBuffer = this.inputBuffer.slice(consumed)
        break
      }

      // 4. 普通按键
      const consumed = this.dispatchKeys(this.inputBuffer)
      this.inputBuffer = this.inputBuffer.slice(consumed)
      break
    }

    // lone ESC 超时处理
    if (this.inputBuffer === '\x1B' && !this.pasteActive) {
      if (this.escapeImmediate) {
        this.inputBuffer = ''
        this.dispatch({ raw: '\x1B', char: '', name: 'escape', ctrl: false, meta: false, shift: false })
      } else {
        this.escapeTimer = setTimeout(() => {
          this.escapeTimer = null
          if (this.inputBuffer === '\x1B' && !this.pasteActive) {
            this.inputBuffer = ''
            this.dispatch({ raw: '\x1B', char: '', name: 'escape', ctrl: false, meta: false, shift: false })
          }
        }, this.escapeTimeoutMs)
      }
    } else if (!this.pasteActive && (this.inputBuffer.startsWith('\x1B[') || this.inputBuffer.startsWith('\x1BO'))) {
      // 不完整 CSI/SS3 超时兜底（2026-07-23 P1-4）：半个转义序列后终端不再
      // 发字节时，inputBuffer 会永久滞留、后续按键全部卡死。超时按 unknown
      // 消费首字节（ESC）并重试剩余——正常分 chunk 序列因新字节到达会
      // clearTimeout（handleData），不会误触发。
      const flushPartial = (): void => {
        if (this.pasteActive || (!this.inputBuffer.startsWith('\x1B[') && !this.inputBuffer.startsWith('\x1BO'))) return
        // CPR 残体整段丢弃，不走「消费 ESC + 剩余重解析」那条路：CPR 是终端对
        // DSR 探针的自动回吐，不是用户输入，剥掉 ESC 后剩下的 `[66;1R` 会被逐字
        // 当可打印字符送进输入框（用户看到的就是输入框里冒出 `[66;`）。
        if (CPR_PARTIAL_RE.test(this.inputBuffer)) {
          this.inputBuffer = ''
          return
        }
        this.dispatch({ raw: '\x1B', char: '', name: 'unknown', ctrl: false, meta: false, shift: false })
        this.inputBuffer = this.inputBuffer.slice(1)
        this.processInputBuffer()
      }
      if (this.escapeImmediate) flushPartial()
      else if (!this.escapeTimer) {
        this.escapeTimer = setTimeout(() => {
          this.escapeTimer = null
          flushPartial()
        }, this.partialSequenceTimeoutMs)
      }
    }
  }

  /** 把按键分发到 name / 通配 / mode 前缀三类处理器。 */
  private dispatch(key: KeyPress): void {
    const nameSet = this.handlers.get(key.name)
    if (nameSet) {
      for (const handler of nameSet) handler(key)
    }

    const wildSet = this.handlers.get('*')
    if (wildSet) {
      for (const handler of wildSet) handler(key)
    }

    const modeSet = this.handlers.get(`${this.mode}:${key.name}`)
    if (modeSet) {
      for (const handler of modeSet) handler(key)
    }
  }

  /**
   * 解析 data 首部的一个按键事件 + 实际消费的 code unit 数。
   *
   * 返回 { key: null, consumed: 0 } 表示"等后续字节"（孤 ESC 字节、跨 chunk
   * 的 CSI/SS3 序列）；否则 key 非 null，consumed 告诉调用方已消费的字节数。
   */
  private parseInput(data: string): { key: KeyPress | null; consumed: number } {
    if (data.length === 0) return { key: null, consumed: 0 }

    // ESC 序列
    if (data.startsWith('\x1B')) {
      if (data.length === 1) return { key: null, consumed: 0 }

      // CSI 序列（方向键、功能键、带修饰键的序列等）
      const csiMatch = data.match(/^\x1B\[[0-9;:]*[A-Za-z~]/)
      if (csiMatch) {
        const seq = csiMatch[0]
        // CPR（DSR 响应 `\x1B[{row};{col}R`）：不是按键——路由给 cprHandlers，
        // key=null + consumed>0 让 dispatchKeys 消费后继续解析后续输入。
        const cprMatch = seq.match(/^\x1B\[(\d+);(\d+)R$/)
        if (cprMatch) {
          for (const handler of this.cprHandlers) handler(Number(cprMatch[1]), Number(cprMatch[2]))
          return { key: null, consumed: seq.length }
        }
        const enhanced = decodeEnhancedKey(seq)
        if (enhanced !== null) {
          if ('skip' in enhanced) return { key: null, consumed: seq.length }
          return {
            key: {
              raw: seq,
              char: enhanced.char,
              name: enhanced.name,
              ctrl: enhanced.ctrl,
              meta: enhanced.meta,
              shift: enhanced.shift,
            },
            consumed: seq.length,
          }
        }
        const name = this.resolveEscapeSequence(seq)
        const meta = seq.includes(';3') || seq.includes(';4')
        const shift = seq.includes(';2') || name === 'shift_tab'
        return { key: { raw: seq, char: '', name: name ?? 'unknown', ctrl: false, meta, shift }, consumed: seq.length }
      }

      // SS3 序列（F1-F4 等）
      const ss3Match = data.match(/^\x1BO[A-Za-z]/)
      if (ss3Match) {
        const seq = ss3Match[0]
        const name = this.resolveEscapeSequence(seq)
        return { key: { raw: seq, char: '', name: name ?? 'unknown', ctrl: false, meta: false, shift: false }, consumed: seq.length }
      }

      // Alt/Meta + 可打印字符（\x1B 后跟非 [ 非 O 的字符）
      // 终端将 Alt+key 编码为 ESC + key。如 Alt+f → \x1Bf。
      if (data.length >= 2 && data[1] !== '[' && data[1] !== 'O') {
        const char = data[1]
        if (char === undefined) return { key: null, consumed: 0 }
        // Alt+Enter: ESC + CR → 与 Kitty \x1B[13;3u 对齐为 return + meta
        if (char === '\r') {
          return {
            key: { raw: data.slice(0, 2), char: '', name: 'return', ctrl: false, meta: true, shift: false },
            consumed: 2,
          }
        }
        // Alt+控制字符：ESC+控制码按 CTRL_CODES 命名（如 ESC+DEL =
        // meta+backspace）——否则落进「可打印字符」分支得 name 'unknown'，
        // 消费方按名路由永远收不到。
        const ctrlName = CTRL_CODES[char.charCodeAt(0)]
        if (ctrlName !== undefined) {
          return {
            key: { raw: data.slice(0, 2), char: '', name: ctrlName, ctrl: false, meta: true, shift: false },
            consumed: 2,
          }
        }
        const isUpper = char >= 'A' && char <= 'Z'
        return {
          key: { raw: data.slice(0, 2), char, name: 'unknown', ctrl: false, meta: true, shift: isUpper },
          consumed: 2,
        }
      }

      // 看起来是未完整的 CSI/SS3 序列，等待后续字节
      if (/^\x1B(\[([0-9;:]*)|O)$/.test(data)) {
        return { key: null, consumed: 0 }
      }

      // 无法识别的 ESC 序列：消费掉 ESC 字节本身，避免无限循环
      return { key: { raw: '\x1B', char: '', name: 'unknown', ctrl: false, meta: false, shift: false }, consumed: 1 }
    }

    // 单字节控制字符
    const code = data.codePointAt(0)
    if (code === undefined) return { key: null, consumed: 0 }
    if (code <= 0x1f || code === 0x7f) {
      const name = CTRL_CODES[code] ?? 'unknown'
      return {
        key: { raw: data.slice(0, 1), char: '', name, ctrl: code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d, meta: false, shift: false },
        consumed: 1,
      }
    }

    // 可打印字符：UTF-16 代理对占 2 code unit；BMP 占 1。
    const charLen = code > 0xFFFF ? 2 : 1
    const char = data.slice(0, charLen)
    return {
      key: {
        raw: char,
        char,
        name: char === ' ' ? 'space' : 'unknown',
        ctrl: false,
        meta: false,
        shift:
          char !== char.toLowerCase() && char !== char.toUpperCase()
            ? false
            : char === char.toUpperCase() && char.toLowerCase() !== char.toUpperCase(),
      },
      consumed: charLen,
    }
  }

  private resolveEscapeSequence(seq: string): KeyName | null {
    // 移除前导 \x1B
    const body = seq.slice(1)

    // 直接映射
    const direct = ANSI_ESCAPE_MAP[body]
    if (direct) return direct

    // Kitty / xterm modifyOtherKeys: Shift+Enter can arrive as \x1B[13;2u,
    // and Shift+Tab as \x1B[9;2u (kitty keyboard protocol).
    const modifyOtherKeysMatch = body.match(/^\[(\d+);(\d+)u$/)
    if (modifyOtherKeysMatch) {
      const code = Number(modifyOtherKeysMatch[1])
      if (code === 13) return 'return'
      if (code === 9) return 'shift_tab'
    }

    // 处理带修饰键的序列（如 \x1B[1;5A = Ctrl+Up）
    const modMatch = body.match(/^\[(\d+);(\d+)([A-H~])$/)
    if (modMatch) {
      const suffix = `[${modMatch[3]}`
      const baseName = ANSI_ESCAPE_MAP[suffix]
      if (baseName) return baseName
    }

    // 处理 \x1B[1~ 等带数字前缀的序列
    const prefixMatch = body.match(/^\[(\d+)([~])$/)
    if (prefixMatch) {
      const suffix = `[${prefixMatch[2]}`
      const baseName = ANSI_ESCAPE_MAP[suffix]
      if (baseName) return baseName
    }

    return null
  }
}

/** Kitty CSI u / xterm modifyOtherKeys：功能键、Ctrl+字母、带修饰的可打印键。 */
function decodeEnhancedKey(
  seq: string,
): { skip: true } | { name: KeyName; ctrl: boolean; meta: boolean; shift: boolean; char: string } | null {
  const body = seq.startsWith('\x1B') ? seq.slice(1) : seq
  const kitty = body.match(/^\[(\d+)(?::[^;]*)?(?:;(\d+)(?::(\d+))?)?(?:;(\d+))?(?:;[^u]*)?u$/)
  if (kitty !== null) {
    const event = kitty[3] !== undefined ? Number(kitty[3]) : kitty[4] !== undefined ? Number(kitty[4]) : 1
    if (event === 3) return { skip: true }
    return enhancedKeyFromCode(Number(kitty[1]), kitty[2] === undefined ? 1 : Number(kitty[2]))
  }
  const xterm = body.match(/^\[27;(\d+);(\d+)~$/)
  if (xterm !== null) {
    return enhancedKeyFromCode(Number(xterm[2]), Number(xterm[1]))
  }
  return null
}

/** Kitty 修饰键：1 + shift + alt*2 + ctrl*4。flag 1 下 Ctrl+C 是 code 99（'c'）+ mod 5。
 *  Ctrl+Enter（code 13 + ctrl 位，如 CSI 13;5u）映射为 ctrl_return；不含 ctrl 位的
 *  修饰 Enter（Shift+Enter 等）仍是 return，修饰位经返回值保留。 */
function enhancedKeyFromCode(
  code: number,
  mod: number,
): { name: KeyName; ctrl: boolean; meta: boolean; shift: boolean; char: string } | null {
  const bits = Math.max(0, mod - 1)
  const shift = (bits & 1) !== 0
  const meta = (bits & 2) !== 0
  const ctrl = (bits & 4) !== 0
  let name: KeyName | null = null
  let char = ''
  if (code === 27) name = 'escape'
  else if (code === 13) name = ctrl ? 'ctrl_return' : 'return'
  else if (code === 9) name = shift ? 'shift_tab' : 'tab'
  else if (code === 127 || code === 8) name = 'backspace'
  else if (ctrl && code >= 97 && code <= 122) name = CTRL_CODES[code - 96] ?? 'unknown'
  else if (ctrl && code >= 65 && code <= 90) name = CTRL_CODES[code - 64] ?? 'unknown'
  else if (code >= 1 && code <= 26) name = CTRL_CODES[code] ?? 'unknown'
  else if (ctrl && code === 46) name = 'ctrl_.'
  else if (ctrl && (code === 45 || code === 95)) name = 'ctrl_minus'
  else if (ctrl && code === 93) name = 'ctrl_]'
  else if (ctrl && code === 91) name = 'escape'
  if (name === null && code >= 32 && code !== 127) {
    char = String.fromCodePoint(code)
    name = char === ' ' ? 'space' : 'unknown'
  }
  if (name === null) return null
  return { name, ctrl, meta, shift, char }
}

/** 返回 `buf` 后缀中是 `marker` 前缀的最长长度（0 表示没有）。
 *  用于 bracketed paste 起止标记跨 chunk 时保留不完整尾部。 */
function getPartialSuffix(buf: string, marker: string): number {
  const max = Math.min(marker.length - 1, buf.length)
  for (let len = max; len > 0; len--) {
    if (buf.endsWith(marker.slice(0, len))) return len
  }
  return 0
}
