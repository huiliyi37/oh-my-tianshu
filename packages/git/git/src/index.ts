/**
 * Git capability seam：服务定义 + 本地 CLI provider 合一包（thin wrapper over git 子进程）。
 *
 * 与 fs（定义/实现/工具三包拆分）不同：git CLI 是稳定外部接口的薄封装，provider 角色
 * 不与定义独立演化——合一包，注释明示偏离三包惯例的理由。工具层（dsh-tool-git）只消费
 * `ctx.git` 服务，永不直接碰子进程。
 *
 * 方法均显式接收 `cwd`（调用方从会话 header 取，服务不猜）；`signal` 透传取消
 * （工具层 exec.signal）。
 *
 * @module @huiliyi37/dsh-git
 */

import { Service, type Context } from '@huiliyi37/cordis'
import { execFile } from 'node:child_process'

declare module '@huiliyi37/cordis' {
  interface Context {
    /** Git capability seam（dsh-tool-git 消费）。 */
    git: Git
  }
}

/** git 失败的类型化错误码。 */
export type GitErrorCode = 'NOT_A_REPOSITORY' | 'EXEC_FAILED'

/** git 失败的稳定错误；`code` 供工具层路由（如 NOT_A_REPOSITORY → 提示初始化）。 */
export class GitError extends Error {
  /** 类型化错误码，供调用方分支处理（不解析 message 文本）。 */
  readonly code: GitErrorCode
  constructor(code: GitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
    this.name = 'GitError'
  }
}

/** `git status --porcelain --branch` 的解析结果。 */
export interface GitStatusResult {
  /** 当前分支；detached HEAD 时 `HEAD`。 */
  branch: string
  /** 工作区/暂存区是否有未提交变更。 */
  dirty: boolean
}

/** `git diff` 的解析结果（原始 diff 文本）。 */
export interface GitDiffResult {
  /** diff 输出（stat 模式为 --stat 摘要，否则为完整 diff）。 */
  diff: string
}

/** `git log --oneline` 的单条提交。 */
export interface GitLogEntry {
  /** 短 hash（7 字符）。 */
  hash: string
  /** 提交主题行。 */
  subject: string
}

/** `git log` 的解析结果。 */
export interface GitLogResult {
  commits: readonly GitLogEntry[]
}

/** `git commit` 的结果。 */
export interface GitCommitResult {
  /** 完整 HEAD hash。 */
  hash: string
  /** 最新提交的 oneline（hash + subject）。 */
  summary: string
}

/**
 * Git 能力接缝的服务定义。方法全部显式收 cwd（调用方从 session header 取），
 * `signal` 透传取消。
 */
export abstract class Git extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * 工作区状态：分支 + 是否有未提交变更。
   * @param cwd - 目标仓库工作目录（调用方从 session header 取）。
   * @param opts - `untracked` 是否把未跟踪文件计入 dirty。
   * @param signal - 取消信号，透传到子进程。
   * @returns 分支名与 dirty 标志。
   */
  abstract status(cwd: string, opts?: { untracked?: boolean }, signal?: AbortSignal): Promise<GitStatusResult>

  /**
   * 工作区 diff（未暂存）；paths 限定文件，stat 输出 --stat 摘要。
   * @param cwd - 目标仓库工作目录。
   * @param opts - `paths` 限定文件集；`stat` 输出 --stat 摘要而非完整 diff。
   * @param signal - 取消信号，透传到子进程。
   * @returns 原始 diff（或 --stat 摘要）文本。
   */
  abstract diff(cwd: string, opts?: { paths?: readonly string[]; stat?: boolean }, signal?: AbortSignal): Promise<GitDiffResult>

  /**
   * 提交历史（oneline）；maxCount 默认 20，paths 限定文件。
   * @param cwd - 目标仓库工作目录。
   * @param opts - `maxCount` 条数上限（默认 20）；`paths` 限定文件集。
   * @param signal - 取消信号，透传到子进程。
   * @returns 解析后的提交列表（短 hash + 主题行）。
   */
  abstract log(cwd: string, opts?: { maxCount?: number; paths?: readonly string[] }, signal?: AbortSignal): Promise<GitLogResult>

  /**
   * 暂存全部变更并提交。
   * @param cwd - 目标仓库工作目录。
   * @param opts - `message` 提交信息（必填）。
   * @param signal - 取消信号，透传到子进程。
   * @returns 完整 HEAD hash 与最新提交的 oneline 摘要。
   */
  abstract commit(cwd: string, opts: { message: string }, signal?: AbortSignal): Promise<GitCommitResult>
}

/** GitLocal provider 配置。 */
export interface GitLocalConfig {
  /** git 可执行文件（默认 `git`；测试可注入）。 */
  gitBin?: string
}

/** 本地 git CLI provider：execFile 子进程执行，失败映射为 typed GitError。 */
export class GitLocal extends Git {
  private readonly gitBin: string

  /**
   * @param ctx - cordis context（服务注册）。
   * @param config - provider 配置（gitBin 缺省 `git`）。
   */
  constructor(ctx: Context, config: GitLocalConfig = {}) {
    super(ctx)
    this.gitBin = config.gitBin ?? 'git'
  }

  override async status(cwd: string, opts: { untracked?: boolean } = {}, signal?: AbortSignal): Promise<GitStatusResult> {
    const args = [
      'status', '--porcelain=v1', '--branch',
      ...(opts.untracked === false ? ['--untracked-files=no'] : []),
    ]
    const out = await this.run(cwd, args, signal)
    const lines = out.split('\n').filter(line => line !== '')
    const branchLine = lines.find(line => line.startsWith('## '))
    // `## main` / `## main...origin/main [ahead 1]` / `## HEAD (no branch)`
    const remotePart = branchLine?.slice(3).split('...')[0]
    const branch = branchLine === undefined ? 'HEAD' : (remotePart?.split(' ')[0] ?? 'HEAD')
    const dirty = lines.some(line => !line.startsWith('## '))
    return { branch, dirty }
  }

  override async diff(cwd: string, opts: { paths?: readonly string[]; stat?: boolean } = {}, signal?: AbortSignal): Promise<GitDiffResult> {
    const args = [
      'diff',
      ...(opts.stat === true ? ['--stat'] : []),
      ...(opts.paths !== undefined && opts.paths.length > 0 ? ['--', ...opts.paths] : []),
    ]
    const out = await this.run(cwd, args, signal)
    return { diff: out }
  }

  override async log(
    cwd: string,
    opts: { maxCount?: number; paths?: readonly string[] } = {},
    signal?: AbortSignal,
  ): Promise<GitLogResult> {
    const max = opts.maxCount ?? 20
    const args = [
      'log', '--oneline', '-n', String(max),
      ...(opts.paths !== undefined && opts.paths.length > 0 ? ['--', ...opts.paths] : []),
    ]
    const out = await this.run(cwd, args, signal)
    const commits = out.split('\n')
      .filter(line => line.trim() !== '')
      .map((line): GitLogEntry => {
        const space = line.indexOf(' ')
        return space === -1
          ? { hash: line, subject: '' }
          : { hash: line.slice(0, space), subject: line.slice(space + 1) }
      })
    return { commits }
  }

  override async commit(cwd: string, opts: { message: string }, signal?: AbortSignal): Promise<GitCommitResult> {
    if (opts.message.trim() === '') throw new GitError('EXEC_FAILED', 'git commit: message must not be empty')
    await this.run(cwd, ['add', '-A'], signal)
    await this.run(cwd, ['commit', '-m', opts.message], signal)
    const hash = (await this.run(cwd, ['rev-parse', 'HEAD'], signal)).trim()
    const summary = (await this.run(cwd, ['log', '-1', '--oneline'], signal)).trim()
    return { hash, summary }
  }

  private run(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.gitBin, args, { cwd, maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        const detail = stderr || error.message
        // git 报错随系统本地化变化（实测 2.50 中文环境输出「不是 git 仓库」）；
        // 英文与中文模式都匹配，避免依赖单一语言。
        if (/not a git repository|不是 git 仓库/i.test(detail)) {
          reject(new GitError('NOT_A_REPOSITORY', `not a git repository at ${cwd}`, { cause: error }))
          return
        }
        reject(new GitError('EXEC_FAILED', `git ${args.join(' ')} failed: ${detail}`, { cause: error }))
      })
    })
  }
}

/**
 * Cordis 插件入口：default 导出 provider 类（与 fs-local 同构——服务类即插件）。
 * 装配 `@huiliyi37/dsh-git` 时 Cordis new GitLocal(ctx) 并注册 `ctx.git`；
 * 包入口必须 default 导出（loader 取 default ?? module，namespace 对象不是插件）。
 */
export default GitLocal
