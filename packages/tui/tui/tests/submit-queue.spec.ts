/**
 * submit-queue — 运行中本地排队控制器与展示行（回流 dsh-tui 9d7f421）。
 */
import { describe, expect, it } from 'vitest'
import { formatQueueLine, SubmitQueueController } from '../src/controllers/submit-queue.js'

function plain(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('SubmitQueueController', () => {
  it('push 保持顺序；takeFirst 取最旧；drain 全量清空', () => {
    const q = new SubmitQueueController()
    q.push('first', undefined)
    q.push('second', ['data:image/png;base64,x'])
    expect(q.size()).toBe(2)
    expect(q.peekAll().map(i => i.text)).toEqual(['first', 'second'])
    expect(q.takeFirst()?.text).toBe('first')
    expect(q.takeFirst()?.images).toEqual(['data:image/png;base64,x'])
    expect(q.takeFirst()).toBeUndefined()
    q.push('third', undefined)
    expect(q.drain().map(i => i.text)).toEqual(['third'])
    expect(q.size()).toBe(0)
    q.clear()
    expect(q.size()).toBe(0)
  })
})

describe('formatQueueLine', () => {
  it('含条数、最旧一条与取回提示；空白压平', () => {
    const q = new SubmitQueueController()
    q.push('hello\n  world', undefined)
    q.push('second', undefined)
    const line = plain(formatQueueLine(80, q.peekAll()))
    expect(line).toContain('2 条排队')
    expect(line).toContain('hello world')
    expect(line).toContain('↑ 取回')
  })

  it('超宽截断到终端宽度', () => {
    const q = new SubmitQueueController()
    q.push('x'.repeat(200), undefined)
    const line = plain(formatQueueLine(40, q.peekAll()))
    expect(line.length).toBeLessThanOrEqual(40)
  })

  it('空队列渲染只有骨架', () => {
    const line = plain(formatQueueLine(80, []))
    expect(line).toContain('0 条排队')
  })
})
