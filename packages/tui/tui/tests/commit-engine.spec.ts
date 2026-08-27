/**
 * CommitEngine 缓冲访问器单测（size/capacity/isFull——/scroll 转录查看器的
 * 截断提示数据源）。
 *
 * isFull 语义：size >= cap（此后写入覆盖最旧行，pager 据此提示内容截断）。
 *
 * @module @huiliyi37/dsh-tui/tests/commit-engine
 */

import { describe, expect, it, vi } from 'vitest'
import type { WriteStream } from 'node:tty'
import { CommitEngine } from '../src/engine/commit-engine.js'

function makeStdout(): WriteStream & { write: ReturnType<typeof vi.fn> } {
  return {
    columns: 100,
    rows: 30,
    write: vi.fn(),
    isTTY: false,
  } as unknown as WriteStream & { write: ReturnType<typeof vi.fn> }
}

describe('CommitEngine — 缓冲访问器', () => {
  it('capacity 缺省 1000；自定义上限生效', () => {
    expect(new CommitEngine({ stdout: makeStdout() }).capacity()).toBe(1000)
    expect(new CommitEngine({ stdout: makeStdout(), scrollbackMaxLines: 3 }).capacity()).toBe(3)
  })

  it('size 随写入增长；getContent 按行拼接', () => {
    const engine = new CommitEngine({ stdout: makeStdout() })
    expect(engine.size()).toBe(0)
    engine.write({ text: 'one' })
    engine.write({ text: 'two' })
    expect(engine.size()).toBe(2)
    expect(engine.getContent()).toBe('one\ntwo')
  })

  it('isFull：满后保持 true 且最旧行被覆盖丢弃', () => {
    const engine = new CommitEngine({ stdout: makeStdout(), scrollbackMaxLines: 2 })
    engine.write({ text: 'a' })
    expect(engine.isFull()).toBe(false)
    engine.write({ text: 'b' })
    expect(engine.isFull()).toBe(true)
    engine.write({ text: 'c' })
    expect(engine.isFull()).toBe(true)
    expect(engine.size()).toBe(2)
    expect(engine.getContent()).toBe('b\nc')
  })

  it('reset 清空缓冲并解除 isFull', () => {
    const engine = new CommitEngine({ stdout: makeStdout(), scrollbackMaxLines: 2 })
    engine.write({ text: 'a' })
    engine.write({ text: 'b' })
    engine.reset()
    expect(engine.size()).toBe(0)
    expect(engine.isFull()).toBe(false)
    expect(engine.getContent()).toBe('')
  })
})
