/**
 * Human-facing `/remember` and `/memory` commands over the optional memory seam.
 * Design contract: `.agents/notes/implemented/feature/2026-08-18-command-memory.md`.
 * @module @huiliyi37/dsh-command-memory
 */

import type { Context } from '@huiliyi37/cordis'
import type { CommandInvocation, CommandResult } from '@huiliyi37/dsh-commands'

export const name = 'command-memory'
export const inject = ['commands']

const UNAVAILABLE = '⚠ memory 服务不可用（未加载 memory 插件）'

/** One `/memory` list line flattens whitespace and caps the entry text at this length. */
const LIST_TEXT_LIMIT = 80

/** /remember、/memory 所需的最小 memory 服务面（不引入 dsh-memory 依赖；
 *  reflect.get 动态解析——未装配 memory 插件的组合仍发现命令并收到不可用提示）。 */
interface MemoryFacet {
  save(entry: { text: string; scope: string; tags: string[]; source: string }): Promise<{ id: string }>
  list(opts?: { scope?: string; limit?: number }): Promise<Array<{ id: string; text: string; tags: string[]; createdAt: number }>>
  delete(id: string): Promise<void>
}

/** Resolve the optional memory service at handler time; absent means the composition mounted no memory plugin. */
function resolveMemory(ctx: Context): MemoryFacet | undefined {
  return ctx.reflect.get('memory', false) as MemoryFacet | undefined
}

/** Collapse one entry's text into a deterministic single-line summary for the `/memory` list. */
function summarize(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= LIST_TEXT_LIMIT ? flat : `${flat.slice(0, LIST_TEXT_LIMIT)}…`
}

/** Execute `/remember <text>`: save one global-scope user memory entry. */
async function executeRemember(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const memory = resolveMemory(ctx)
  if (memory === undefined) return { kind: 'error', text: UNAVAILABLE }
  const content = invocation.rawInput.trim()
  if (content === '') return { kind: 'error', text: '用法: /remember <text>' }
  const entry = await memory.save({ text: content, scope: 'global', tags: [], source: 'user' })
  return { kind: 'success', text: `已保存记忆: ${entry.id}` }
}

/** Execute `/memory [delete <id>]`: list entries, or delete one by id. */
async function executeMemory(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const memory = resolveMemory(ctx)
  if (memory === undefined) return { kind: 'error', text: UNAVAILABLE }
  const text = invocation.rawInput.trim()
  /* v8 ignore next -- split(/\s+/) 恒返回非空数组，[0] 必有值；noUncheckedIndexedAccess 收窄防御 */
  const sub = text.split(/\s+/)[0] ?? ''
  if (sub === 'delete') {
    const id = text.slice(sub.length).trim()
    if (id === '') return { kind: 'error', text: '用法: /memory delete <id>' }
    await memory.delete(id)
    return { kind: 'success', text: `已删除记忆: ${id}` }
  }
  if (sub !== '') return { kind: 'error', text: '用法: /memory [delete <id>]' }
  const entries = await memory.list({})
  if (entries.length === 0) return { kind: 'success', text: '暂无记忆' }
  return { kind: 'success', text: entries.map(entry => `- ${entry.id}: ${summarize(entry.text)}`).join('\n') }
}

/**
 * Register `/remember` and `/memory` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'remember',
    description: 'Save a project memory entry (writes .dsh/memory/global.md)',
    input: { hint: '<text>' },
    handler: invocation => executeRemember(ctx, invocation),
  })
  ctx.commands.register({
    name: 'memory',
    description: 'List saved memories; delete <id> removes one',
    input: { hint: '[delete <id>]' },
    handler: invocation => executeMemory(ctx, invocation),
  })
}
