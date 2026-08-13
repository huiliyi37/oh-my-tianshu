# @huiliyi37/dsh-tool-git

[English](README.md) | 中文

**模型面向的 git 工具**——单个 `git` 工具 + `operation` 判别（`status` | `diff` | `log` | `commit`）。四个操作共用一个工具 schema，提示词占用保持最小（H1：Claude Code 原生 git 工具的对应物，C6 基准）。这是 git 接缝的消费层：拥有工具名、JSON schema、参数校验、prompt 引导与结果格式化，经 `ctx.git` provider 契约（[`@huiliyi37/dsh-git`](../git)）执行——工具从不直接接触 git 子进程。

## Config

```yaml
- id: tool-git
  name: '@huiliyi37/dsh-tool-git'
  config:
    enabled: true   # optional; false registers no tools (default true)
```

## Tool

`git` — 一个工具、四个操作（`operation` 字段选择）：

| operation | 相关参数 | 行为 |
|---|---|---|
| `status` | `workdir?` | 当前分支 + 工作区是否有未提交变更。 |
| `diff` | `workdir?`, `paths?`, `stat?` | 未提交 diff（全文，或 `--stat` 摘要；可 paths 限定）。 |
| `log` | `workdir?`, `maxCount?`（默认 20，上限 100）, `paths?` | 提交历史（`hash subject` 行）。 |
| `commit` | `workdir?`, `message`（必填，非空） | 暂存全部变更（`add -A`）并提交。 |

字段名 snake_case，与 Claude Code 及既有 harness 工具 schema 一致。`workdir` 默认取调用 agent 的会话 cwd（`exec.agent.session.header.cwd`），再回落进程 cwd。取消（工具 `exec.signal`）透传到 git 子进程。

`commit` 刻意独占（`isConcurrencySafe: false`），prompt 引导要求先用 `status`/`diff` 检查；commit 本身是 git 对象操作、不弹审批（与 Claude Code 同立场——文件变更仍走 fs 审批面）。

## Model Experience

### Tool schema

#### What the model sees

生成的 [`git` schema](../../../docs/tool-catalog.md#huiliyi37dsh-tool-git)：一个结构化工具覆盖仓库检查与提交——工作树、未提交 diff、历史、提交——经 `operation` 选择，外加说明各自适用时机的 prompt 引导段。四操作合一约省一半提示词占用（对比四个独立工具定义）。

#### Token effect

工具可见期间为固定 schema 成本。工具输出即 git 命令文本（diff/log 行），log 由 `maxCount` 限界；`--stat` 摘要选项让大 diff 预览便宜。

#### KV Cache effect

定义不变则前缀稳定；结果与其他 tool-result 一样追加。

## Known Limitations and Deferred Work

- 暂无 `show` / `branch` / `revert` 操作——随接缝按需扩展。
- `commit` 暂存一切（`add -A`）；按 paths 提交是未来选项。
- 工具假定解析出的 cwd 是 git 仓库；`NOT_A_REPOSITORY` 以错误工具结果呈现并附指引。
