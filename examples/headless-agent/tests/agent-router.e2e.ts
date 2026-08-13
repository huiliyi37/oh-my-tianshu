/**
 * agent-router.e2e.ts — 真实装配验证：agent-router 插件在真实 Loader 树中加载 +
 * 连败模式触发 prediction escalate → 路由决策 delegate（driver 打印 router_state）。
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

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
    // 真实派发成功：driver 打印 router_dispatched，子代理 sessionId 带前缀
    const dispatched = lines.find(line => line['type'] === 'router_dispatched')
    expect(dispatched).toBeDefined()
    const subagentId = dispatched!['subagentId'] as string
    expect(subagentId.startsWith('session-router-')).toBe(true)
    expect(lines.find(line => line['type'] === 'router_dispatch_failed')).toBeUndefined()
    // 子代理真实完成一轮（mock 分支产物经 forwardAllSessions 转发可见）：
    // tool-call 触发 bash printf SUBAGENT_ROUND_TRIP，收到结果后回复 SUBAGENT DONE。
    expect(stdout).toContain('SUBAGENT_ROUND_TRIP')
    expect(stdout).toContain('SUBAGENT DONE')
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
})
