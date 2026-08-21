/**
 * 输入历史持久化存储 —— `$DSH_HOME/input-history.json`（0600，原子写）。
 *
 * 对标 opencode-tui 的 src/tui/history.ts：跨会话的 ↑/↓ 输入历史。语义与
 * 内存版一致（最新在前、去重、截顶），仅把保存落到磁盘：加载失败（缺失/
 * 损坏/权限）降级为空历史并静默——历史是加速器不是事实源，坏档不该拦住
 * 启动；写入串行排队（一次至多一个在途写），排队期间的新记录合并进下一
 * 次写，失败静默丢弃同批（下次成功写会补齐全量）。
 *
 * @module @huiliyi37/dsh-tui/input-history-store
 */

import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@huiliyi37/dsh-atomic-write'
import { dshHomePath } from '@huiliyi37/dsh-paths'

/** 持久化条目上限（竞品同款；内存导航截顶保持既有 100）。 */
export const MAX_PERSISTED = 1000

/**
 * 缺省历史文件路径：生产为 `$DSH_HOME/input-history.json`；Vitest 下为进程级
 * tmp 文件——app 级测试大量构造 TuiApp 并提交输入，缺省路径必须与真实 home
 * 隔离（显式传 path 的测试不受影响）。
 * @returns 缺省路径。
 */
function defaultHistoryPath(): string {
  if (process.env.VITEST !== undefined) {
    return join(tmpdir(), `dsh-input-history-${process.pid}.json`)
  }
  return dshHomePath('input-history.json')
}

/** 输入历史持久化存储。 */
export class InputHistoryStore {
  private entries: string[] = []
  private writeChain: Promise<void> = Promise.resolve()
  private writeQueued = false
  private readonly path: string

  /**
   * @param path - 历史文件路径；缺省见 {@link defaultHistoryPath}。
   */
  constructor(path?: string) {
    this.path = path ?? defaultHistoryPath()
  }

  /**
   * 从磁盘加载历史（构造后调用一次）。文件缺失/损坏/不可读降级为空历史。
   * @returns 加载后的存储（this，便于链式）。
   */
  async load(): Promise<this> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_PERSISTED)
      }
    } catch {
      // 缺失/损坏/权限——历史是加速器，坏档降级为空而不是拦启动。
    }
    return this
  }

  /** 当前历史快照（最新在前；导航消费方直接持有）。 */
  snapshot(): string[] {
    return [...this.entries]
  }

  /**
   * 记录一条提交（最新在前、去重、截顶）并异步落盘。
   * @param entry - 提交文本（调用方已 trim 且非空）。
   */
  record(entry: string): void {
    this.entries = [entry, ...this.entries.filter(h => h !== entry)].slice(0, MAX_PERSISTED)
    this.scheduleWrite()
  }

  /**
   * 串行落盘：一次至多一个在途写；排队期间的新记录由下一次写全量补齐。
   * 失败静默（下次成功写覆盖），不阻塞输入。
   */
  private scheduleWrite(): void {
    if (this.writeQueued) return
    this.writeQueued = true
    this.writeChain = this.writeChain
      .then(async () => {
        await writeFileAtomic(this.path, `${JSON.stringify(this.entries)}\n`, { mode: 0o600 })
      })
      .catch(() => {
        // 写失败静默：历史非事实源，下次成功写全量补齐。
      })
      .finally(() => { this.writeQueued = false })
  }
}
