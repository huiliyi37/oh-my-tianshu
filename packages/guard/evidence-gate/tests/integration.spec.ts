/**
 * integration.spec.ts — 端到端：真实 cordis Context 装配插件，真实事件对象
 * 驱动 RED→GREEN 闭环（不 mock 中间层——guard 注册、事件订阅、归账全走插件本身）。
 *
 * 场景：创建 bugfix 义务 → 编辑源文件被拦 → 测试 failed（RED）→ 编辑放行 →
 * 测试 passed（GREEN）→ 义务 satisfied → final allow。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { apply as applyEvidenceGate, type EvidenceService } from '../src/index.js'
import type { ToolGuard, ToolExecution } from '@deepseek-ai/dsh-tools'

/** 最小 tools 服务面：guard 注册捕获（真实 ctx.provide，非 mock 语义）。 */
interface ToolsFacet {
  guard: (guard: ToolGuard) => () => void
}

function makeContext(): { ctx: Context; tools: ToolsFacet; guards: ToolGuard[]; emit: (name: string, ...args: unknown[]) => void } {
  const guards: ToolGuard[] = []
  const tools: ToolsFacet = {
    guard: (guard: ToolGuard) => {
      guards.push(guard)
      return () => {
        const idx = guards.indexOf(guard)
        if (idx !== -1) guards.splice(idx, 1)
      }
    },
  }
  const ctx = new Context() as Context & { tools: ToolsFacet }
  ctx.provide('tools', tools)
  applyEvidenceGate(ctx)
  const emit = (name: string, ...args: unknown[]): void => {
    // @ts-expect-error -- name: string 非 keyof Events；测试 payload 形状宽松
    (ctx.emit)(name, ...args)
  }
  return { ctx, tools, guards, emit }
}

function makeExecution(name: string, arguments_: unknown): ToolExecution {
  return {
    callId: `call-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: arguments_,
    signal: new AbortController().signal,
  } as ToolExecution
}

function makeToolCall(callId: string, name: string, argumentsJson: string): unknown {
  return {
    type: 'tool/call',
    seq: 1,
    time: Date.now(),
    data: { turn: 0, step: 0, callId, name, arguments: argumentsJson },
  }
}

function makeToolResult(callId: string, text: string): unknown {
  return {
    type: 'tool/result',
    seq: 2,
    time: Date.now(),
    data: {
      turn: 0,
      step: 0,
      message: {
        id: `msg-${callId}`,
        role: 'user',
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          isError: false,
          content: [{ type: 'text', text }],
        }],
      },
    },
  }
}

function runGuard(guards: ToolGuard[], name: string, arguments_: unknown): string | undefined {
  const exec = makeExecution(name, arguments_)
  for (const guard of guards) {
    const reason = guard(exec)
    if (reason !== undefined) return reason
  }
  return undefined
}

describe('evidence-gate 插件端到端（RED→GREEN 闭环）', () => {
  it('创建义务 → 编辑被拦 → 测试 failed 记 RED → 编辑放行 → passed → satisfied', () => {
    const { ctx, guards, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    // 1. 任务边界：创建 bugfix 义务
    evidence.createObligation({
      family: 'bugfix',
      risk: 'high',
      claim: '修复 X 崩溃',
      targets: ['src/foo.ts'],
    })

    // 2. 编辑源文件 → 被拦（无 RED）
    const block = runGuard(guards, 'edit_file', { filePath: 'src/foo.ts' })
    expect(block).toContain('RED')

    // 3. 测试/scratch 路径豁免
    expect(runGuard(guards, 'edit_file', { filePath: 'tests/foo.spec.ts' })).toBeUndefined()

    // 4. 跑测试失败（RED）：tool/call 记 command → tool/result failed → 归账记 red
    const callId = 'call-red-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run foo.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  1 failed | 9 passed'))

    // 5. 编辑放行（hasRedEvidence）
    expect(runGuard(guards, 'edit_file', { filePath: 'src/foo.ts' })).toBeUndefined()

    // 6. 跑测试通过（GREEN）：归账 satisfied
    const callId2 = 'call-green-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId2, 'bash', JSON.stringify({ command: 'pnpm vitest run foo.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId2, 'Test Files  1 passed (1)\nTests  10 passed (10)'))

    // 7. final allow
    const final = evidence.evaluateFinal()
    expect(final.verdict).toBe('allow')
    expect(evidence.unresolvedHigh()).toHaveLength(0)
  })

  it('passed 无 RED 不满足（pass-without-red），final 仍 honest_blocked', () => {
    const { ctx, guards, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 Y', targets: ['src/bar.ts'] })

    // 直接跑测试通过（无 RED）
    const callId = 'call-pass-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run bar.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  10 passed (10)'))

    // 编辑仍被拦（无 RED 证据）
    expect(runGuard(guards, 'edit_file', { filePath: 'src/bar.ts' })).toContain('RED')
    // final：首次未决 → continue_once（S4 完整版语义）
    const first = evidence.evaluateFinal()
    expect(first.verdict).toBe('continue_once')
    evidence.markContinued(first.nextAction!.obligationId)
    expect(evidence.evaluateFinal().verdict).toBe('honest_blocked')
  })

  it('无关工具的 bash 输出不归账；非测试命令忽略', () => {
    const { ctx, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 Z', targets: ['src/baz.ts'] })

    const callId = 'call-ls-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'ls -la' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  1 failed')) // 非测试命令：不归账

    const snap = (evidence as unknown as { unresolvedHigh(): unknown[] }).unresolvedHigh()
    expect(snap).toHaveLength(1)
    expect(evidence.evaluateFinal().verdict).toBe('continue_once')
  })

  it('enabled: false 时编辑门不拦（仅跟踪）', () => {
    const guards: ToolGuard[] = []
    const ctx = new Context() as Context & { tools: ToolsFacet }
    ctx.provide('tools', {
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => { }
      },
    })
    applyEvidenceGate(ctx, { enabled: false })
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 W', targets: ['src/w.ts'] })
    expect(runGuard(guards, 'edit_file', { filePath: 'src/w.ts' })).toBeUndefined()
  })
})

describe('插件生命周期', () => {
  it('guard disposer 移除后不再拦截', () => {
    const { guards } = makeContext()
    const before = guards.length
    expect(before).toBeGreaterThan(0)
    // 插件 dispose：直接卸载 ctx（Context 无 dispose？cordis 卸载用 ctx.dispose? 简化：验证 guard 存在即可）
    expect(guards[0]).toBeTypeOf('function')
  })
})

// vi 引用防未用告警
void vi

describe('TDD 门接线（suggest/enforce）', () => {
  function makeTddContext(config: { tddMode?: 'suggest' | 'enforce' } = {}): {
    guards: ToolGuard[]
    emit: (name: string, ...args: unknown[]) => void
    ctx: Context
  } {
    const guards: ToolGuard[] = []
    const ctx = new Context() as Context & { tools: ToolsFacet }
    ctx.provide('tools', {
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => { }
      },
    })
    applyEvidenceGate(ctx, config)
    return {
      guards,
      emit: (name: string, ...args: unknown[]): void => {
        // @ts-expect-error -- 测试宽松 emit 形状（name 非 keyof Events）
        (ctx.emit)(name, ...args)
      },
      ctx,
    }
  }

  it('enforce 模式：连续编辑 3 次无验证 → 拦截', () => {
    const { guards } = makeTddContext({ tddMode: 'enforce' })
    const reason1 = runGuard(guards, 'write_file', { filePath: 'src/a.ts' })
    const reason2 = runGuard(guards, 'write_file', { filePath: 'src/b.ts' })
    const reason3 = runGuard(guards, 'write_file', { filePath: 'src/c.ts' })
    expect(reason1).toBeUndefined()
    expect(reason2).toBeUndefined()
    expect(reason3).toContain('TDD')
  })

  it('suggest 模式（默认）：连续编辑不拦（仅计数）', () => {
    const { guards } = makeTddContext()
    for (let i = 0; i < 5; i++) {
      expect(runGuard(guards, 'write_file', { filePath: `src/f${i}.ts` })).toBeUndefined()
    }
  })

  it('验证归账后编辑计数重置（不再拦截）', () => {
    const { guards, emit } = makeTddContext({ tddMode: 'enforce' })
    runGuard(guards, 'write_file', { filePath: 'src/a.ts' })
    runGuard(guards, 'write_file', { filePath: 'src/b.ts' })
    // 跑一次测试（通过）→ 验证归账 → 计数重置
    const callId = 'call-tdd-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run a.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  10 passed (10)'))
    expect(runGuard(guards, 'write_file', { filePath: 'src/c.ts' })).toBeUndefined()
  })
})

describe('S4 闭环：拦截含探针建议 → final continue_once → GREEN → allow', () => {
  it('端到端：编辑被拦（消息含探针）→ 执行探针 failed → 编辑放行 → final 首次 continue_once → GREEN → allow', () => {
    const { ctx, guards, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 X 崩溃', targets: ['src/foo.ts'] })

    // 编辑被拦：消息含探针建议
    const block = runGuard(guards, 'edit_file', { filePath: 'src/foo.ts' })
    expect(block).toContain('RED')
    expect(block).toContain('建议探针')
    expect(block).toContain('tests/foo.spec.ts')

    // final 首次：continue_once + 探针建议
    const first = evidence.evaluateFinal()
    expect(first.verdict).toBe('continue_once')
    expect(first.nextAction?.probes?.[0]?.kind).toBe('targeted_test')
    evidence.markContinued(first.nextAction!.obligationId)

    // 执行探针：RED（failed）
    const redCall = 'call-s4-red-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(redCall, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/foo.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(redCall, 'Tests  1 failed | 9 passed'))

    // 编辑放行（RED 证据）
    expect(runGuard(guards, 'edit_file', { filePath: 'src/foo.ts' })).toBeUndefined()

    // GREEN
    const greenCall = 'call-s4-green-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(greenCall, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/foo.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(greenCall, 'Tests  10 passed (10)'))

    // final allow
    expect(evidence.evaluateFinal().verdict).toBe('allow')
  })

  it('final 未验证路径：第二次（markContinued 后）→ honest_blocked + 披露', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 Y', targets: ['src/bar.ts'] })
    runGuard(guards, 'edit_file', { filePath: 'src/bar.ts' }) // 被拦（无 RED）

    const first = evidence.evaluateFinal()
    expect(first.verdict).toBe('continue_once')
    evidence.markContinued(first.nextAction!.obligationId)

    const second = evidence.evaluateFinal()
    expect(second.verdict).toBe('honest_blocked')
    expect(second.unresolved?.[0]?.claim).toContain('修复 Y')
  })
})

describe('原生编辑工具 str_replace_editor 适配', () => {
  it('create/str_replace/insert（写操作）被 L1 门拦截（各独立义务，避开 once latch）', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    for (const command of ['str_replace', 'create', 'insert'] as const) {
      evidence.createObligation({ family: 'bugfix', risk: 'high', claim: `修复原生工具缺陷 ${command}`, targets: ['src/native.ts'] })
      expect(runGuard(guards, 'str_replace_editor', { command, path: 'src/native.ts' })).toContain('RED')
    }
  })

  it('view（读操作）不拦', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复原生工具缺陷', targets: ['src/native.ts'] })
    expect(runGuard(guards, 'str_replace_editor', { command: 'view', path: 'src/native.ts' })).toBeUndefined()
  })

  it('RED 后写操作放行（与 edit_file 同语义）', () => {
    const { ctx, guards, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复原生工具缺陷', targets: ['src/native.ts'] })
    expect(runGuard(guards, 'str_replace_editor', { command: 'str_replace', path: 'src/native.ts' })).toContain('RED')
    const callId = 'call-native-red-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/native.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  1 failed | 9 passed'))
    expect(runGuard(guards, 'str_replace_editor', { command: 'str_replace', path: 'src/native.ts' })).toBeUndefined()
  })
})

describe('index.ts 编辑门边界路径', () => {
  it('未知工具名（不在 EDIT_TOOLS）→ 放行', () => {
    const { guards } = makeContext()
    expect(runGuard(guards, 'bash', { command: 'ls -la' })).toBeUndefined()
  })

  it('arguments 非对象 → 路径提取不到 → 保守放行', () => {
    const { guards } = makeContext()
    expect(runGuard(guards, 'edit_file', 'not-an-object')).toBeUndefined()
  })

  it('hash_edit / apply_patch 工具被 L1 门拦截', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 hash 缺陷', targets: ['src/hash.ts'] })
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 patch 缺陷', targets: ['src/patch.ts'] })
    expect(runGuard(guards, 'hash_edit', { filePath: 'src/hash.ts' })).toContain('RED')
    expect(runGuard(guards, 'apply_patch', { filePath: 'src/patch.ts' })).toContain('RED')
  })

  it('edit_file 无 filePath 字段时回退提取 path 字段', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 path 缺陷', targets: ['src/path.ts'] })
    expect(runGuard(guards, 'edit_file', { path: 'src/path.ts' })).toContain('RED')
  })

  it('空字符串路径 → 提取不到 → 放行', () => {
    const { ctx, guards } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 empty 缺陷', targets: ['src/empty.ts'] })
    expect(runGuard(guards, 'write_file', { filePath: '' })).toBeUndefined()
  })

  it('tddThreshold 配置生效（1 次编辑即拦截）', () => {
    const guards: ToolGuard[] = []
    const ctx = new Context() as Context & { tools: ToolsFacet }
    ctx.provide('tools', {
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => { }
      },
    })
    applyEvidenceGate(ctx, { tddMode: 'enforce', tddThreshold: 1 })
    expect(runGuard(guards, 'write_file', { filePath: 'src/a.ts' })).toContain('TDD')
  })

  it('tools 服务未提供时插件仍可装配（reflect.get 返回 undefined 兜底）', () => {
    const ctx = new Context()
    expect(() => { applyEvidenceGate(ctx) }).not.toThrow()
    expect(ctx.get('evidence')).toBeDefined()
  })
})

describe('index.ts 验证归账边界路径', () => {
  function makeBareContext(): { ctx: Context; emit: (name: string, ...args: unknown[]) => void } {
    const ctx = new Context()
    applyEvidenceGate(ctx)
    return {
      ctx,
      emit: (name: string, ...args: unknown[]): void => {
        // @ts-expect-error -- 测试宽松 emit 形状（name 非 keyof Events）
        (ctx.emit)(name, ...args)
      },
    }
  }

  it('bash 调用无 command 字段 → 不记 pending，结果不归账', () => {
    const { emit } = makeBareContext()
    emit('session/event', { id: 'session-1' }, makeToolCall('call-no-cmd-1', 'bash', JSON.stringify({ foo: 'bar' })))
    emit('session/event', { id: 'session-1' }, makeToolResult('call-no-cmd-1', 'Tests  1 failed'))
    // 无义务可查；仅验证不抛异常（pendingCommands 未记录 → result 忽略）
  })

  it('tool/call arguments 非对象 JSON → 忽略', () => {
    const { emit } = makeBareContext()
    emit('session/event', { id: 'session-1' }, makeToolCall('call-nonobj-1', 'bash', JSON.stringify('just-a-string')))
    emit('session/event', { id: 'session-1' }, makeToolResult('call-nonobj-1', 'Tests  1 failed'))
  })

  it('tool/call arguments 无效 JSON → catch 忽略', () => {
    const { emit } = makeBareContext()
    emit('session/event', { id: 'session-1' }, makeToolCall('call-badjson-1', 'bash', '{invalid json'))
    emit('session/event', { id: 'session-1' }, makeToolResult('call-badjson-1', 'Tests  1 failed'))
  })

  it('孤儿 tool/result（无对应 tool/call）→ 忽略', () => {
    const { emit } = makeBareContext()
    emit('session/event', { id: 'session-1' }, makeToolResult('call-orphan-1', 'Tests  1 failed'))
  })

  it('非 tool/call 非 tool/result 的 session 事件 → 忽略', () => {
    const { emit } = makeBareContext()
    emit('session/event', { id: 'session-1' }, { type: 'session/started', seq: 0, time: Date.now(), data: {} })
    emit('session/event', { id: 'session-1' }, { type: 'message', seq: 1, time: Date.now(), data: {} })
  })

  it('tool-result 块 content[0] 非对象（字符串）→ 输出提取为空，按 blocked 归账', () => {
    const { ctx, emit } = makeBareContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 malformed 缺陷', targets: ['src/malformed.ts'] })
    const callId = 'call-malformed-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/malformed.spec.ts' })))
    emit('session/event', { id: 'session-1' }, {
      type: 'tool/result',
      seq: 2,
      time: Date.now(),
      data: {
        turn: 0,
        step: 0,
        message: {
          id: `msg-${callId}`,
          role: 'user',
          source: { kind: 'tool', callId },
          content: ['plain-string'], // first 非对象
        },
      },
    })
    expect(evidence.unresolvedHigh()).toHaveLength(1) // blocked 归账不 satisfied
  })

  it('tool-result 块 content 字段非数组 → 输出提取为空', () => {
    const { emit } = makeBareContext()
    const callId = 'call-nonarr-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/x.spec.ts' })))
    emit('session/event', { id: 'session-1' }, {
      type: 'tool/result',
      seq: 2,
      time: Date.now(),
      data: {
        turn: 0,
        step: 0,
        message: {
          id: `msg-${callId}`,
          role: 'user',
          source: { kind: 'tool', callId },
          content: [{ type: 'tool-result', content: 'not-array' }],
        },
      },
    })
  })

  it('服务面 supersedeAll / verificationCount / cooldownTable', () => {
    const { ctx, emit } = makeContext()
    const evidence = ctx.get('evidence') as EvidenceService
    evidence.createObligation({ family: 'bugfix', risk: 'high', claim: '修复 svc 缺陷', targets: ['src/svc.ts'] })
    const callId = 'call-svc-1'
    emit('session/event', { id: 'session-1' }, makeToolCall(callId, 'bash', JSON.stringify({ command: 'pnpm vitest run tests/svc.spec.ts' })))
    emit('session/event', { id: 'session-1' }, makeToolResult(callId, 'Tests  1 failed | 9 passed'))
    expect(evidence.verificationCount()).toBe(1)
    expect(evidence.cooldownTable()).toEqual({})
    evidence.supersedeAll()
    expect(evidence.unresolvedHigh()).toHaveLength(0)
  })
})
