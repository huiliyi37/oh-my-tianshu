import { describe, expect, it, vi } from 'vitest'
import { BlockStreamWriter } from '../src/block-stream-writer.js'

function collect() {
  const blocks: string[] = []
  return { blocks, writer: new BlockStreamWriter({ idleMs: 10_000 }, t => blocks.push(t)) }
}

describe('BlockStreamWriter', () => {
  it('emits nothing below the first-block threshold and keeps the tail in peek', async () => {
    const { blocks, writer } = collect()
    writer.push('hello')
    // below minChars: no automatic emit, tail stays in peek
    expect(blocks).toEqual([])
    expect(writer.peek()).toBe('hello')
    // an explicit flush force-emits the buffered tail
    await writer.flush()
    expect(blocks).toEqual(['hello'])
    expect(writer.peek()).toBe('')
  })

  it('flushes the buffered text as one block', async () => {
    const { blocks, writer } = collect()
    writer.push('short')
    await writer.flush()
    expect(blocks).toEqual(['short'])
    expect(writer.peek()).toBe('')
  })

  it('emits at a sentence boundary once the min threshold is passed', () => {
    const blocks: string[] = []
    const writer = new BlockStreamWriter({ minChars: 20, maxChars: 200, idleMs: 10_000 }, t => blocks.push(t))
    writer.push('first sentence here. and then some more text to cross the threshold')
    // 'first sentence here.' clears minChars (21 >= 20); the sentence end
    // cuts the first block; the remainder stays buffered as the live tail.
    expect(blocks).toEqual(['first sentence here.'])
    expect(writer.peek()).toContain('and then')
  })

  it('emits at a paragraph boundary when present', () => {
    const { blocks, writer } = collect()
    writer.push('paragraph one with enough text to pass the threshold.\n\nparagraph two remains buffered')
    expect(blocks).toEqual(['paragraph one with enough text to pass the threshold.\n\n'])
    expect(writer.peek()).toContain('paragraph two')
  })

  it('splits at maxChars when the buffer overflows a single block', () => {
    const { blocks, writer } = collect()
    const chunk = 'x'.repeat(500)
    writer.push(chunk)
    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.every(b => b.length <= 210)).toBe(true)
  })

  it('discard drops the buffer without emitting', async () => {
    const { blocks, writer } = collect()
    writer.push('stale text that should never surface')
    writer.discard()
    expect(writer.peek()).toBe('')
    await writer.flush()
    expect(blocks).toEqual([])
  })

  it('the idle timer flushes on its own', async () => {
    vi.useFakeTimers()
    try {
      const { blocks, writer } = collect()
      writer.push('idle flush text')
      vi.advanceTimersByTime(10_001)
      await vi.runAllTimersAsync()
      expect(blocks).toEqual(['idle flush text'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('buffer limit enforcement always makes progress even with degenerate config', () => {
    const { writer } = collect()
    const writer2 = new BlockStreamWriter({ maxChars: 0, maxBufferSize: 5 }, () => {})
    writer2.push('a'.repeat(100))
    expect(writer2.peek().length).toBeLessThanOrEqual(5)
    expect(writer).toBeDefined()
  })

  it('ignores empty chunks', () => {
    const { blocks, writer } = collect()
    writer.push('')
    expect(writer.peek()).toBe('')
    expect(blocks).toEqual([])
  })

  it('breaks an overflowing buffer at a paragraph boundary when one exists', () => {
    const blocks: string[] = []
    const writer = new BlockStreamWriter({ minChars: 50, maxChars: 60, idleMs: 10_000 }, t => blocks.push(t))
    // paragraph break sits inside the overflow window; findBreakPoint must cut there
    writer.push('x'.repeat(30) + '\n\n' + 'y'.repeat(200))
    expect(blocks.some(b => b.includes('\n\n'))).toBe(true)
    expect(writer.peek().length).toBeGreaterThan(0)
  })

  it('breaks an overflowing buffer at a line boundary when no paragraph break exists', () => {
    const blocks: string[] = []
    const writer = new BlockStreamWriter({ minChars: 50, maxChars: 60, idleMs: 10_000 }, t => blocks.push(t))
    writer.push('x'.repeat(40) + '\n' + 'y'.repeat(200))
    expect(blocks.some(b => b.endsWith('\n'))).toBe(true)
  })

  it('breaks at a space boundary when no paragraph/line break exists', () => {
    const blocks: string[] = []
    const writer = new BlockStreamWriter({ minChars: 10, maxChars: 30, idleMs: 10_000 }, t => blocks.push(t))
    writer.push('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda ')
    // 无 \n 断点：findBreakPoint 必须落在 maxChars 窗口内最后一个空格处
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]).toMatch(/ $/)
  })

  it('recursively splits when a single block still exceeds maxChars', () => {
    const blocks: string[] = []
    const writer = new BlockStreamWriter({ minChars: 10, maxChars: 30, idleMs: 10_000 }, t => blocks.push(t))
    // no whitespace/paragraph/line breaks anywhere: every cut lands at maxPos,
    // and the recursive checkEmit keeps splitting until the tail is small.
    writer.push('a'.repeat(150))
    expect(blocks.length).toBeGreaterThanOrEqual(5)
    expect(blocks.every(b => b.length <= 30)).toBe(true)
    expect(writer.peek().length).toBeLessThan(30)
  })
})
