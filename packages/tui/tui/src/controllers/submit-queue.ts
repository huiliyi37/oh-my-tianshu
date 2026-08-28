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

export interface CancelAndSendDeps {
  /** 输入行（读取当前草稿 + 提交前清空）。 */
  input: { value: string; images: readonly string[]; setValue(value: string, cursor?: number): void; clearImages(): void }
  /** live agent 控制面（whenIdle 等打断落定；undefined = 无 live agent 时直接提交）。 */
  controls: { whenIdle(): Promise<void> } | undefined
  /** 用户主动打断（app.handleAbort：cancel 带 keepInbox + 流式残文清理 + 回显）。 */
  abort(): void
  /** 正常提交路径（app.handleSubmit：排队/直发由运行态分流）。 */
  submit(text: string, images?: string[]): void
}

/**
 * Ctrl+Enter 插队（cancel-and-send）：打断当前回合并把输入行草稿立即发出去。
 * 与 Ctrl+T steer 的区别：steer 不打断在途 step（下一轮边界才被消费），
 * cancel-and-send 先 cancel（keepInbox——宿主 inbox 里未消费的 steer/排队残留
 * 保留），等 whenIdle 落定后再走正常提交路径——此时 agent 已 idle，handleSubmit
 * 直发 followup，本地队列里更老的消息排在其后投递（「插队」语义）。先取草稿
 * 快照再清空输入行（与 steerInput 同款先清后送）；whenIdle 是 quiescence 语义
 * 只 resolve 不 reject。空白草稿且无图时不插队。
 * @param deps - 装配依赖（输入行 / 控制面 / 打断 / 提交）。
 */
export function cancelAndSendInput(deps: CancelAndSendDeps): void {
  const text = deps.input.value
  const images = deps.input.images.length > 0 ? [...deps.input.images] : undefined
  if (text.trim() === '' && images === undefined) return
  deps.input.setValue('')
  if (images !== undefined) deps.input.clearImages()
  deps.abort()
  const idle = deps.controls?.whenIdle()
  if (idle === undefined) {
    deps.submit(text, images)
    return
  }
  void idle.then(() => { deps.submit(text, images) })
}
