import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRegistry } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionStore } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { apply, getFileHistory } from '../src/plugin.js'

let dir: string
let backupDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-snapshot-plugin-'))
  backupDir = join(dir, 'backups')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 最小装配：ctx + tools + sessions + 插件。 */
async function boot() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(apply, { backupDir })
  return ctx
}

function makeSession(ctx: Context, id: string): Session {
  return ctx.sessions.create(id as never, {})
}

/** 注册 stub 工具（真实 execute 路径，body 直接写文件或 no-op）。 */
function registerStub(ctx: Context, name: string, body: (args: Record<string, unknown>) => unknown): void {
  ctx.tools.register({
    name,
    description: `stub ${name}`,
    parameters: { path: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { result: { type: 'string' } },
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: (args: unknown) => Promise.resolve(body(args as Record<string, unknown>)),
  })
}

describe('fs-snapshot tools/execute 钩子', () => {
  it('写工具（write）执行前 trackEdit——生成磁盘备份', async () => {
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'v1', 'utf-8')
    const ctx = await boot()
    const session = makeSession(ctx, 's1')
    registerStub(ctx, 'write', (args) => {
      writeFileSync(String(args.path), String(args.content), 'utf-8')
      return 'ok'
    })

    await ctx.tools.execute({
      callId: 'call-1' as never,
      name: 'write',
      arguments: { path: target, content: 'v2' },
      agent: { session } as unknown as Agent,
      signal: new AbortController().signal,
    })

    const fh = getFileHistory(ctx, 's1')
    expect(fh).not.toBeUndefined()
    expect(fh!.hasSnapshot('call-1')).toBe(true)
    // 备份内容 = 编辑前状态
    const backup = fh!.getAllSnapshots()[0]!.trackedFileBackups[target]
    expect(backup?.backupFileName).toBeDefined()
    expect(readFileSync(join(backupDir, 's1', backup!.backupFileName!), 'utf-8')).toBe('v1')
  })

  it('str_replace_editor 写命令（str_replace）前 trackEdit；view 命令不触发', async () => {
    const target = join(dir, 'b.txt')
    writeFileSync(target, 'old', 'utf-8')
    const ctx = await boot()
    const session = makeSession(ctx, 's1')
    registerStub(ctx, 'str_replace_editor', (args) => {
      if (args.command === 'str_replace') writeFileSync(String(args.path), String(args.new_string), 'utf-8')
      return 'ok'
    })

    // view 命令：不改文件，不应快照（history 可能尚未创建，或存在但无该 call）
    await ctx.tools.execute({
      callId: 'call-view' as never,
      name: 'str_replace_editor',
      arguments: { command: 'view', path: target },
      agent: { session } as unknown as Agent,
      signal: new AbortController().signal,
    })
    const fhAfterView = getFileHistory(ctx, 's1')
    if (fhAfterView !== undefined) {
      expect(fhAfterView.hasSnapshot('call-view')).toBe(false)
    }

    // str_replace 命令：应快照
    await ctx.tools.execute({
      callId: 'call-replace' as never,
      name: 'str_replace_editor',
      arguments: { command: 'str_replace', path: target, old_string: 'old', new_string: 'new' },
      agent: { session } as unknown as Agent,
      signal: new AbortController().signal,
    })
    expect(getFileHistory(ctx, 's1')?.hasSnapshot('call-replace')).toBe(true)
  })

  it('非写工具（read）不触发快照', async () => {
    const ctx = await boot()
    const session = makeSession(ctx, 's1')
    registerStub(ctx, 'read', () => 'content')
    await ctx.tools.execute({
      callId: 'call-read' as never,
      name: 'read',
      arguments: { path: join(dir, 'x.txt') },
      agent: { session } as unknown as Agent,
      signal: new AbortController().signal,
    })
    expect(getFileHistory(ctx, 's1')).toBeUndefined() // 无写工具调用 → 无 FileHistory
  })
})
