/**
 * memory-speedup-probe 的无 key 形状测试：臂参数解析、任务文本、报告折算
 * 纯函数、以及子进程级的 keyless skip / 无效臂 fail loud（不触碰真实模型）。
 *
 * @module headless-agent-example/tests/memory-speedup-probe
 */

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CallId, createAssistantMessage, createUserMessage } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import {
  TASK_ONE,
  TASK_TWO,
  collectSessionReport,
  parseArm,
} from '../memory-speedup-probe.mts'

describe('memory-speedup-probe（无 key 形状）', () => {
  it('parseArm：缺省 mem；nomem 合法；无效臂 fail loud', () => {
    expect(parseArm(undefined)).toBe('mem')
    expect(parseArm('NOMEM')).toBe('nomem')
    expect(() => parseArm('bogus')).toThrow('unknown arm')
  })

  it('任务文本确定性：T 建模块+修种子 bug，T\' 同族不同细节', () => {
    expect(TASK_ONE).toContain('src/format.ts')
    expect(TASK_ONE).toContain('BUG')
    expect(TASK_TWO).toContain('src/format-extra.ts')
    expect(TASK_TWO).not.toBe(TASK_ONE)
  })

  it('collectSessionReport：折算 turns/tokens/STM 刷新/memory_* 工具调用', () => {
    const session = Session.create(SessionId('probe-shape'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'task' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('memory/cache-miss', { intentId: 'intent-1', intentKey: 'k', turn: 1, reason: 'initial' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('c1'), name: 'memory_search', arguments: '{}' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'done' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 3 },
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const report = collectSessionReport('probe-shape', session.events, 123)
    expect(report).toEqual({
      sessionId: 'probe-shape',
      turns: 1,
      inputTokens: 10,
      cacheReadTokens: 5,
      outputTokens: 3,
      wallMs: 123,
      stmRefreshes: ['initial'],
      memoryToolCalls: ['memory_search'],
    })
  })

  it('无 DEEPSEEK_API_KEY：打印 skipped 并以 0 退出（不产出数据）', () => {
    const env = { ...process.env }
    delete env.DEEPSEEK_API_KEY
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx/esm', 'examples/headless-agent/memory-speedup-probe.mts', 'shape-test'],
      { env, encoding: 'utf-8', timeout: 120_000 },
    )
    expect(stdout).toContain('skipped')
  }, 150_000)

  it('无效臂：非零退出（fail loud 优先于 keyless skip）', () => {
    const env = { ...process.env }
    delete env.DEEPSEEK_API_KEY
    expect(() => execFileSync(
      process.execPath,
      ['--import', 'tsx/esm', 'examples/headless-agent/memory-speedup-probe.mts', 'shape-test', '/dev/null', 'bogus'],
      { env, encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' },
    )).toThrow()
  }, 150_000)
})
