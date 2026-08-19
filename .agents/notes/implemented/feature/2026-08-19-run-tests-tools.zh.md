# Agent Note: run_tests and related_tests tools

Status: implemented

[English](2026-08-19-run-tests-tools.md) | 中文

## Problem

omts 唯一的测试运行面就是手写命令的 `bash`：没有框架检测，没有机器可读的通过/失败计数，也没有针对「哪些测试覆盖了这个文件」的专用发现机制。opencode-tui 将 `run_tests`（结果解析 + 失败分类）与 `related_tests` 作为日常使用的内核工具随产品提供。二者建立在 omts 已拥有的 seam 之上，且以零新增通道为 evidence-gate 供数，因此适合落在本仓库。

## Decision

[`packages/tests/tool-run-tests`](../../../../packages/tests/tool-run-tests/README.md)（新的 `tests/` 分组）在 `ctx.tools` 上注册两个工具：

- **`run_tests`** 通过 `ctx.bash` seam 执行。显式 `command` 优先；否则框架检测只读取工作区元数据（package.json 的 runner 依赖 → `test` 脚本 → pytest 标记 → `go.mod`），并组合 `DEFAULT_COMMANDS` 与所选 `path` 条目。规范值是一个 `foreground`/`background` 联合：前台分支携带解析出的 `command`、`exitCode`、可空的 `passed`/`failed`/`total`（从框架摘要行解析；无法识别时为 null，此时退出码仍会报告结果），以及有界的 `tail`。`run_in_background` 会向 `ctx.tasks` 注册一个 `run-tests` 生产方（该包以声明合并方式声明自己的 `TaskKindMap` 条目）并返回 task id。
- **`related_tests`** 按文件名约定列出某个源路径附近的既有测试文件（同目录的 `<stem>.(test|spec).<ext>` 与 `_test` 变体、文件旁的 `__tests__`/`tests`/`test` 目录，以及根部的 `tests`/`test` 镜像），去重后最多 20 个。解析到会话 cwd 之外的目标会响亮失败；发现过程不会走出工作区。

框架检测与执行都锚定到调用方会话的 cwd。配置错误在加载时响亮失败（`outputTailChars` 为 >= 1 的整数；`commandOverrides` 的键必须是已知框架 id 且值非空）。UI 渲染意图预先确定：`run_tests` 是 `terminal` 卡片（后台分支为 generic），`related_tests` 是 `generic`，把目标作为跟随位置（follow-along location）。

**evidence-gate 交互：零新增通道。** `run_tests` 的 tool/call 与 tool/result 事件随普通会话事件流传输。显式 `command` 原样走既有命令归账路径；仅传路径的调用会合成一条 `run_tests <paths…>` 记录；裸调用（无 `command`、无 `path`）合成 `run_tests`。`run_tests` 加入 `TEST_COMMAND_RE`，使 `classifyVerification` 能识别每一次运行。不新增会话事件类型，不新增服务，也无须改动主循环。

## Alternatives considered

**整体移植 opencode-tui 的 `run_tests` 与失败分类器。** 否决：其解析器与 opencode-tui 的工具注册表和轨迹层耦合；omts 的 evidence-gate 已承担验证分类职责，因此该工具只需执行并上报结果，而非自行判定。

**通过 `dsh-code-runtime` 执行，而非 bash seam。** 否决：测试运行就是工作区里的 shell 命令，正是 bash seam 的约定；code-runtime 面向模型编写的程序，复用它会给同一份工作引入第二个执行身份。

**像 tool-bash 那样复用 `ctx.bashEnv`/沙箱升权。** 否决：测试命令既不需要升权面，也不需要托管环境；普通 bash 请求（command + workdir）使该工具的约定保持最小。模型仍可通过 `bash` 本身获得升权。

**让 evidence-gate 检查渲染后的 tool/result 文本来还原解析出的 command。** 否决：规范值本就携带 command；在 `tool/call` 时刻从 `path` 合成记录，使分类器的输入保持显式，也免去解析渲染后的正文。

## Consequences

- 两个新的面向模型工具加入日常使用面；与其他已注册工具一样，其 schema 会自动流入系统提示词组装。
- 框架检测以元数据为驱动且属启发式：只有 lockfile 的工作区会回退到 `npm test` 或检测不到框架（此时不带 `command` 的调用会响亮失败，而不是自行猜测）。
- 后台运行返回 task id 而非计数：测试套件的输出通过 `task_output` 读取；evidence-gate 在读取其结果之前不为其归账，因为归账只读取 `tool/result` 事件。
- `tests/` 分组纳入 `tsconfig.base.json` 的路径通配符与宿主 aggregate；基础 bundle 在 `tool-bash` 之后接入 `tool-run-tests`。根目录 `tsdown.config.ts` 不得沿用 tsdown 默认的 `**/test?(s)/**` workspace 排除，否则该包会被静默漏出 `lib/`，publint 失败。

## Testing

- `packages/tests/tool-run-tests/tests/tool-run-tests.spec.ts` — 纯检测器（框架顺序、命令模板（含 npm/go 特例）、各框架的摘要解析器、发现约定、`related_tests` 的工作区约束）与真实执行器集成（显式 command、从会话工作区检测框架、失败的测试套件、后台任务结算、related_tests、响亮失败的配置、越界路径拒绝）。
- `packages/tests/tool-run-tests/tests/evidence-accounting.spec.ts` — 组装好的 agent loop（智能体循环）：模型发出的 `run_tests` 调用经真实 bash 执行器执行，evidence-gate 的 `verificationCount()` 从会话流中为其归账。
- `packages/guard/evidence-gate/tests/integration.spec.ts` — 显式 command 归账、仅传路径的合成记录归账、裸调用（`{}`）归账，以及 `related_tests` 的负向用例（不归账）。

## Related

- [tool-JSON-in-content 修复插件](2026-08-19-tool-json-repair.md) — 同一档位的姊妹吸收项。
- [后台任务运行时](../architecture/2026-06-20-generic-long-running-tool-runtime.md) — 后台分支复用的 `ctx.tasks` 生产方约定。
