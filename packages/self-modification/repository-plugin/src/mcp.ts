/**
 * Parser for the common `.mcp.json` file consumed by prepared repository plugins.
 * @module
 */

import { z } from 'zod'

/**
 * Restates dsh-mcp-client's `SERVER_NAME_PATTERN` rather than importing it:
 * the prepare bin must stay a zod-only module graph (no tools service, no MCP
 * SDK). Exported so `repository-plugin.spec.ts` pins equality with the
 * client's exported pattern — prepare-time validation cannot drift from the
 * registry that enforces uniqueness.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PLACEHOLDER_PATTERN = /\$\{([^}]*)\}/g

const stringMap = z.record(z.string(), z.string())
const stdioServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: stringMap.optional(),
}).strict()
const httpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1),
  headers: stringMap.optional(),
}).strict()
const documentSchema = z.object({
  mcpServers: z.record(z.string(), z.union([stdioServerSchema, httpServerSchema])),
}).strict()

/** One supported server entry from the common `.mcp.json` format. */
export type McpServerDefinition = z.infer<typeof stdioServerSchema> | z.infer<typeof httpServerSchema>

/** Parsed common MCP document before process-environment expansion. */
export interface McpDocument {
  mcpServers: Record<string, McpServerDefinition>
}

/** Resolved input handed to the existing `dsh-mcp-client` Config schema. */
export type ResolvedMcpServer =
  | {
    transport: 'stdio'
    serverName: string
    command: string
    args: string[]
    env: Record<string, string>
    cwd: string
    failOnStartupError: true
  }
  | {
    transport: 'streamable-http'
    serverName: string
    url: string
    headers: Record<string, string>
    failOnStartupError: true
  }

function assertTemplate(value: string, location: string): void {
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] as string
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`${location} contains an unsupported environment placeholder ${JSON.stringify(match[0])}`)
    }
  }
  if (value.replace(PLACEHOLDER_PATTERN, '').includes('${')) {
    throw new Error(`${location} contains an unterminated environment placeholder`)
  }
}

function visitStrings(serverName: string, definition: McpServerDefinition, visit: (value: string, location: string) => void): void {
  if ('command' in definition) {
    visit(definition.command, `mcpServers.${serverName}.command`)
    definition.args?.forEach((value, index) => { visit(value, `mcpServers.${serverName}.args[${index}]`) })
    Object.entries(definition.env ?? {}).forEach(([name, value]) => { visit(value, `mcpServers.${serverName}.env.${name}`) })
    return
  }
  visit(definition.url, `mcpServers.${serverName}.url`)
  Object.entries(definition.headers ?? {}).forEach(([name, value]) => { visit(value, `mcpServers.${serverName}.headers.${name}`) })
}

/**
 * Parse and validate one common `.mcp.json` document without resolving environment values.
 * @param content - UTF-8 JSON document.
 * @returns the supported stdio and Streamable HTTP server definitions.
 */
export function parseMcpDocument(content: string): McpDocument {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch (cause) {
    throw new Error('invalid .mcp.json: expected JSON', { cause })
  }
  const result = documentSchema.safeParse(value)
  if (!result.success) throw new Error(`invalid .mcp.json:\n${z.prettifyError(result.error)}`)
  for (const [serverName, definition] of Object.entries(result.data.mcpServers)) {
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      throw new Error(`invalid .mcp.json: server name ${JSON.stringify(serverName)} must match ${SERVER_NAME_PATTERN.source}`)
    }
    visitStrings(serverName, definition, assertTemplate)
  }
  return result.data
}

function expand(value: string, environment: NodeJS.ProcessEnv, location: string): string {
  return value.replace(PLACEHOLDER_PATTERN, (_placeholder, name: string) => {
    const replacement = environment[name]
    if (replacement === undefined) throw new Error(`${location} requires missing environment variable ${name}`)
    return replacement
  })
}

function expandMap(values: Record<string, string> | undefined, environment: NodeJS.ProcessEnv, location: string): Record<string, string> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([name, value]) => [
    name,
    expand(value, environment, `${location}.${name}`),
  ]))
}

/**
 * Resolve supported MCP definitions to inputs for the existing MCP client.
 * @param document - validated common MCP document.
 * @param environment - process environment used for exact `${NAME}` expansion.
 * @param cwd - prepared plugin directory used for stdio child processes.
 * @returns one existing-client config input per declared server.
 */
export function resolveMcpServers(document: McpDocument, environment: NodeJS.ProcessEnv, cwd: string): ResolvedMcpServer[] {
  return Object.entries(document.mcpServers).map(([serverName, definition]) => {
    if ('command' in definition) {
      return {
        transport: 'stdio',
        serverName,
        command: expand(definition.command, environment, `mcpServers.${serverName}.command`),
        args: (definition.args ?? []).map((value, index) => expand(value, environment, `mcpServers.${serverName}.args[${index}]`)),
        env: expandMap(definition.env, environment, `mcpServers.${serverName}.env`),
        cwd,
        failOnStartupError: true,
      }
    }
    const url = expand(definition.url, environment, `mcpServers.${serverName}.url`)
    const protocol = new URL(url).protocol
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`mcpServers.${serverName}.url must use http or https`)
    }
    return {
      transport: 'streamable-http',
      serverName,
      url,
      headers: expandMap(definition.headers, environment, `mcpServers.${serverName}.headers`),
      failOnStartupError: true,
    }
  })
}
