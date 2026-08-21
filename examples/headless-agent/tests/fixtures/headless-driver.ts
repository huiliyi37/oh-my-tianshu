#!/usr/bin/env node
/** Snapshot-only Loader driver: stream one fixture turn as canonical JSONL. */

import type { Context } from '@huiliyi37/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@huiliyi37/dsh-app-boot'
import { runFixtureTurn, type FixtureTurnResult } from '@huiliyi37/dsh-loader-smoke'
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
  const writeSessionEvent = (sessionId: string, event: SessionEvent): void => {
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId, event })}\n`)
  }
  const result = await runFixtureTurn(ctx, {
    task: taskParts.join(' '),
    onEvent: writeSessionEvent,
  })
  if (evidence !== undefined && process.env.DSH_EVIDENCE_DEMO === '1') {
    evidence.supersedeAll()
  }
  // agent-router 演示：DSH_ROUTER_DEMO=1 时打印路由决策；decide 为 delegate 且
  // DSH_ROUTER_EXECUTE=1 时真实派发子代理（verifier 真实 turn 验证）。
  const router = (ctx as Context & {
    router?: {
      metrics(options: { sessionId: string }): unknown
      decide(options: { sessionId: string }): { kind: string; profile?: string; task?: string; targets?: string[] } | undefined
      execute(
        action: { kind: string; profile?: string; task?: string; targets?: string[] },
        options: { sessionId: string },
      ): Promise<{ sessionId: string; stopReason: string } | null>
    }
    agents?: { list(): Array<{ session: { id: string } }> }
  }).router
  const mainAgent = (ctx as Context & { agents?: { list(): Array<{ session: { id: string } }> } }).agents?.list()[0]
  let finalResult: FixtureTurnResult = result
  if (router !== undefined && mainAgent !== undefined && process.env.DSH_ROUTER_DEMO === '1') {
    const sessionId = mainAgent.session.id
    const action = router.decide({ sessionId })
    process.stdout.write(`${JSON.stringify({ type: 'router_state', metrics: router.metrics({ sessionId }), action })}\n`)
    if (action !== undefined && process.env.DSH_ROUTER_EXECUTE === '1' && action.kind === 'delegate') {
      // 子代理会话事件转发：runFixtureTurn 的 onEvent 只转发主会话且 turn 结束即
      // 释放——子代理在 turn 后派发，事件无处进 stdout。此处注册一次监听，捕获
      // 非主会话（seam 子代理）的完整一轮（agent-router e2e 断言依赖）。
      // DSH_ROUTER_ADOPT_FOLLOWUP=1（synthesis 快照）时不过滤主会话：router/route
      // 与 router/outcome 是派发窗口内主会话的 log-only append，不过滤才进 transcript。
      const adoptFollowup = process.env.DSH_ROUTER_ADOPT_FOLLOWUP === '1'
      const mainSessionId = mainAgent.session.id
      const disposeSubagentListener = ctx.on('session/event', (session: { id: string }, event: SessionEvent) => {
        if (!adoptFollowup && session.id === mainSessionId) return
        writeSessionEvent(session.id, event)
      })
      let outcome: { sessionId: string; stopReason: string } | null = null
      try {
        outcome = await router.execute(action, { sessionId: mainSessionId })
        if (outcome !== null) {
          process.stdout.write(`${JSON.stringify({ type: 'router_dispatched', subagentId: outcome.sessionId, stopReason: outcome.stopReason })}\n`)
        }
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ type: 'router_dispatch_failed', error: error instanceof Error ? error.message : String(error) })}\n`)
      } finally {
        disposeSubagentListener()
      }
      // adopt 闭环：派发后主会话日志存在未综合 router/outcome——再跑一轮
      // followup，请求即渲染 synthesis 节（mock 据此调 router_adopt），工具
      // 落账 router/adoption 后下一轮收尾。followup 的 result 取代首轮成为
      // 终态记录（首轮 envelope 与 session 事件重复，快照只留一个 result）。
      if (outcome !== null && adoptFollowup) {
        finalResult = await runFixtureTurn(ctx, {
          task: 'Synthesize the dispatched subagent findings.',
          onEvent: writeSessionEvent,
        })
      }
    }
  }
  process.stdout.write(`${JSON.stringify(finalResult)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
