/**
 * tool-git 单工具测试：operation 判别（status/diff/log/commit 合并进一个
 * `git` 工具）。FakeGit + 真实 ToolRegistry/SystemPrompt 装配（不 mock 中间层）。
 * @module dsh-tool-git/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Git, type GitStatusResult } from '@deepseek-ai/dsh-git'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolGit from '@deepseek-ai/dsh-tool-git'

/** 内存 FakeGit：可编程结果（consumer 单测用，不跑 git CLI）。 */
class FakeGit extends Git {
  results: Record<string, unknown> = {}
  calls: { method: string; cwd: string; args: unknown }[] = []

  stub(method: string, result: unknown): void {
    this.results[method] = result
  }

  override async status(cwd: string, opts?: { untracked?: boolean }): Promise<GitStatusResult> {
    this.calls.push({ method: 'status', cwd, args: opts })
    return this.results['status'] as GitStatusResult ?? { branch: 'main', dirty: false }
  }

  override async diff(cwd: string, opts?: { paths?: readonly string[]; stat?: boolean }): Promise<{ diff: string }> {
    this.calls.push({ method: 'diff', cwd, args: opts })
    return this.results['diff'] as { diff: string } ?? { diff: '' }
  }

  override async log(
    cwd: string,
    opts?: { maxCount?: number; paths?: readonly string[] },
  ): Promise<{ commits: readonly { hash: string; subject: string }[] }> {
    this.calls.push({ method: 'log', cwd, args: opts })
    return this.results['log'] as { commits: readonly { hash: string; subject: string }[] } ?? { commits: [] }
  }

  override async commit(cwd: string, opts: { message: string }): Promise<{ hash: string; summary: string }> {
    this.calls.push({ method: 'commit', cwd, args: opts })
    return this.results['commit'] as { hash: string; summary: string } ?? { hash: 'abc1234', summary: 'fix' }
  }
}

async function mount(): Promise<{ ctx: Context; git: FakeGit }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  // FakeGit extends Git —— Service 构造即注册 ctx.git。
  const git = new FakeGit(ctx)
  await ctx.plugin(ToolGit)
  return { ctx, git }
}

/** 执行 git 工具并返回渲染文本。 */
async function runGitTool(
  ctx: Context,
  args: Record<string, unknown>,
  agent?: { cwd?: string },
): Promise<{ text: string }> {
  const result = await ctx.tools.execute({
    callId: CallId('call-git'),
    name: 'git',
    arguments: args,
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent: { session: { header: { cwd: agent.cwd } } } as never },
  })
  const text = 'content' in result
    ? result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    : ''
  return { text }
}

describe('git 单工具（operation 判别）', () => {
  it('注册名为 git 的单一工具', async () => {
    const { ctx } = await mount()
    expect(ctx.tools.get('git')).toBeDefined()
  })

  it('status：cwd 从 session header 推导，渲染 branch/dirty', async () => {
    const { ctx, git } = await mount()
    git.stub('status', { branch: 'feat/x', dirty: true })
    const { text } = await runGitTool(ctx, { operation: 'status' }, { cwd: '/repo' })
    expect(git.calls[0]).toMatchObject({ method: 'status', cwd: '/repo' })
    expect(text).toContain('feat/x')
    expect(text).toContain('dirty')
  })

  it('status：workdir 参数优先于 session cwd', async () => {
    const { ctx, git } = await mount()
    const { text } = await runGitTool(ctx, { operation: 'status', workdir: '/other' }, { cwd: '/repo' })
    expect(git.calls[0]).toMatchObject({ method: 'status', cwd: '/other' })
    expect(text).toContain('main')
  })

  it('diff：paths/stat 透传，渲染 diff 文本', async () => {
    const { ctx, git } = await mount()
    git.stub('diff', { diff: '--- a.ts\n+++ b.ts\n' })
    const { text } = await runGitTool(ctx, { operation: 'diff', paths: ['a.ts'], stat: true }, { cwd: '/repo' })
    expect(git.calls[0]).toMatchObject({ method: 'diff', cwd: '/repo', args: { paths: ['a.ts'], stat: true } })
    expect(text).toContain('+++ b.ts')
  })

  it('log：maxCount 透传，默认 20，渲染 hash subject', async () => {
    const { ctx, git } = await mount()
    git.stub('log', { commits: [{ hash: 'abc1234', subject: 'first' }] })
    const { text } = await runGitTool(ctx, { operation: 'log' }, { cwd: '/repo' })
    expect(git.calls[0]).toMatchObject({ method: 'log', cwd: '/repo', args: { maxCount: 20 } })
    expect(text).toContain('abc1234 first')
  })

  it('commit：message 必填——缺失时 isError 结果', async () => {
    const { ctx } = await mount()
    const result = await ctx.tools.execute({
      callId: CallId('call-commit-empty'),
      name: 'git',
      arguments: { operation: 'commit' },
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: '/repo' } } } as never,
    })
    expect(result).toEqual(expect.objectContaining({ isError: true }))
  })

  it('commit：message 透传，渲染 committed summary', async () => {
    const { ctx, git } = await mount()
    git.stub('commit', { hash: 'deadbeef', summary: 'fix: x' })
    const { text } = await runGitTool(ctx, { operation: 'commit', message: 'fix: x' }, { cwd: '/repo' })
    expect(git.calls[0]).toMatchObject({ method: 'commit', cwd: '/repo', args: { message: 'fix: x' } })
    expect(text).toContain('committed fix: x')
  })

  it('commit 独占（isConcurrencySafe false），其余 operation 可并发', async () => {
    const { ctx } = await mount()
    const tool = ctx.tools.get('git')!
    expect(tool.isConcurrencySafe?.({ operation: 'status' })).toBe(true)
    expect(tool.isConcurrencySafe?.({ operation: 'commit' })).toBe(false)
  })

  it('未知 operation：报错', async () => {
    const { ctx } = await mount()
    const result = await ctx.tools.execute({
      callId: CallId('call-bad-op'),
      name: 'git',
      arguments: { operation: 'push' },
      signal: new AbortController().signal,
    })
    expect(result).toEqual(expect.objectContaining({ isError: true }))
  })

  it('无 agent 且无 workdir：回落进程 cwd（不崩）', async () => {
    const { ctx, git } = await mount()
    const { text } = await runGitTool(ctx, { operation: 'status' })
    expect(git.calls[0]!.cwd).toBeTypeOf('string')
    expect(text).toContain('main')
  })
})
