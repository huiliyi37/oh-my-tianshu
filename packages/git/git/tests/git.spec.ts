/**
 * Git 服务定义 + GitLocal 实现测试（行为测试）：
 * 1) FakeGit consumer 单测——服务方法签名/结果形状/参数透传；
 * 2) GitLocal 集成——真实 git CLI（tmpdir git init fixture，macOS/Linux 可回放）。
 * @module dsh-git/tests
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Git, GitError, GitLocal, type GitStatusResult } from '../src/index.ts'

/** 内存 FakeGit：记录调用 + 可编程结果（consumer 单测用，不跑 git CLI）。 */
class FakeGit extends Git {
  calls: { method: string; cwd: string; args: unknown }[] = []
  private results: Record<string, unknown> = {}

  constructor() {
    super(new Context())
  }

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
    return this.results['commit'] as { hash: string; summary: string } ?? { hash: 'abc1234', summary: 'commit' }
  }
}

describe('Git 服务面（FakeGit consumer）', () => {
  it('status 返回 branch + dirty 形状，cwd 透传', async () => {
    const git = new FakeGit()
    git.stub('status', { branch: 'feat/x', dirty: true })
    const result = await git.status('/repo', { untracked: false })
    expect(result).toEqual({ branch: 'feat/x', dirty: true })
    expect(git.calls[0]).toMatchObject({ method: 'status', cwd: '/repo', args: { untracked: false } })
  })

  it('diff 透传 paths/stat 参数', async () => {
    const git = new FakeGit()
    await git.diff('/repo', { paths: ['src/a.ts'], stat: true })
    expect(git.calls[0]).toMatchObject({ method: 'diff', args: { paths: ['src/a.ts'], stat: true } })
  })

  it('log 默认与显式 maxCount', async () => {
    const git = new FakeGit()
    await git.log('/repo')
    expect(git.calls[0]!.args).toEqual(undefined)
    await git.log('/repo', { maxCount: 5, paths: ['src'] })
    expect(git.calls[1]).toMatchObject({ method: 'log', args: { maxCount: 5, paths: ['src'] } })
  })

  it('commit 要求 message', async () => {
    const git = new FakeGit()
    await git.commit('/repo', { message: 'fix: x' })
    expect(git.calls[0]).toMatchObject({ method: 'commit', args: { message: 'fix: x' } })
  })
})

/** 建真实 git 仓库 fixture：init（显式 main 分支）+ 本地身份配置 + 首个提交。 */
async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-'))
  await runGit(dir, ['init', '-q', '-b', 'main'])
  await runGit(dir, ['config', 'user.name', 'test'])
  await runGit(dir, ['config', 'user.email', 'test@example.com'])
  return dir
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(' ')}: ${String(stderr || error.message)}`))
      else resolve(stdout)
    })
  })
}

describe('GitLocal（真实 git CLI 集成）', () => {
  let repo: string | undefined
  afterEach(async () => {
    if (repo !== undefined) await rm(repo, { recursive: true, force: true })
    repo = undefined
  })

  it('status：新仓库 clean，branch 正确', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first'])
    const git = new GitLocal(new Context())
    const status = await git.status(repo)
    expect(status.branch).toBe('main')
    expect(status.dirty).toBe(false)
  })

  it('status：改动后 dirty=true', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first'])
    await writeFile(join(repo, 'a.txt'), 'hello world\n')
    const git = new GitLocal(new Context())
    const status = await git.status(repo)
    expect(status.dirty).toBe(true)
  })

  it('diff：显示未暂存改动（stat 与全文）', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first'])
    await writeFile(join(repo, 'a.txt'), 'hello world\n')
    const git = new GitLocal(new Context())
    const stat = await git.diff(repo, { stat: true })
    expect(stat.diff).toContain('a.txt')
    const full = await git.diff(repo)
    expect(full.diff).toContain('+hello world')
  })

  it('log：按序返回 hash + subject', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'v1\n')
    await runGit(repo, ['add', 'a.txt'])
    await runGit(repo, ['commit', '-q', '-m', 'first commit'])
    const git = new GitLocal(new Context())
    const { commits } = await git.log(repo, { maxCount: 10 })
    expect(commits.length).toBe(1)
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{7,}$/)
    expect(commits[0]!.subject).toBe('first commit')
  })

  it('commit：add -A + commit，随后 status clean，hash 非空', async () => {
    repo = await initRepo()
    await writeFile(join(repo, 'a.txt'), 'hello\n')
    const git = new GitLocal(new Context())
    const result = await git.commit(repo, { message: 'add a.txt' })
    expect(result.hash).toMatch(/^[0-9a-f]{7,}$/)
    expect(result.summary).toContain('add a.txt')
    const status = await git.status(repo)
    expect(status.dirty).toBe(false)
  })

  it('非 git 仓库：NOT_A_REPOSITORY 错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-norepo-'))
    try {
      const git = new GitLocal(new Context())
      await expect(git.status(dir)).rejects.toMatchObject({ code: 'NOT_A_REPOSITORY' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('GitError 是 Error 实例且带 code', async () => {
    const error = new GitError('EXEC_FAILED', 'boom')
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('EXEC_FAILED')
  })
})
