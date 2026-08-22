/**
 * agent-router.e2e.ts — 真实装配验证：agent-router 插件在真实 Loader 树中加载 +
 * 连败模式触发 prediction escalate → 路由决策 delegate（driver 打印 router_state）。
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@huiliyi37/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cli.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('agent-router 真实装配（连败 → escalate → delegate）', () => {
  it('8 连败后路由决策为 delegate（metrics escalation + verifier）', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-router',
      tempDirPrefix: 'headless-agent-router-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      env: { DSH_CLI_MOCK_FAIL_LOOP: '1', DSH_ROUTER_DEMO: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    // 连败期间 bash 工具失败（dsh bash 非零退出码在文本 [exit code: 1]，isError 仍 false）
    const failResults = lines.filter(line => line['type'] === 'session_event'
      && (line['event'] as { type?: string })?.type === 'tool/result'
      && JSON.stringify(line).includes('[exit code: 1]'))
    expect(failResults.length).toBeGreaterThanOrEqual(3)
    // driver 打印 router_state：metrics.escalate + action delegate
    const routerState = lines.find(line => line['type'] === 'router_state')
    expect(routerState).toBeDefined()
    const metrics = routerState!['metrics'] as { interventionLevel: string }
    const action = routerState!['action'] as { kind: string; profile?: string }
    expect(metrics.interventionLevel).toBe('escalate')
    expect(action.kind).toBe('delegate')
    expect(action.profile).toBe('verifier')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('delegate 决策后真实派发 verifier 子代理（DSH_ROUTER_EXECUTE）', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-router-exec',
      tempDirPrefix: 'headless-agent-router-exec-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      env: { DSH_CLI_MOCK_FAIL_LOOP: '1', DSH_ROUTER_DEMO: '1', DSH_ROUTER_EXECUTE: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    // 决策仍为 escalate → delegate verifier（与第一用例一致，先决策后派发）
    const routerState = lines.find(line => line['type'] === 'router_state')
    expect(routerState).toBeDefined()
    const metrics = routerState!['metrics'] as { interventionLevel: string }
    const action = routerState!['action'] as { kind: string; profile?: string }
    expect(metrics.interventionLevel).toBe('escalate')
    expect(action.kind).toBe('delegate')
    expect(action.profile).toBe('verifier')
    // 真实派发成功：driver 打印 router_dispatched，子代理 sessionId 为 seam
    // 铸造的子会话 id（与主会话不同；血统断言由 subagent seam 自身测试钉住）
    const dispatched = lines.find(line => line['type'] === 'router_dispatched')
    expect(dispatched).toBeDefined()
    const subagentId = dispatched!['subagentId'] as string
    // seam 铸造的子会话 id（subagent-inprocess 用裸 UUID，非 session- 前缀）
    expect(subagentId.length).toBeGreaterThan(0)
    const firstEvent = lines.find(line => line['type'] === 'session_event')
    expect(firstEvent).toBeDefined()
    expect(subagentId).not.toBe(firstEvent!['sessionId'])
    expect(lines.find(line => line['type'] === 'router_dispatch_failed')).toBeUndefined()
    // 子代理真实完成一轮（Phase 3 结构化面）：structured_output 捕获 finding
    // 即该轮终点（router_dispatched stopReason completed 已断言）。
    expect(stdout).toContain('structured_output')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('正常路径（无连败）路由决策为 self', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-router-idle',
      tempDirPrefix: 'headless-agent-router-idle-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      env: { DSH_ROUTER_DEMO: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const routerState = lines.find(line => line['type'] === 'router_state')
    expect(routerState).toBeDefined()
    const action = routerState!['action'] as { kind: string }
    expect(action.kind).toBe('self')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('真实 turn/end 自动派发：插件自行 decide+dispatch，恰好一次且子代理完成一轮', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-router-auto',
      tempDirPrefix: 'headless-agent-router-auto-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the auto path'],
      tsconfigPath,
      env: {
        // 8 连败使首轮 turn/end 处于 escalate → 触发器自动派发 verifier 子代理
        DSH_CLI_MOCK_FAIL_LOOP: '1',
        DSH_ROUTER_AUTO: '1',
      },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const settled = lines.find(line => line['type'] === 'router_auto_settled')
    expect(settled).toBeDefined()
    // 恰好一次自动派发：1 route + 1 outcome + 恰一条 dispatched:true 决策
    expect(settled!['routes']).toBe(1)
    expect(settled!['outcomes']).toBe(1)
    expect(settled!['dispatchedDecisions']).toBe(1)
    // 结构化 finding：子代理 structured_output 捕获经父边界净化（换行折叠为
    // 单行）后入账 outcome——模型可见与日志持久逐字一致。
    expect(settled!['outcomeFinding']).toEqual({
      kind: 'verify',
      summary: '独立复核：主会话连败已复现 换行注入尝试',
      findings: ['bash exit 1 x8'],
      verdict: 'supported',
    })
    // 子代理真实完成一轮的证据即 outcome.finding 本身：structured 捕获到账并
    // 经父边界净化入账。route/outcome/decision 落在 runFixtureTurn 的事件转发
    // 窗口之后（turn-end 微任务出窗），由 settled 汇总行权威计数。
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
