import { describe, expect, it } from 'vitest'
import { createRingBuffer } from '../src/ring-buffer.js'
import { appendStreamWindow } from '../src/stream-window.js'
import { brailleSpinnerFrame, circleSpinnerFrame } from '../src/braille-spinner.js'

describe('createRingBuffer', () => {
  it('pushes and returns items in FIFO order', () => {
    const rb = createRingBuffer<number>(3)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.items()).toEqual([1, 2, 3])
    expect(rb.size).toBe(3)
  })

  it('overwrites the oldest item once capacity is exceeded', () => {
    const rb = createRingBuffer<number>(3)
    for (const n of [1, 2, 3, 4]) rb.push(n)
    expect(rb.items()).toEqual([2, 3, 4])
    expect(rb.size).toBe(3)
  })

  it('wraps the head correctly across multiple overflows', () => {
    const rb = createRingBuffer<string>(2)
    for (const s of ['a', 'b', 'c', 'd', 'e']) rb.push(s)
    expect(rb.items()).toEqual(['d', 'e'])
  })

  it('drains up to n items and shrinks size', () => {
    const rb = createRingBuffer<number>(4)
    rb.push(1)
    rb.push(2)
    rb.push(3)
    expect(rb.drain(2)).toEqual([1, 2])
    expect(rb.size).toBe(1)
    expect(rb.items()).toEqual([3])
  })

  it('drains at most the available count', () => {
    const rb = createRingBuffer<number>(2)
    rb.push(1)
    expect(rb.drain(10)).toEqual([1])
    expect(rb.size).toBe(0)
    expect(rb.drain(10)).toEqual([])
  })

  it('drain wraps correctly after overflow', () => {
    const rb = createRingBuffer<number>(3)
    for (const n of [1, 2, 3, 4, 5]) rb.push(n)
    // Ring now holds [3,4,5] with head at index 1.
    expect(rb.drain(2)).toEqual([3, 4])
    expect(rb.items()).toEqual([5])
  })

  it('clear resets to empty', () => {
    const rb = createRingBuffer<number>(2)
    rb.push(1)
    rb.push(2)
    rb.clear()
    expect(rb.size).toBe(0)
    expect(rb.items()).toEqual([])
  })

  it('supports a capacity of one', () => {
    const rb = createRingBuffer<number>(1)
    rb.push(1)
    rb.push(2)
    expect(rb.items()).toEqual([2])
    expect(rb.drain(1)).toEqual([2])
    expect(rb.size).toBe(0)
  })
})

describe('appendStreamWindow', () => {
  it('returns the combined text when within budget', () => {
    expect(appendStreamWindow('ab', 'cd', 10)).toBe('abcd')
  })

  it('marks and keeps the tail when over budget', () => {
    const out = appendStreamWindow('aaaaaaaaaa', 'bbbb', 8)
    // combined = 14 chars; slice(-8) keeps the last 8: 'aaaabbbb'
    expect(out).toBe('… truncated live stream output …\naaaabbbb')
    expect(out.slice(-8)).toBe('aaaabbbb')
  })

  it('handles an empty current window', () => {
    expect(appendStreamWindow('', 'hello', 5)).toBe('hello')
    expect(appendStreamWindow('', 'hello', 3)).toBe('… truncated live stream output …\nllo')
  })
})

describe('brailleSpinnerFrame', () => {
  it('cycles through frames deterministically', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(brailleSpinnerFrame(i))
    expect(seen.size).toBe(10)
  })

  it('handles negative ticks without crashing', () => {
    expect(brailleSpinnerFrame(-1)).toBe(brailleSpinnerFrame(9))
    expect(brailleSpinnerFrame(-11)).toBe(brailleSpinnerFrame(9))
  })
})

describe('circleSpinnerFrame', () => {
  it('cycles through four moon-phase frames', () => {
    const frames = [circleSpinnerFrame(0), circleSpinnerFrame(1), circleSpinnerFrame(2), circleSpinnerFrame(3)]
    expect(new Set(frames).size).toBe(4)
    expect(circleSpinnerFrame(4)).toBe(circleSpinnerFrame(0))
  })
})
