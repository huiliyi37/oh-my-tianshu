/**
 * evidence-gate.e2e.ts — 真实装配验证：evidence-gate 插件在真实 Loader 树中
 * 加载 + 任务边界接线（DSH_EVIDENCE_DEMO=1 建义务/supersede）可运行 +
 * 不破坏既有 keyless 冒烟（bash 工具不受证据门误拦）。
 *
 * 注：dsh 演示装配不含编辑工具（edit_file 由宿主提供）——L1 编辑门拦截的
 * 行为级验证由包级 integration.spec 承担（mock tools 服务，真实 cordis ctx）。
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@huiliyi37/dsh-loader-smoke'
import type { SessionEvent } from '@huiliyi37/dsh-session'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cli.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('evidence-gate 真实装配', () => {
  it('任务边界接线（建义务+作废）可运行，bash 工具不被误拦', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-evidence',
      tempDirPrefix: 'headless-agent-evidence-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      env: { DSH_EVIDENCE_DEMO: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    // bash 工具调用成功（evidence-gate 装配不误拦非编辑工具）
    const bashResult = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result'
      && event.data.message.content[0]?.type === 'tool-result')
    expect(bashResult).toBeDefined()
    expect(bashResult!.data.message.content[0]?.isError).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('无义务默认路径：keyless 冒烟基线不受 evidence-gate 影响', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-evidence-idle',
      tempDirPrefix: 'headless-agent-evidence-idle-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'bash')).toBe(true)
    expect(events.at(-1)).toBeDefined()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

describe('证据门 × 原生编辑工具（真实装配闭环）', () => {
  it('有义务时 agent 的 str_replace_editor 写操作被 L1 门拦截（isError 含 evidence gate）', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-evidence-edit',
      tempDirPrefix: 'headless-agent-evidence-edit-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, '修复 demo 缺陷'],
      tsconfigPath,
      env: { DSH_EVIDENCE_DEMO: '1', DSH_CLI_MOCK_EDIT: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    // agent 调用原生编辑工具（写操作）
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'str_replace_editor')).toBe(true)
    // L1 门拒绝：tool/result isError 且文本含 evidence gate 拦截消息
    const rejected = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result'
      && event.data.message.content[0]?.type === 'tool-result'
      && event.data.message.content[0]?.isError === true)
    expect(rejected).toBeDefined()
    const text = rejected!.data.message.content[0].content
      .filter(b => b.type === 'text').map(b => b.text).join('\n')
    expect(text).toContain('evidence gate')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('无义务时编辑不被拦（读操作 view 也不拦）', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent-evidence-idle',
      tempDirPrefix: 'headless-agent-evidence-idle-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      env: { DSH_CLI_MOCK_EDIT: '1' },
    })
    expect(stderr).toBe('')
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const rejected = events.find((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result'
      && event.data.message.content[0]?.type === 'tool-result'
      && event.data.message.content[0]?.content?.some(b => b.type === 'text'
        && b.text.includes('evidence gate')))
    expect(rejected).toBeUndefined()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
