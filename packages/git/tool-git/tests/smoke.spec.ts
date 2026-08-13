/**
 * 装配冒烟：真实 GitLocal + ToolGit 装配（不 mock），真实 git 仓库上经 `git`
 * 单工具执行 status/log/commit——端到端最小闭环。
 * @module dsh-tool-git/tests/smoke
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { Context } from '@huiliyi37/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CallId } from '@huiliyi37/dsh-llm'
import { GitLocal } from '@huiliyi37/dsh-git'
import ToolRegistry from '@huiliyi37/dsh-tools'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import * as ToolGit from '@huiliyi37/dsh-tool-git'

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(' ')}: ${String(stderr || error.message)}`))
      else resolve(stdout)
    })
  })
}

async function executeGit(ctx: Context, args: Record<string, unknown>): Promise<string> {
  const result = await ctx.tools.execute({
    callId: CallId('smoke-git'),
    name: 'git',
    arguments: args,
    signal: new AbortController().signal,
  })
  return 'content' in result
    ? result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    : ''
}

describe('git 单工具装配冒烟（真实 GitLocal + 真实 git 仓库）', () => {
  let repo: string | undefined
  afterEach(async () => {
    if (repo !== undefined) await rm(repo, { recursive: true, force: true })
    repo = undefined
  })

  async function mount(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(GitLocal)
    await ctx.plugin(ToolGit)
    return ctx
  }

  async function initRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-toolgit-'))
    await runGit(dir, ['init', '-q', '-b', 'main'])
    await runGit(dir, ['config', 'user.name', 'test'])
    await runGit(dir, ['config', 'user.email', 'test@example.com'])
    return dir
  }

  it('status 在真实仓库返回 branch + clean', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first'])
    const ctx = await mount()
    const text = await executeGit(ctx, { operation: 'status', workdir: repo })
    expect(text).toContain('main')
    expect(text).toContain('clean')
  })

  it('log 在真实仓库列出提交', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first commit'])
    const ctx = await mount()
    const text = await executeGit(ctx, { operation: 'log', workdir: repo, maxCount: 5 })
    expect(text).toContain('first commit')
  })

  it('commit 在真实仓库完成提交，随后 status clean', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    const ctx = await mount()
    const commitText = await executeGit(ctx, { operation: 'commit', workdir: repo, message: 'add a.txt' })
    expect(commitText).toContain('committed')
    const statusText = await executeGit(ctx, { operation: 'status', workdir: repo })
    expect(statusText).toContain('clean')
  })
})
