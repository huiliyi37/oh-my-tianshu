/**
 * submit-queue — 运行中提交的本地排队（对标 CC 排队消息；↑ 取回队首）。
 *
 * 宿主 followup 通道本身是数组 FIFO（agent inbox 逐轮消费），但取回要在 TUI
 * 侧完成才能不惊动宿主：running 期间的 Enter 进本地队列（输入轨上方立即可见），
 * turn/end 才按序投递 followup（与立即发送的宿主消费时机等价：都在下一轮边界）；
 * 中断不清队（保留用户意图）。中轮即时纠偏仍走 /steer、Ctrl+T（与插队的
 * cancel-and-send 语义分层，见回流 dsh-tui 9d7f421）。
 */

import { truncateToDisplayWidth } from '../width.js'

/** 一条排队中的待发消息。 */
export interface QueuedSubmit {
  text: string
  images: string[] | undefined
}

export class SubmitQueueController {
  private items: QueuedSubmit[] = []

  /** 入队（保持提交顺序）。 */
  push(text: string, images: string[] | undefined): void {
    this.items.push({ text, images })
  }

  /** 当前队列长度。 */
  size(): number {
    return this.items.length
  }

  /** 只读快照（渲染用）。 */
  peekAll(): readonly QueuedSubmit[] {
    return this.items
  }

  /** 取回队首（最旧一条）回输入行。 */
  takeFirst(): QueuedSubmit | undefined {
    return this.items.shift()
  }

  /** turn/end 全量取出（按提交顺序投递）。 */
  drain(): QueuedSubmit[] {
    const out = this.items
    this.items = []
    return out
  }

  /** 切会话清空（调用方负责回显丢弃提示）。 */
  clear(): void {
    this.items = []
  }
}

/**
 * 排队展示行：`⏳ N 条排队 · 最旧一条（↑ 取回）`，超宽截断。
 * @param cols - 终端列数。
 * @param items - 只读队列快照。
 */
export function formatQueueLine(cols: number, items: readonly QueuedSubmit[]): string {
  const first = items[0]
  const head = first === undefined ? '' : ` · ${first.text.replace(/\s+/g, ' ')}`
  return truncateToDisplayWidth(`⏳ ${items.length} 条排队${head}（↑ 取回）`, Math.max(10, cols - 2))
}
