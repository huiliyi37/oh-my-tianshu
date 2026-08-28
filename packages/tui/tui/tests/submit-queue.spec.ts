/**
 * submit-queue — 运行中本地排队控制器与展示行；cancelAndSendInput（Ctrl+Enter
 * 插队编排：打断 → 落定 → 正常提交路径直发）。回流 dsh-tui 9d7f421/c53a497。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  cancelAndSendInput,
  formatQueueLine,
  SubmitQueueController,
} from '../src/controllers/submit-queue.js'

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

describe('cancelAndSendInput（Ctrl+Enter 插队编排）', () => {
  /** 输入行替身 + 依赖记录。 */
  function makeDeps(over: { value?: string; images?: string[]; withControls?: boolean } = {}) {
    const input = {
      value: over.value ?? 'send now',
      images: over.images ?? ([] as string[]),
      setValue: vi.fn((v: string) => { input.value = v }),
      clearImages: vi.fn(() => { input.images = [] }),
    }
    let resolveIdle: (() => void) | undefined
    const controls = over.withControls === false ? undefined : {
      whenIdle: vi.fn(() => new Promise<void>((resolve) => { resolveIdle = resolve })),
    }
    const deps = { input, controls, abort: vi.fn(), submit: vi.fn() }
    return { ...deps, resolveIdle: () => resolveIdle?.() }
  }

  it('先清输入行再打断；whenIdle 落定后才提交（cancel-and-send 时序）', async () => {
    const d = makeDeps({ images: ['data:image/png;base64,x'] })
    cancelAndSendInput(d)
    expect(d.input.setValue).toHaveBeenCalledWith('')
    expect(d.input.clearImages).toHaveBeenCalledTimes(1)
    expect(d.abort).toHaveBeenCalledTimes(1)
    expect(d.controls?.whenIdle).toHaveBeenCalledTimes(1)
    // 落定前不提交
    expect(d.submit).not.toHaveBeenCalled()
    d.resolveIdle()
    await new Promise(resolve => setImmediate(resolve))
    expect(d.submit).toHaveBeenCalledWith('send now', ['data:image/png;base64,x'])
  })

  it('无控制面（未挂载 agent）时打断后直接提交', () => {
    const d = makeDeps({ withControls: false })
    cancelAndSendInput(d)
    expect(d.abort).toHaveBeenCalledTimes(1)
    expect(d.submit).toHaveBeenCalledTimes(1)
    expect(d.submit).toHaveBeenCalledWith('send now', undefined)
  })

  it('空白草稿且无图不插队（不消费不动作）', () => {
    const d = makeDeps({ value: '   ' })
    cancelAndSendInput(d)
    expect(d.abort).not.toHaveBeenCalled()
    expect(d.submit).not.toHaveBeenCalled()
    expect(d.input.setValue).not.toHaveBeenCalled()
  })
})
