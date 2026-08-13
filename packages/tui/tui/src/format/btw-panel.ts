/**
 * renderBtwPanel — /btw 侧问浮动面板纯函数（P1）。
 *
 * 把 BtwController 的 peek 快照投影为 live 区顶部面板行：loading 显示 spinner
 * + 问题文本 + Esc 提示；done 显示问题 + 答案全文（逐行截断）+ 折叠提示；
 * error 显示失败信息。纯函数：同一输入恒返回同一行序列，无 I/O、无时钟
 * （spinner 是静态 glyph，不随 tick 变化——面板在 120ms ticker 下已自动刷新）。
 * 着色由组合器（renderLive）按状态决定，本模块只产纯文本行。
 *
 * @module @huiliyi37/dsh-tui/format/btw-panel
 */

import { truncateToDisplayWidth } from '../width.js'

/** 面板输入（与 BtwController.peek() 的形状对齐）。 */
export interface BtwPanelInput {
  /** loading：等待答案；done：答案定稿；error：超时/失败。 */
  status: 'loading' | 'done' | 'error'
  /** 侧问原文。 */
  question: string
  /** done 时的答案全文。 */
  answer?: string
  /** error 时的失败信息。 */
  error?: string
}

/** 面板渲染选项。 */
export interface BtwPanelOptions {
  /** 可用显示宽度（列数）。 */
  width: number
}

/**
 * 渲染 btw 侧问面板行。
 * @param input - 挂起态快照。
 * @param opts - 渲染选项。
 * @returns 面板行数组（纯文本；状态行恒存在）。
 */
export function renderBtwPanel(input: BtwPanelInput, opts: BtwPanelOptions): string[] {
  const rows: string[] = []
  if (input.status === 'loading') {
    rows.push(`⏳ 侧问: ${truncateToDisplayWidth(input.question, opts.width)}`)
    rows.push('（Esc 取消；不中断当前对话）')
    return rows
  }
  if (input.status === 'error') {
    rows.push(`⚠ 侧问失败: ${truncateToDisplayWidth(input.error ?? '', opts.width)}`)
    rows.push('（Esc 关闭）')
    return rows
  }
  rows.push(`💬 侧问: ${truncateToDisplayWidth(input.question, opts.width)}`)
  const answer = input.answer ?? ''
  if (answer === '') {
    rows.push('（空回答）')
  } else {
    for (const line of answer.split('\n')) {
      rows.push(truncateToDisplayWidth(line, opts.width))
    }
  }
  rows.push('（Esc 关闭，答案已写入记录）')
  return rows
}
