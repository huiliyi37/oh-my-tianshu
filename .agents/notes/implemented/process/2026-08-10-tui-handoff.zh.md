# Agent Note: DSH TUI 交接记录

Status: implemented

[English](2026-08-10-tui-handoff.md) | 中文

## Problem

TUI 路线文档（`docs/dsh-tui-next-phase.md`）末尾留着一条没有任何单次会话能收完的尾巴：四个未实现功能（6.4 外部编辑器、6.5 Vim 模式、9d 流利度控制、Phase 8 approval answerer）、三个已实现但从未接入 `TuiApp` 的模块（5.3 glance-bar、9a mention-parser、9b restore-session），以及一道仓库级覆盖率门（`check:ci:coverage`，vitest perFile 100%，覆盖 statements、branches、functions、lines，含 `src/**`）。因此这项工作横跨数个会话，还有一个并行会话在改同一个 `app.ts`，每个会话都需要拿到上一个会话验证过的状态、留下的债务，以及它已经付过学费的陷阱——否则会话会重新推导已被证明的结论，或者重新踩一遍已经花掉几小时的坑。

计划本身也不能照单全收：council 评审对草案条目连否六轮，理由是其中关于代码库的判断存在事实错误。会话需要被交接的不是任务清单，而是证据——每条结论都带着确立它的命令与结果，每条未经验证的说法都明确标注为未验证。

## Decision

本文件就是这份记录：一处集中承载已验证状态、尚未收掉的债务和陷阱，并以现在时描述 TUI 当前的真实情况。结论附带其验证命令与结果；凡本地未实际执行的都显式说明，好让后续会话分得清哪些是已证明的行为、哪些是继承来的假设。

执行走规格先行的方向：`packages/tui/tui/tests/*.spec.ts` 中的 staged spec 是契约，也是唯一权威，实现随之补齐。当 staged spec 与已落地行为相矛盾时，改的是 spec，而不是把已落地行为掰过去。

会话边界上的范围刻意收窄。仓库级覆盖率门保留为明确点名的债务，不在功能会话里硬收；归并行 C3 会话所有的那些 `app.ts` 覆盖点，随该会话自己的 PR 落地。

## What shipped

底座由五个提交落地：

| 提交 | 内容 | 验证 |
|---|---|---|
| `5abf6e2` | 依 staged spec 契约实现 15 个纯函数与状态机模块 | 测试绿 |
| `1ae0af3` | controller 修复（metrics-glance 首推、overlay 切换、stream-render `hasContent`）与 `app.ts` Ctrl+P 命令面板接线 | 555/555 |
| `3db5070` | src 类型检查修复（`exactOptionalPropertyTypes`、`LiveRegionLine`） | src 0 错误 |
| `053b2bc`+`eef30e3` | `tests/` 类型检查 131 → 0（mock 类型交叉） | host tsc 0 错误 |
| `09389a6` | 路线文档的诚实状态标记 | — |

到这一步，`pnpm vitest run packages/tui/tui/tests/` 为 37 文件、555 测试全绿，`npx tsc -p tsconfig.host.json` 报 0 错误——根 `tsconfig.json` 是 solution 文件，真实检查入口是 `tsconfig.host.json`——staged lint 0 errors。这些提交在 `src/` 下实现了 18 个模块：mention-parser、restore-session、separator、spinner-status、tool-label、tool-elapsed、tool-status、activity-status、activity-store、activity-labels、collapsed-bash、summary-state、turn-summary（顶层 model 版）、format/turn-summary、format/glance-bar、format/welcome、command-palette、engine/tool-group-controller。

随后的收束会话收掉了路线尾巴——四个未实现功能与三个未接线模块：

| 项 | 提交 | 验证 |
|---|---|---|
| 6.4 外部编辑器 | `92c2d06` | 567 → 588 测试绿；`tsc -b` 0 |
| 6.5 Vim 模式 | `2c82467` | 588 测试绿；`tsc -b` 0 |
| 9d 流利度（移植） | `51feb85` | 586 测试绿；`tsc -b` 0 |
| 9d 流利度（装配） | `835638e` | 588 测试绿；`tsc -b` 0 |
| 5.3 glance-bar 装配 | `9775e93` | 590 测试绿；`tsc -b` 0 |
| 9a mention 装配 | `fccbe4b` | 600 测试绿；`tsc -b` 0 |
| 9b restore-session 装配 | `af73fa2` | 602 测试绿；`tsc -b` 0 |
| Phase 8 approval answerer | `2acc509`+`2e34b69` | 605 测试绿；`tsc -b` 0 |

这一波的最终验证：`pnpm vitest run packages/tui/tui/tests/` 为 40 文件、605 测试全绿，`tsc -b tsconfig.host.json` 报 0 错误——比先前的 `-p` 更严，因为 `-b` 从 `src` 重建，且包含既有的 glance-bar 窄化修复 `e54c7e2`。这一波新增四个模块：external-editor、fluency-policy、fluency-hook、mention-expand。

尾巴中各项的落地方式：

- 6.4 外部编辑器：Ctrl+O 触发，`Config.editorKey` 让按键可配置，绑定避开 `input-line.ts` L728 已占用的 `ctrl_e`/`moveEnd` 冲突。移植源是 `.rivet/tui-source/tui/external-editor.ts`（31 行）。
- 6.5 Vim 模式：`input-line.ts` 已内建 vim 状态机（`_vimMode`，约 L1121-1262），因此本项是接线加一个 `Config` 开关，不是移植。
- 9d 流利度控制：自 `fluency-hook.ts` 与 `fluency-policy.ts` 移植，与 `blockWriter` 的节流协同。
- Phase 8 approval answerer：`packages/interaction/user-approval/` 已提供 `ApprovalService`、`'approval/request'` waterfall 与 `OUTCOMES` 四个取值，因此 TUI 注册 answerer——而 waterfall 监听必须经 `next()` 委托。

## Coverage campaign state

覆盖率一波收掉了归这条工作线所有的覆盖点，共五处，以 `app.spec.ts` 的实测覆盖率为准：

| 覆盖点 | 提交 | 说明 |
|---|---|---|
| 工作区在途改动（5 处 src v8-ignore 标记、6 个 spec 用例） | `e1429a8` | 61 文件、1195 全绿 |
| workflow outcome 缺省（先前记为 L904:31） | `8ac3054` | 行号已漂移：现 L904 是 `a.outcome ?? 'completed'`，L908 的 error 展开已被既有测试覆盖；根因是带 agents 的 run 从未走到 `toWorkflowRunView`（wf-running 无 end、wf-done 无 agent） |
| `credentials.describe` 的 catch（先前记为 L935:45） | `8ac3054` | 调用点本已覆盖，欠的是 `.catch(() => {})` 箭头，因为 mock 恒 resolve——由一个 reject 用例收掉 |
| 审批 diff-null 分支（L1604:9） | `8ac3054` | 原 diff-null 测试用的是未知 `callId`，`toolCall` 为 undefined，连 `if` 都没进——改为命中 `callId` 加 bash 参数（此时 `formatPermissionDiff` 返回 null）后收掉 |
| 流式尾巴（L1626:7） | `8ac3054` | `getLiveTailLines` 在无 pending 时恒空——由一个无稳定边界的 text-delta 用例收掉（idle 180 ms 吐块，加上一个 WriteBatcher 帧，等 300 ms） |
| vim visual 标签（L1654） | `8ac3054` | 覆盖 v → VISUAL，以及 ESC 回到 normal 后 V → VISUAL LINE；visual 态不处理 V 键，V 只在 normal 态进入 line-wise |

这一波的最终验证：`pnpm vitest run packages/tui/tui/tests/` 为 61 文件、1199 测试全绿，`app.spec.ts` 在 `--coverage.include=.../src/ui/app.ts` 下的覆盖率，在这条工作线的范围内已无遗留。整场攻坚把仓库从 119 条违规压到约十条级别，共八个覆盖提交：`59f655b`（evidence-gate 6 个 spec、TUI 14 处 src v8-ignore、25 个 spec）、`bf39460`（commands/registry 到 100%、app C2 交互修复、5 处 v8-ignore 标记）、`9591392`（history-search 追平）、`f65a423`（app 42 → 28）、`05a9edb`（`/model` 与 `/skills`）、`66c5e25`（非 Error 抛出路径）、`da37739`（审批 diff-null 与 workflow attach 修复）。`app.spec.ts` 承载 132 个全绿测试，基线为 61 个。

同一波还用五个提交（`808fe54`、`7706b78`、`f83a47b`、`a95714f`、`b2712dc`）清零了全仓 86 个既有类型错误：tui 33、workflow-workerthread 7、subagent 20、workflow 7、hooks-claude 8、fs-snapshot 6——最后一项包含在 `tsconfig.host.json` 中补 fs-snapshot reference 以解 TS6307。全部是 tests 层的类型标注修复，行为零变化（tui 1202、subagent 214、workflow/hooks/fs 114、workerthread 104 vitest 全绿）。

`app.ts` 尚未覆盖的部分约 57 处，归并行 C3 会话的范围，由它的 `mode-cycle.spec.ts` 覆盖：L1106/1107（`setPlanMode`）、L1182-1216（`cycleMode`/`alwaysApprove` 三态循环与 `shift_tab` 键路由）、L1262-1325（question answer 新形状与审批会话过滤）。

在本环境能给出可信覆盖率信号的两条命令：

- 单文件：`npx vitest run packages/tui/tui/tests/app.spec.ts --coverage --coverage.include="packages/tui/tui/src/ui/app.ts" --coverage.reportOnFailure`
- 全仓：`DSH_COVERAGE_EXEMPT_HEAVY=1 npx vitest run --coverage --coverage.reportOnFailure`

## Environment and toolchain constraints

- `tsc -b --force` 在本环境卡死——连续三次，kill 之后仍复现，起点是两次 `tsc` 并发死锁之后，指向 `tsbuildinfo` 缓存损坏。替代信号是 `npx tsc --noEmit -p tsconfig.host.json`，目标包 0 错误；该模式还会额外报出 46 个 `-p` 特有错误（其中包括 session-persistence），`-b` 口径并不报，两者不可混淆。要再次确认 `-b` 的 exit 0，得先清掉 `*.tsbuildinfo`。
- `tsc -b` 并发运行会在 `tsbuildinfo` 锁竞争上死锁，因此全仓构建必须串行。
- 聚合的 `tsc -b` 构建会重建 user-approval，并把产物 emit 到它的 `src/`（rewrite relative import 行为），因此构建之后要清理 `packages/interaction/user-approval/src/*.{js,d.ts,map}`。该包单独构建时产物正常落到 `lib`/`types`；这些残留不是本工作引入的。
- `pnpm run check:ci:coverage` 在本机会假绿：node 24.1.0 没有 `import.meta.main`，run-gates CLI 静默退出。CI 跑更高的 node 版本，本地验证用上面那两条命令。
- 定向跑 tui 覆盖率时其他包报 0%，这是配置性误报而非真实缺口；真值需要全仓测试跑。
- `deliver_task` 提交管线在本环境不可用——三次失败的原因都被吞掉——因此提交经 `git add` 加 `git commit` 完成，事后核验归属。
- lefthook 提交门禁：`lint --fix` 与未暂存改动冲突，因此先 `git add -A`；whitespace 门拒绝尾部空行（`git diff --cached --check`）；lint `max-len` 为 140。
- `.zcode/`，即覆盖率攻坚的探针目录，已进 `.gitignore`。

## Traps this work paid for

- WriteBatcher 按 16 ms 节拍合并帧，因此集成测试要用 30 ms 的 `setTimeout` 等待；`setImmediate` 太早，观察不到帧。
- workflow 与 approval 订阅只在 `attach()` 注册，`newSession()` 里从不注册，因此事件驱动的测试必须 attach。workflow 订阅注册在 `app.ts` L853，触发它需要用收集到的 handler，加上真实事件形状 `{ stopReason, error }`。
- 监听器生命周期（`89ace88`）：`mountSession` 里每一个 subagent 与 workflow 订阅都必须收集 disposer，因为 `ctx.on` 恒返回 disposer，用 `??` 连接会让右侧永不注册——`subagent/end` 正是因此从未被订阅。`detachProjections` 也必须调用 subagent 与 workflow 的 disposer，此前它们全部泄漏，每次挂载都在累积。断言 disposer 被调用需要 mock `on: vi.fn(() => vi.fn(() => true))`。
- `/model` 经 `ctx.agentDefaultModel` 属性访问拿到模型，而 `/compact`、`/goal`、`/tasks` 经 `reflect.get`，即 Cordis 4 的注入代理。
- `bootEventApp` 经 `newSession` 装配，且 `streamFeed` 在 `mountSession` 注册，因此 attach 与 `newSession` 都有效。它的 `session.id` 必须同步为 `app.sessionId`：真实装配语义下，铸造出的 id 要贯穿 transcript、statusline、streamFeed 三处过滤。
- 工具卡标题显示语义动词（Run、Search）而非原始工具名，Ctrl+. 的键码是 0x1e（RS）。
- 不可达的防御分支用 `/* v8 ignore next -- 具体理由 */`，全仓有 650 多处先例；不允许为触达它而改逻辑。
- 三种类型修复模式覆盖了整类 tests 层错误：事件回调参数不加标注，因为重载签名的逆变会拒绝任何单一标注，改在内部用 `'runId' in info` 或 `typeof title === 'string'` 收窄；`ctx.emit` 的 `Parameters<Events[K]>` 解析到事件 map 的最后一个重载，即 fallback 形状，因此测试派发真实形状时用宽松断言 `(ctx.emit as (thisArg: unknown, name: string, ...args: unknown[]) => void)(...)`，这是精确类型而非 `as any`；TS 5.4 会把「let 变量 + 闭包内赋值 + 之后调用」收窄为 `never`，因此 `if (x) x()` 不生效，调用要写成 `(x as T | null)?.()`。
- `as unknown as Context` 之后 mock 的类型会丢失，因此 mock 用交叉类型标注——`Context & { sessions: { list: ReturnType<typeof vi.fn> } }`——并且函数的返回类型标注也要随之修改。
- write_file 指针陷阱：连续传 `"[file written to …]"` 这类显示指针会被拦截，必须写真实完整内容；被拦截后系统有时会用意图恢复落盘，因此写完要跟一次 `read_file` 或 `wc` 核验。
- 三处 staged spec 与已落地行为矛盾并被修正：tool-group-controller `'Bash'` → `'Run'`（与既有 tool-card 一致）、command-palette 的 move 测试需要注入 `entries`（可见条目由 state 持有）、turn-summary 窄宽 50 → 40（spec 声称约 58 列，实际是 44 列）。

## Key file map

- 路线：`docs/dsh-tui-next-phase.md`，其中带有状态标记
- 契约：`packages/tui/tui/tests/*.spec.ts`，staged RED 基线，也是唯一权威
- 移植源：`.rivet/tui-source/tui/`，不在版本控制内（`.gitignore:42`）且 glob 看不到，因此开工前用 `ls` 确认
- 覆盖率门：`vitest.config.ts`（perFile 100%）与 `scripts/run-gates.ts` 的 `ci-coverage` 项
- 类型入口：`tsconfig.host.json`；根 `tsconfig.json` 是 solution 文件
- 审批：`packages/interaction/user-approval/src/index.ts`
- 命令面板：`src/command-palette.ts` 与 `src/engine/overlay-engine.ts`，经 `app.ts` 的 `handleKey` 接线

## Alternatives considered

**照草案条目清单原样执行** — 否决，其事实性判断被六轮反证推翻：vim 已内建于 `input-line.ts`，没有东西需要移植；审批 seam 是 core/tools 的 `resolveAsk`，不是 repeat-tool-guard；user-approval 包已存在，无需新建包；session 事件流没有 token 用量字段，因此不得声称有；mention-parser 的移植源注入的是 `<mentions>` 块，而决策取的是用户侧摘要语义（见 [TUI @mention 展开语义](../feature/2026-08-10-tui-mention-semantics.md)）。

**在本工作内收掉仓库级覆盖率门** — 否决，它保留为点名的债务。含 `src/**` 的 perFile 100% 是仓库规模的攻坚，而定向跑 tui 时其他包报 0%，因此这道门的真值需要一次全仓测试跑，功能会话无法诚实地给出。

**把 `pnpm run check:ci:coverage` 当作本地覆盖率信号** — 在本机否决，因为它静默退出、读起来像绿的。单文件的 `--coverage.include` 跑法，加上带 `DSH_COVERAGE_EXEMPT_HEAVY=1` 的全仓跑法，才是覆盖缺失时真会失败的信号。

**继续把 `tsc -b --force` 当类型信号** — 在本环境否决，它会卡死。`npx tsc --noEmit -p tsconfig.host.json` 顶上，代价是错误集合不同，这也是那 46 个 `-p` 特有错误被记录下来而非被修掉的原因。

**为触达不可达的防御分支而改逻辑** — 否决。覆盖率永远不足以换取一次行为变更；仓库的先例是写明理由的 `/* v8 ignore next -- 理由 */` 标记，共 650 多处。

**经 `deliver_task` 管线提交** — 否决：它在本环境不可用，三次失败还吞掉了原因，因此这里记录的提交由 `git add` 加 `git commit` 产生，归属经核验。

**在这一侧覆盖并行会话的 C3 覆盖点** — 否决。那约 57 处 `app.ts` 覆盖点属于 C3 功能 PR 及其 `mode-cycle.spec.ts`；从这一侧补测试会与那份工作重复，并在同一文件里冲突。

## Consequences

- 路线尾巴已收掉，并由测试锚定：收束时 605 全绿，覆盖率一波之后 61 文件、1199 测试全绿，`tsconfig.host.json` 入口 0 类型错误。代价是类型信号来自两条错误集合不同的命令，此后每次引用都必须说明是哪一条给出的。
- 把覆盖率门保留为点名债务，换来的是一个会话内收完完整的功能尾巴；仍然敞着的是仓库级 perFile 门，以及归并行 C3 PR 所有的约 57 处 `app.ts` 覆盖点。
- 规格先行换来的是一份比任何单次会话都活得久的契约——`tests/*.spec.ts` 作为唯一权威——代价是三处 staged spec 不得不按已落地行为修正，以及测试规模长得比它覆盖的功能更快。
- 聚合的 `tsc -b` 构建会在 `packages/interaction/user-approval/src/` 里留下产物，因此这里每次全仓构建收尾都是一次清理，而不是一棵干净的树。
- 把每个陷阱都记下来会让本文件变长，而这份长度正是要点：每一条都是已经花掉的会话时间，后续会话不必再花一次。
