// REAL-composition lane（packages/AGENTS.md 契约）：test-only cordis.yml 经
// Loader 进程内 boot，真实 Cordis Context 与真实服务树（spine + 审批/提问服务），
// 只在终端边界造假（fake TTY 流）、llm-replay 顶掉真适配器。断言用行为判据：
// 挂载后事件驱动渲染、tui-runner fiber dispose 后监听器全释放（写静默）、
// raw-mode 对称恢复。C4 认领的 disposer 缺陷以 it.todo 立线（见文末）。
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import Include from '@cordisjs/plugin-include'
import type { ReadStream, WriteStream } from 'node:tty'
import SettingsLocal from '@deepseek-ai/dsh-settings-local'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import UserInteraction from '@deepseek-ai/dsh-user-interaction'
import * as LlmReplay from '@deepseek-ai/dsh-llm-replay'
import * as AgentSpine from '@deepseek-ai/dsh-agent-spine-demo'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Subagent, { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Tui from '../src/index.js'

interface FakeStdout {
  stream: WriteStream
  /** 全部写入的拼接文本（ANSI 原样）。 */
  text(): string
  /** write() 被调用的次数（渲染调度探针）。 */
  writes(): number
}

/** 可渲染的 stdout 替身：记录每次写入，宽 100 高 30。 */
function makeStdout(): FakeStdout {
  const chunks: string[] = []
  const emitter = new EventEmitter()
  const stream = Object.assign(emitter, {
    columns: 100,
    rows: 30,
    isTTY: true,
    write: (chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    },
  }) as unknown as WriteStream
  return { stream, text: () => chunks.join(''), writes: () => chunks.length }
}

interface FakeStdin {
  stream: ReadStream
  /** setRawMode 实参序列（true=接管 / false=恢复）。 */
  rawModeCalls: boolean[]
}

/** TTY stdin 替身：EventEmitter 承载按键/SIGINT，raw-mode 调用可查。 */
function makeStdin(): FakeStdin {
  const rawModeCalls: boolean[] = []
  const emitter = new EventEmitter()
  const stream = Object.assign(emitter, {
    isTTY: true,
    setRawMode: (value: boolean): ReadStream => {
      rawModeCalls.push(value)
      return stream
    },
    resume: (): void => {},
    pause: (): void => {},
    setEncoding: (): void => {},
    isPaused: (): boolean => false,
    isRaw: false,
  }) as unknown as ReadStream
  return { stream, rawModeCalls }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

interface Booted {
  ctx: Context
  stdout: FakeStdout
  stdin: FakeStdin
  /** tui-runner 插件自己的 ctx（选择性 dispose 该 fiber 用）。 */
  tuiCtx: () => Context
}

/**
 * Boot the real tui composition (example cordis.yml minus the real adapter)
 * through an in-process Loader.
 * @returns the booted root context, fake streams, and the tui plugin fiber handle.
 */
async function boot(): Promise<Booted> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tui-loader-'))
  vi.stubEnv('DSH_HOME', join(root, '.dsh'))
  vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents'))
  const stdout = makeStdout()
  const stdin = makeStdin()
  let tuiCtx: Context | undefined

  // 场景不驱动任何模型调用：空 fixture（0 条录制脚本）即合法，真调用会 fail loud。
  const fixturePath = join(root, 'session.jsonl')
  await writeFile(fixturePath, '')

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-local'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '- id: user-approval',
    "  name: '@deepseek-ai/dsh-user-approval'",
    '- id: user-interaction',
    "  name: '@deepseek-ai/dsh-user-interaction'",
    '- id: llm-replay',
    "  name: '@deepseek-ai/dsh-llm-replay'",
    '  config:',
    `    file: ${JSON.stringify(fixturePath)}`,
    '    providers:',
    '      - id: deepseek-official',
    '        models:',
    '          - id: deepseek-v4-flash',
    '            contextWindow: 128000',
    // tui-runner 的 inject 全量要求 sessions/agents/agentDefaultModel/goals/
    // subagents：spine 开 goals，default-model 与 subagent 对齐 dsh-base bundle。
    '- id: agent-n',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: deepseek-official',
    '    model: deepseek-v4-flash',
    '- id: subagent',
    "  name: '@deepseek-ai/dsh-subagent'",
    '- id: agent-spine',
    "  name: '@deepseek-ai/dsh-agent-spine-demo'",
    '  config:',
    '    agents:',
    '      - id: main',
    '        provider: deepseek-official',
    '        model: deepseek-v4-flash',
    `        cwd: ${JSON.stringify(root)}`,
    '    goals: {}',
    '    workspaceContext:',
    '      maxBytes: 65536',
    '    persona: |',
    '      You are the tui composition-test agent, powered by the {{model}} model.',
    '- id: tui-runner',
    "  name: '@deepseek-ai/dsh-tui'",
    '',
  ].join('\n'))

  // 终端边界替换发生在模块面：真实 apply 收到注入的 fake 流（TuiRunnerConfig
  // 本就为测试替身预留了 stdin/stdout 字段），其余装配原样走 Loader。
  const wrappedTui: typeof Tui = {
    ...Tui,
    apply: (ctx, config) => {
      tuiCtx = ctx
      Tui.apply(ctx, { ...config, stdin: stdin.stream, stdout: stdout.stream })
    },
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-local', SettingsLocal],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@deepseek-ai/dsh-user-approval', UserApproval],
    ['@deepseek-ai/dsh-user-interaction', UserInteraction],
    ['@deepseek-ai/dsh-llm-replay', LlmReplay],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel],
    ['@deepseek-ai/dsh-subagent', Subagent],
    ['@deepseek-ai/dsh-agent-spine-demo', AgentSpine],
    ['@deepseek-ai/dsh-tui', wrappedTui],
  ])

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  return {
    ctx,
    stdout,
    stdin,
    tuiCtx: () => {
      if (tuiCtx === undefined) throw new Error('tui-runner never mounted through the Loader')
      return tuiCtx
    },
  }
}

describe('tui real Loader composition through cordis.yml', () => {
  it('mounts over the real spine, renders on events, and releases every listener on fiber dispose', async () => {
    const { ctx, stdout, stdin, tuiCtx } = await boot()

    // attach 是 runner 内的异步路径：以首帧渲染为完成判据（启动 context bar +
    // 输入行占位符都到 fake stdout）。
    await vi.waitFor(() => {
      expect(stdout.text()).toContain('📁')
      expect(stdout.text()).toContain('询问任何事')
    }, { timeout: 10_000 })

    // 终端接管：raw-mode 已开启。
    expect(stdin.rawModeCalls).toContain(true)

    // 控制断言：挂载期间真实键入经 InputHandler → 输入行回显 → 渲染调度
    // 产生新写入（写批合并 16ms，故 waitFor）——证明渲染链路真实在线，
    // 后面的"写静默"才有判别力。workflow/start 同时喂入（面板隐藏时不渲染，
    // 仅进状态缓存），供 dispose 后对照同一事件不再有任何监听器消费。
    const beforeLive = stdout.writes()
    stdin.stream.emit('data', 'a')
    ctx.emit('workflow/start', { id: WorkflowRunId('wf-live'), meta: { name: 'wf', description: 'wf' } })
    await vi.waitFor(() => {
      expect(stdout.writes()).toBeGreaterThan(beforeLive)
    }, { timeout: 5_000 })

    // 选择性 dispose：只拆 tui-runner fiber，服务树保持运行。
    await tuiCtx().fiber.dispose()

    // raw-mode 对称恢复（InputHandler.dispose 的 isTTY 分支）。
    expect(stdin.rawModeCalls.at(-1)).toBe(false)

    // 写静默：dispose 后键入与 subagent/workflow 事件都不再触发渲染调度，
    // ticker 已停（窗口 > 120ms ticker 周期 + 16ms 批合并）。subagent/start
    // 是 scope 过滤事件——按 wire 契约带 scope 载体分发（未键定的广播载体）。
    // 事件 map 的 merge-extensible fallback 重载使类型化 emit 推不出真实
    // payload 形状（同 dsh-subagent invariant.spec 的 emitRun），显式断言到
    // 宽松派发签名（SubagentRunInfo 字面量保证形状正确）。
    const afterDispose = stdout.writes()
    stdin.stream.emit('data', 'b')
    ctx.emit('workflow/start', { id: WorkflowRunId('wf-after'), meta: { name: 'wf', description: 'wf' } })
    // 直接按 Scoped 重载派发（scopeTarget 返回 phantom Scoped，结构兼容）。
    // @ts-expect-error -- 重载 2 的 thisArg 为 NoInfer<ThisType<...>>，Scoped 泛型不匹配
    ctx.emit(scopeTarget(ctx, undefined), 'subagent/start', {
      runId: SubagentRunId('run-after'),
      provider: 'spawn',
      id: SessionId('child-after'),
      local: true,
    })
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(stdout.writes()).toBe(afterDispose)
  }, 30_000)

  // C4 认领的 disposer 缺陷（dsh-tui-拆分方案-c4.md Wave 1 #6 / Wave 3）：
  // 落地后翻绿这两条，组合线即是它们的拦截层。
  it.todo('fiber dispose 后重挂载 tui-runner 不抛 DUPLICATE_PROVIDER（interactionDisposer 随 dispose 释放）')
  it.todo('切会话结算挂起审批/提问（跨会话残留归零，approval fail-closed / question ASK_CANCELLED）')
})
