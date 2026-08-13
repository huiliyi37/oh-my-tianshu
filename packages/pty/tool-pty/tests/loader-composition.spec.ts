import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include from '@huiliyi37/cordis-plugin-include'
import { CallId } from '@huiliyi37/dsh-llm'
import { Session, SessionId } from '@huiliyi37/dsh-session'
import AgentRegistry, { Inbox } from '@huiliyi37/dsh-agent'
import type { Agent } from '@huiliyi37/dsh-agent'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry from '@huiliyi37/dsh-tools'
import PtyService from '@huiliyi37/dsh-pty'
import SandboxProvider from '@huiliyi37/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@huiliyi37/dsh-sandbox'
import SandboxPolicyService from '@huiliyi37/dsh-sandbox-policy'
import LocalSubprocessService from '@huiliyi37/dsh-subprocess-local'
import * as PtyLocal from '@huiliyi37/dsh-pty-local'
import * as ToolPty from '@huiliyi37/dsh-tool-pty'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@huiliyi37/dsh-agent'",
      "- name: '@huiliyi37/dsh-system-prompt'",
      "- name: '@huiliyi37/dsh-tools'",
      "- name: '@huiliyi37/dsh-pty'",
      "- name: '@huiliyi37/dsh-test-sandbox'",
      "- name: '@huiliyi37/dsh-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@huiliyi37/dsh-subprocess-local'",
      "- name: '@huiliyi37/dsh-pty-local'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@huiliyi37/dsh-tool-pty'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@huiliyi37/dsh-agent', AgentRegistry],
      ['@huiliyi37/dsh-system-prompt', SystemPrompt],
      ['@huiliyi37/dsh-tools', ToolRegistry],
      ['@huiliyi37/dsh-pty', PtyService],
      ['@huiliyi37/dsh-test-sandbox', PassthroughSandbox],
      ['@huiliyi37/dsh-sandbox-policy', SandboxPolicyService],
      ['@huiliyi37/dsh-subprocess-local', LocalSubprocessService],
      ['@huiliyi37/dsh-pty-local', PtyLocal],
      ['@huiliyi37/dsh-tool-pty', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: CallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: CallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: CallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.pty.list(owner)).toHaveLength(1)
  }, 15_000)
})
