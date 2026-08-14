/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation. HMR hot-swaps by
 * disposing the old instance and creating a new one; identical `serverName`
 * reproduces identical public tool names.
 *
 * @module @huiliyi37/dsh-mcp-client
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { createTransport } from './transport.ts'
import { syncTools } from './tools.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@huiliyi37/dsh-tools'

export type { McpResult } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Valid `serverName`: 1–32 chars of `[A-Za-z0-9_-]`. Kept well under the
 * 64-char public-name budget so typical raw tool names survive unhashed.
 * Exported so upstream producers of Config inputs can reject the same names
 * this registry would.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per app, keyed off `ctx.root` (multiple apps
 * in one process — tests — must not see each other's names). A duplicate
 * namespace is a configuration error surfaced at plugin load, never silent
 * shadowing.
 */
const activeServerNames = new WeakMap<Context, Set<string>>()

// ---- Config ----

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
  }),
]) as unknown as z<Config>

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Reserve the namespace first: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`,
      )
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'mcp-client.serverName')

  const transport = createTransport(config)
  const client = new Client(
    { name: 'dsh-mcp-client', version: '0.0.1' },
    { capabilities: {} },
  )

  const opts = {
    registrationFailure: 'contain' as const,
    serverName: config.serverName,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }

  // Connect and set up tools. `ready` always settles to an outcome so rollback
  // can close a partially opened client even when strict startup later rejects.
  // Its accessor returns the CURRENT disposer generation, so disposal always
  // unregisters the live set, not the first one.
  const ready = (async () => {
    await client.connect(transport)

    let disposers = await syncTools(client, ctx, {
      ...opts,
      registrationFailure: config.failOnStartupError ? 'throw' : 'contain',
    }, new Map())

    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        ctx.logger.info(`mcp-client(${config.serverName}): tool list changed, re-syncing`)
        try {
          disposers = await syncTools(client, ctx, opts, disposers)
        } catch (error) {
          // Fetch-phase failure: the previous generation is still registered
          // and `disposers` still owns it — keep serving the last good list.
          ctx.logger.error(`mcp-client(${config.serverName}): tool re-sync failed: ${String(error)}`)
        }
      },
    )

    return { getDisposers: () => disposers }
  })().catch((error: unknown) => {
    ctx.logger.error(`mcp-client(${config.serverName}): startup failed: ${String(error)}`)
    return { getDisposers: () => { return new Map<string, () => void>() }, error }
  })

  ctx.effect(() => async () => {
    const outcome = await ready
    for (const dispose of outcome.getDisposers().values()) dispose()
    try { await client.close() } catch { /* transport already gone */ }
  }, 'mcp-client.connection')

  const outcome = await ready
  if ('error' in outcome && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }

  // 聚合状态表：所有 mcp-client 实例向 'mcp.status' 注册自己的 status（首个
  // 实例创建并提供；后续实例复用）。TUI /mcp 经 ctx.reflect.get('mcp.status')
  // 枚举全部 server——ReflectService 无 entries 枚举面，聚合表是唯一通道。
  // 工具名枚举来自 disposers 键（syncTools 只注册本 server 的 mcp__ 工具，
  // 随 re-sync 更新——实时读，不缓存）。
  const statusTable = ctx.reflect.get(MCP_STATUS_KEY, false) as
    | Map<string, McpServerStatus>
    | undefined
  if (statusTable === undefined) {
    ctx.provide(MCP_STATUS_KEY, new Map<string, McpServerStatus>())
  }
  const servers = ctx.reflect.get(MCP_STATUS_KEY, false) as Map<string, McpServerStatus>
  servers.set(config.serverName, {
    serverName: config.serverName,
    getToolCount(): number {
      return outcome.getDisposers().size
    },
    listToolNames(): string[] {
      return [...outcome.getDisposers().keys()]
    },
  })
  ctx.effect(() => () => {
    servers.delete(config.serverName)
  })
}

/** MCP server 状态聚合表键（'mcp.status'；TUI /mcp 经 reflect.get 读取）。 */
export const MCP_STATUS_KEY = 'mcp.status'

/** 单 server 的状态面（聚合表 value）。 */
export interface McpServerStatus {
  serverName: string
  getToolCount(): number
  listToolNames(): string[]
}

/**
 * Query connected MCP servers and their tool counts.
 * For use by TUI /mcp command: reads the `mcp.status` aggregation table
 * （mcp-client 实例在 apply 时注册；无实例/未装配返回空数组）。
 * @param ctx - 任意可见聚合表的上下文。
 * @returns 每个已连接服务器的名称与工具数；未装配 mcp-client 时为空数组。
 */
export function getMcpServerStatus(ctx: Context): Array<{ serverName: string; toolCount: number }> {
  const table = ctx.reflect.get(MCP_STATUS_KEY, false) as
    | Map<string, McpServerStatus>
    | undefined
  if (table === undefined) return []
  const result: Array<{ serverName: string; toolCount: number }> = []
  for (const status of table.values()) {
    result.push({ serverName: status.serverName, toolCount: status.getToolCount() })
  }
  return result
}
