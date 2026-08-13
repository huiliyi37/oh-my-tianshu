/** 定容环形缓冲：满后 push 覆盖最旧项；items/drain 按插入序出队。 */
export interface RingBuffer<T> {
  push(item: T): void
  items(): T[]
  clear(): void
  drain(n: number): T[]
  readonly size: number
}

/**
 * 创建定容环形缓冲。
 * @param cap - 容量上限（满后覆盖最旧项）。
 * @returns 新的 RingBuffer 实例。
 */
export function createRingBuffer<T>(cap: number): RingBuffer<T> {
  const buf: T[] = new Array<T>(cap)
  let head = 0
  let count = 0

  return {
    push(item: T) {
      buf[(head + count) % cap] = item
      if (count < cap) count++
      else head = (head + 1) % cap
    },
    items() {
      const result: T[] = []
      for (let i = 0; i < count; i++) {
        const item = buf[(head + i) % cap]
        /* v8 ignore next -- count 内的槽位必被 push 填过，恒非 undefined；noUncheckedIndexedAccess 收窄防御 */
        if (item !== undefined) result.push(item)
      }
      return result
    },
    clear() {
      head = 0
      count = 0
    },
    drain(n: number): T[] {
      const drained = Math.min(n, count)
      const result: T[] = []
      for (let i = 0; i < drained; i++) {
        const item = buf[(head + i) % cap]
        /* v8 ignore next -- drain 只取 count 内的槽位，必被 push 填过；noUncheckedIndexedAccess 收窄防御 */
        if (item !== undefined) result.push(item)
      }
      head = (head + drained) % cap
      count -= drained
      return result
    },
    get size() { return count },
  }
}
