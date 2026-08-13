// Boots the shipped Web composition over the built dist this lane already uses
// and asserts what that composition produces: the model-visible tool catalog
// and the sandbox/approval knobs it ships with. No browser and no model call —
// these are composition facts, and the browser scenarios in this lane cover the
// surface itself.
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the tools/sandboxPolicy/approval Context merges.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission'
import type {} from '@deepseek-ai/dsh-commands'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

/**
 * The catalog the shipped Web composition puts in front of the model, minus the
 * ripgrep-dependent pair below. The absences are deliberate, not incidental
 * gaps: the `cordis_*` toolset executes model-written JavaScript that no
 * sandbox row confines, `web_fetch` chooses its own request target, and
 * `mcp_*` servers spawn outside `ctx.bash`. The composition Agent Note owns the
 * rationale and its sources.
 */
const EXPECTED_TOOLS = [
  'ask_user_question',
  'bash',
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'interrupt_agent',
  'list_agents',
  'ralph',
  'read',
  'send_message',
  'skill',
  'str_replace_editor',
  'subagent',
  'subagent_fork',
  'task_kill',
  'task_list',
  'task_output',
  'todo_write',
  'update_goal',
  'web_search',
  'workflow',
  'write',
]

/**
 * `glob` and `grep` come from `dsh-tool-fs-search`, which spawns the PACKAGED
 * ripgrep binary (`@vscode/ripgrep`) through the subprocess seam, so the pair
 * is always present on every host — asserted as fixed members, not a host
 * dependency.
 */
const RIPGREP_TOOLS = ['glob', 'grep']

let scaffold: WebScaffold | undefined

afterEach(async () => {
  await scaffold?.close()
  scaffold = undefined
})

it('assembles the shipped Web catalog with the confined access default', async () => {
  scaffold = await launchWebScaffold()
  const names = scaffold.ctx.tools.schemas().map(schema => schema.name).sort()
  expect(names.filter(name => !RIPGREP_TOOLS.includes(name))).toEqual(EXPECTED_TOOLS)
  // The packaged ripgrep binary ships with the dependency, so the pair is a
  // fixed roster member on every host.
  expect(names.filter(name => RIPGREP_TOOLS.includes(name))).toEqual(RIPGREP_TOOLS)
  // `workspace-write` is not "the workspace and nothing else": the shared roots
  // helper always admits the temp directories too. Pinning it against an
  // explicit mode keeps the claim independent of this surface's default, and
  // keeps a future boundary test from being run inside /tmp — where an
  // "escape" write succeeds by design and reads as a sandbox failure.
  expect(writableRoots(scaffold.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }))).toEqual(
    expect.arrayContaining([canonicalPath('/tmp'), canonicalPath(tmpdir())]),
  )
  expect(scaffold.ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
  expect(scaffold.ctx.approval.config.policy).toBe('ask')
  expect(scaffold.ctx.permission.defaultPreset).toBe('workspace-write')

  const handle = await scaffold.ctx.agents.create({
    sessionId: SessionId('shipped-command-catalog'),
    meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  try {
    expect(scaffold.ctx.commands.list(handle.agent)).toContainEqual({
      name: 'feedback',
      description: 'record feedback about this session',
      input: { hint: '<text>' },
    })
  } finally {
    await handle.dispose()
  }
}, 120_000)
