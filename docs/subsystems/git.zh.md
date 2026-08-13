# Git

[English](git.md) | 中文

[`@huiliyi37/dsh-git`](../../packages/git/git) 拥有的类型化 git 能力接缝：抽象 `Git` 服务定义四个仓库操作（显式收 `cwd` 与取消信号），同包的 `GitLocal` provider 通过外部 `git` CLI 执行，并把失败映射为类型化 `GitError`。面向模型的 `git_status` / `git_diff` / `git_log` / `git_commit` 工具面由[工具包](../../packages/git/tool-git/README.md)拥有；provider 行为与错误映射由包 [README](../../packages/git/git/README.md) 拥有。

来源：[`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)

## 类型化失败

失败携带稳定的 `code` 供调用方分支路由，而非解析 message 文本（`NOT_A_REPOSITORY` 提示初始化；`EXEC_FAILED` 携带底层 cause）。

```ts type-equiv
/** git 失败的类型化错误码。 */
type GitErrorCode = 'NOT_A_REPOSITORY' | 'EXEC_FAILED'
```

## 结果形状

每个操作都返回解析后、可直接渲染给模型的结果——原始 porcelain 输出不越过接缝。

```ts type-equiv
/** `git status --porcelain --branch` 的解析结果。 */
interface GitStatusResult {
  /** 当前分支；detached HEAD 时 `HEAD`。 */
  branch: string
  /** 工作区/暂存区是否有未提交变更。 */
  dirty: boolean
}
```

```ts type-equiv
/** `git diff` 的解析结果（原始 diff 文本）。 */
interface GitDiffResult {
  /** diff 输出（stat 模式为 --stat 摘要，否则为完整 diff）。 */
  diff: string
}
```

```ts type-equiv
/** `git log --oneline` 的单条提交。 */
interface GitLogEntry {
  /** 短 hash（7 字符）。 */
  hash: string
  /** 提交主题行。 */
  subject: string
}
```

```ts type-equiv
/** `git commit` 的结果。 */
interface GitCommitResult {
  /** 完整 HEAD hash。 */
  hash: string
  /** 最新提交的 oneline（hash + subject）。 */
  summary: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis surface

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` surface lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgit--git-abstract-seam"></a>

### `ctx.git` — `Git` (abstract seam)

Git 能力接缝的服务定义。方法全部显式收 cwd（调用方从 session header 取）， `signal` 透传取消。

```ts cordis-catalog
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
```

Source: [`packages/git/git/src/index.ts:77`](../../packages/git/git/src/index.ts)
<!-- END GENERATED cordis-surface -->
