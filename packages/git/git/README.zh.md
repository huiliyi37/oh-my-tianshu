# @huiliyi37/dsh-git

[English](README.md) | 中文

**git 能力接缝**：`Git` 服务定义与 `GitLocal` CLI provider 合一包。`GitLocal` 以 `execFile` 调用 git 二进制（透传取消信号），失败映射为类型化 `GitError`（`NOT_A_REPOSITORY` / `EXEC_FAILED`）；定义与实现合一的原因：git CLI 是薄而稳定的包装，provider 角色不与定义独立演化（fs 家族拆三包是因为其本地/沙箱 provider 会独立演化）。

## Config

```yaml
- id: git
  name: '@huiliyi37/dsh-git'
  config:
    gitBin: git   # optional; git executable (default `git`; tests inject a stub)
```

`GitLocal` 经 Cordis `Service` 机制注册 `ctx.git`（`ctx.plugin(GitLocal)` 即插件化）。

## API

所有方法显式接收 `cwd`（调用方——如 `dsh-tool-git`——从会话 header 解析；服务不猜）与可选 `AbortSignal`（取消）：

| 方法 | git 命令 | 返回 |
|---|---|---|
| `status(cwd, { untracked? })` | `status --porcelain=v1 --branch` | `{ branch, dirty }` |
| `diff(cwd, { paths?, stat? })` | `diff [--stat] [-- <paths>]` | `{ diff }` |
| `log(cwd, { maxCount?, paths? })` | `log --oneline -n N [-- <paths>]` | `{ commits: [{ hash, subject }] }` |
| `commit(cwd, { message })` | `add -A` + `commit -m` | `{ hash, summary }` |

错误类型化：`GitError` 带 `code: 'NOT_A_REPOSITORY' | 'EXEC_FAILED'`。非仓库检测同时匹配英文与本地化 stderr（实测：git 2.50 中文系统输出「不是 git 仓库」）。

## Model Experience

间接——经 `dsh-tool-git` 的 `git` 工具；接缝本身不注册 prompt 或 schema。

#### KV Cache effect

无（接缝不面向模型；tool-result 渲染归 `dsh-tool-git`）。

## Known Limitations and Deferred Work

- 只读保证不强制：`commit` 会变更仓库（这是其目的）；`status`/`diff`/`log` 从不写入。
- 暂无 `git show` / `git branch` / `git revert`——首批为 status/diff/log/commit；按工具需求扩展接缝。
- 错误映射覆盖常见非仓库失败；其他 git 失败以 `EXEC_FAILED` 呈现并附 stderr。
