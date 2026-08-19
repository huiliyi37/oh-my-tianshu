# @huiliyi37/dsh-tool-run-tests

[English](README.md) | 中文

面向模型的测试运行面，而非执行策略：`run_tests` 通过 `ctx.bash` seam 执行工作区检测到的测试框架，返回机器可读的通过/失败计数；`related_tests` 按文件名约定列出某个源路径附近的测试文件。两个工具只产生常规的 `tool/call`/`tool/result` 会话事件，因此 evidence-gate 无需新通道即可把 `run_tests` 运行归账为验证证据；显式 `command` 走既有命令归账路径，仅传路径的调用合成 `run_tests <paths…>` 记录，裸调用合成 `run_tests`。

## 配置

```yaml
- id: tool-run-tests
  name: '@huiliyi37/dsh-tool-run-tests'
  config:
    commandOverrides: {}   # framework id → command base; replaces one DEFAULT_COMMANDS entry
    outputTailChars: 8000  # default; characters of combined output kept in `tail`
    enableRunInBackground: true  # default; false also rejects run_in_background calls
```

`outputTailChars` 在插件加载时即响亮失败：除整数 >= 1 以外的任何值都会抛错，绝不静默回退。每个 `commandOverrides` 键都必须是已知框架 id（`vitest | jest | mocha | npm | pytest | go`），每个值都必须非空；两类违规都会在加载时抛错。

## 工具

### run_tests

- **显式 `command`** 优先。此时 runner 未知，摘要解析器会依次尝试所有已知框架的摘要格式，保留第一个非 null 的结果。
- **框架检测**只读取工作区元数据：先查 package.json 的 runner 依赖，再查其 `test` 脚本，然后查 pytest 标记（`pyproject.toml` / `pytest.ini` / `conftest.py`），最后查 `go.mod`，并据此组合 `DEFAULT_COMMANDS` 与所选 `path` 条目（`npm test` 在 `--` 之后传入路径；`go test` 接收包目录）。检测与执行都锚定到调用方会话的 cwd；非 agent（智能体）调用方回退到进程 cwd。
- **非零退出作为结果报告，不是错误。** 规范值是一个 `foreground`/`background` 联合；前台分支携带 `command`、`exitCode`、可空的 `passed`/`failed`/`total`（null = 摘要未识别）以及有界的 `tail`（stdout + 带标记的 stderr + 退出标记）。
- **`run_in_background: true`** 会向 `ctx.tasks` 注册一个 `run-tests` 生产方（该包声明自己的 `TaskKindMap` 条目）并返回 `{ kind: 'background', taskId }`；用 `task_output` 读取输出，用 `task_kill` 停止。任务运行时缺失或禁用时，调用会响亮失败。
- **UI 渲染意图**：`terminal`（命令作为卡片标题；完成时展示输出尾部与退出状态 pill）；后台分支渲染通用确认卡片。

### related_tests

- **启发式，绝不解析代码。** 对于文件：同目录的 `<stem>.(test|spec).<ext>` 与 `_test` 变体、文件旁的 `__tests__`/`tests`/`test` 目录，以及相对目录在根部的 `tests`/`test` 镜像；对于目录：收集直接位于其中的测试文件。只返回真实存在的文件，去重后最多 20 个。解析到会话 cwd 之外的路径会响亮失败。
- **UI 渲染意图**：`generic`，调用时把目标作为跟随位置（follow-along location）。

## 模型体验

### 模型看到的内容

模型会看到两个新工具及其 schema 与说明。`run_tests` 告知模型优先使用它而非 bash，因为验证门禁会对结果归账；`related_tests` 提供有界的文件名约定清单。

### Token 影响

`run_tests` 的结果是有界的 `tail`（上限为 `outputTailChars`）外加一行摘要；无界的命令输出不会进入上下文。`related_tests` 最多返回 20 个路径。

### KV Cache 影响

工具结果仅追加；不存在任何请求塑形行为。

## 已知限制与延期工作

- **仅启发式发现与解析**：`related_tests` 遵循文件名约定，会漏掉不遵循约定的测试布局；摘要解析只识别 vitest/jest/mocha/pytest/go 的摘要行，其余情况返回 null 计数（退出码仍会报告结果）。
- **检测读取元数据文件，而非 lockfile**：若工作区的 runner 只存在于 `pnpm-lock.yaml` 且没有 package.json 依赖条目，则回退到 `npm test`，或检测不到框架。
- **不引入任何测试框架**：工具从不解析或执行框架代码；`npx <runner>` 命令要求 runner 在部署环境中可达。
- **后台运行不报告通过/失败计数**：工具只返回 task id；测试套件自身的输出通过 `task_output` 读取。
- **evidence-gate 合成的记录是 `run_tests` 或 `run_tests <paths…>`**：裸调用（无 `command`、无 `path`）和仅传路径的调用都归类为测试运行；两者都不携带解析后的框架命令。只传路径且框架无法检测的调用会在执行前失败，因此任何未分类的运行都不会被执行。
- **发现范围停在会话 cwd 之内**：`related_tests` 拒绝解析到工作区之外的目标；探测仍走进程内 `fs` 而非 `ctx.fs`，因此沿符号链接走出根目录仍是残留漏洞。
