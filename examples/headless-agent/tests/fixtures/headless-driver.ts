#!/usr/bin/env node
/** Snapshot-only Loader driver: stream one fixture turn as canonical JSONL. */

import type { Context } from '@huiliyi37/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'
import { runFixtureTurn } from '@huiliyi37/dsh-loader-smoke'
import type { SessionEvent } from '@huiliyi37/dsh-session'

const NAME = 'headless-test-driver'
const [configPath, ...taskParts] = process.argv.slice(2)
if (configPath === undefined || taskParts.length === 0 || taskParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <task...>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  // evidence-gate 任务边界演示：DSH_EVIDENCE_DEMO=1 时，任务开始前创建 bugfix
  // 义务（targets 指向 mock 编辑目标），结束后作废未决义务。
  const evidence = (ctx as Context & { evidence?: { createObligation(input: unknown): void; supersedeAll(): void } }).evidence
  if (evidence !== undefined && process.env.DSH_EVIDENCE_DEMO === '1') {
    evidence.createObligation({
      family: 'bugfix',
      risk: 'high',
      claim: '修复 demo 缺陷',
      targets: ['src/placeholder.ts'],
    })
  }
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: (sessionId: string, event: SessionEvent) => {
      process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
    },
  })
  if (evidence !== undefined && process.env.DSH_EVIDENCE_DEMO === '1') {
    evidence.supersedeAll()
  }
  // agent-router 演示：DSH_ROUTER_DEMO=1 时打印路由决策；decide 为 delegate 且
  // DSH_ROUTER_EXECUTE=1 时真实派发子代理（verifier 真实 turn 验证）。
  const router = (ctx as Context & {
    router?: {
      metrics(): unknown
      decide(): { kind: string; profile?: string; task?: string; targets?: string[] } | undefined
      execute(action: { kind: string; profile?: string; task?: string; targets?: string[] }): Promise<unknown>
    }
  }).router
  if (router !== undefined && process.env.DSH_ROUTER_DEMO === '1') {
    const action = router.decide()
    process.stdout.write(`${JSON.stringify({ type: 'router_state', metrics: router.metrics(), action })}\n`)
    if (action !== undefined && process.env.DSH_ROUTER_EXECUTE === '1' && action.kind === 'delegate') {
      // 子代理会话事件转发：runFixtureTurn 的 onEvent 只转发主会话且 turn 结束即
      // 释放——子代理在 turn 后派发，事件无处进 stdout。此处注册一次不过滤的
      // 监听，捕获 session-router-* 会话的完整一轮（agent-router e2e 断言依赖）。
      const disposeSubagentListener = ctx.on('session/event', (session: { id: string }, event: SessionEvent) => {
        if (!session.id.startsWith('session-router-')) return
        process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: session.id, event })}\n`)
      })
      try {
        const subagentId = await router.execute(action)
        process.stdout.write(`${JSON.stringify({ type: 'router_dispatched', subagentId })}\n`)
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ type: 'router_dispatch_failed', error: error instanceof Error ? error.message : String(error) })}\n`)
      } finally {
        disposeSubagentListener()
      }
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
