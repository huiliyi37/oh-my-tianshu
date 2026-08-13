# Agent Note: 按实测聚类重新划分 packages/ 分组

Status: implemented

[English](2026-07-29-package-regrouping.md) | 中文

## Problem

两级 `packages/<group>/<pkg>` 层级结构（[原始决策](../../archived/architecture/2026-06-20-package-hierarchy.md)）自 6 月以来已经漂移：167 个包（package）彼时坐落在 42 个组里，若干组边界已经对不上这些包的实际聚类。

- `ui/` 混杂了四个互不相关的平面：人类终端通道（`tui`）、SDK 的 JSON-RPC 服务端一半（`jsonrpc`，它对 `dsh-sdk-protocol` 的对等依赖（peer dependency）把它绑在 SDK 通信栈上）、人机交互 seam（`user-interaction`、`user-approval`、`permission`、`tool-ask-user`、`commands`），以及与通道无关的 boot 胶水（`app-boot`）。它自己的 README 只能逐一叙述这堆混杂，说不出一个统一职责。
- 会话家族被割裂在五个组里——`session-persistence/`、`session-projection/`、`session-query/`、`session-title/` 与 `telemetry/`——而实测依赖边明明把它们连成一体（query → persistence、title → projection、projection → persistence；见 [docs/module-graph.md](../../../../docs/module-graph.md)）。
- 两个组名与不相干的包撞名：`telemetry/`（会话上报）撞上 `dsh-telemetry`（启动器侧 SDK telemetry），`timeout/`（一个工具调用守卫）撞上 `util/timeout`（通用 promise 工具）。
- `cordis/` 拿所有包共同依托的框架给自己的组命名，这个名字因此毫无区分度；组里唯一的包 `tool-cordis` 是运行时自我修改工具集。
- 旧 `sdk/` 的目录命名不一致：`sdk/sdk-client` 和 `sdk/sdk-protocol` 重复了组名，而 `sdk/telemetry`、`sdk/helper`、`sdk/scripts` 没有。

这次重新分组的指导准则：**聚类紧密的包同处一组。**聚类以实测为准（对等依赖边与 co-change），而非按主题归类。孤立的 seam 家族可以自成一个小组；要避免的失败形态，是名字概括不出单一职责的大杂烩组。

## Decision

重组六个组；其余每个组都保持先前的边界与内容不变（依赖分析确认各能力家族——`bash/`、`pty/`、`code-runtime/`、`sandbox/`、`subprocess/`、`fs/`、`lsp/`、`web/`、`skill/` 及其余——本来就划得正确）。npm 包名一个未改；整个变更全部由目录树承载。

| 组 | 成员（目录名） | 来源 |
|---|---|---|
| `session/` | session-persistence、session-persistence-jsonl、session-persistence-sqlite、session-checkpoint-policy、session-projection、session-projection-cache、session-title、session-title-llm、session-title-first-message-llm、session-title-all-messages-llm、session-telemetry、session-telemetry-otel | `session-persistence/` + `session-projection/` + `session-title/` + `telemetry/` |
| `interaction/` | user-interaction、user-approval、permission、tool-ask-user、commands、tui | `ui/` |
| `boot/` | app-boot | `ui/` |
| `scaffold/` | helper、scripts、create-sdk、protocol、client、server、telemetry | `sdk/` + `ui/jsonrpc` |
| `guard/` | repeat-tool-guard、timeout-policy | `guard/` + `timeout/` |
| `self-modification/` | tool-cordis | `cordis/` |

- **`session/`** 是持久会话数据平面：持久化 seam 连同其各后端与检查点策略、从该日志折叠（fold）出全量值对外供值的投影、日志兜底的标题，以及 OTel 上报。标题折叠本身就是读取侧的承重构件（`session-query` 对 `dsh-session-title` 声明对等依赖），所以标题属于数据平面，而非某个「派生服务」附属区。用这个朴素的名字是有意为之（评审意见：名字要像人起的）；旁边的 `core/session` 包仍是常驻内存的实时服务，本组则是围绕它的持久家族。`session-query/` 保持独立成组：这个读取／工具面自带模型工具和 SQLite FTS 后端，其消费不依赖持久化内部实现。吸收 `telemetry/` 之后，与 `dsh-telemetry` 的组名冲突就此终结。
- **`interaction/`** 是人机协作平面加上应答它的终端通道：提问／批准 seam、权限预设、面向模型的 `ask_user_question` 工具、人类命令注册表（`plan-mode` 与 `command-goal` 已经把 `commands` 和各交互 seam 放在一起消费），以及 `tui`——这个交互通道是该平面最重的提供方与消费方（对 `commands` 与 `user-interaction` 均有对等依赖边），而一个单包 `tui/` 组会把一个顶层名字花在一个插件上。
- **`boot/`** 是角色完备的单包组：不归属任何通道也不归属任何组装的共享 bin boot 胶水（被 `apps/cli`、`scaffold/` 的启动器和 `examples/` 各演示 bin 消费）。
- **`scaffold/`** 是开发者工具家族：项目 helper、启动器、初始化器、连同两端的通信协议（`server` 即原先的 `ui/jsonrpc`），以及启动器侧 telemetry。评审中从 `sdk/` 改名：整个 `packages/` 树本身就是 SDK，树里再放一个叫 `sdk/` 的组等于什么都没说；`scaffold/` 说出了「创建／启动／驱动项目」这一实际角色。目录去掉遗留的 `sdk-` 前缀（`protocol`、`client`、`server`），与 `client/`/`host/` 的角色命名风格一致；在推迟的改名落地之前，受影响的三个 npm 名在 `tsconfig.base.json` 里于组通配符旁显式映射。
- **`guard/`** 保留其文档记载的角色（循环卫生守卫），并新纳入强制执行工具调用超时的包；那个与 `util/timeout` 撞名的单包组 `timeout/` 随之解散。
- **`self-modification/`** 把 `cordis/` 遮蔽掉的角色说了出来：它是 agent（智能体）检查并挂载自身实时运行时中插件所用的工具集，也是未来自我修改类包的落点。

42 个组变为 39 个；收益在聚类正确与名实相符，不在数量增减。

## Deferred renames (FIXME markers)

五个 npm 名最终应当改掉，但在这次重组内部改名，会把一个纯移动的 PR（Pull Request）变成大量翻改 import 的 PR。因此每个受影响包的模块 JSDoc 里带有一条 `FIXME`，写明意图中的新名字。`FIXME` 会阻塞打 tag 的发布（[标记语义](../../../../docs/development.md)），这正是想要的倒逼机制：只有趁还没有外部消费方使用这些包时，这些改名才是零成本的。

| 当前 npm 名 | 目标名 | 原因 |
|---|---|---|
| `@deepseek-ai/dsh-jsonrpc` | `@deepseek-ai/dsh-sdk-server` | 名字说的是协议编码而非角色；它是 SDK 协议的服务端一半 |
| `@deepseek-ai/dsh-telemetry` | `@deepseek-ai/dsh-sdk-telemetry` | 与 `dsh-session-telemetry` 家族撞名；它是启动器侧 SDK telemetry |
| `@deepseek-ai/dsh-helper` | `@deepseek-ai/dsh-sdk-helper` | 作为公开发布名空泛得站不住脚 |
| `@deepseek-ai/dsh-scripts` | `@deepseek-ai/dsh-sdk-scripts` | 同上 |
| `@deepseek-ai/dsh-timeout-policy` | `@deepseek-ai/dsh-timeout-guard` | 仅为建议、尚未定案：使名字与其 `guard/` 归属对齐；到解决时再定 |

前四个是已定的意图；兑现之后，SDK 通信栈的 npm 名随之收敛为 `dsh-sdk-*`（npm 前缀指产品栈，`scaffold/` 目录名指角色）。`@deepseek-ai/create-sdk` 保留其文档记载的 npm 初始化器特例。

## What the move touched

移动以 `git mv` 提交落地，每个区域一个提交（会话折叠；`ui/` 解散加 `scaffold/`；`guard/` 合并加 `self-modification/`），评审由重命名检测承载。组移动触及了：被移动包的 `tsconfig.json` 相对 `references` 及每个依赖方的对应条目（含 `apps/cli` 的 project references）；tsconfig 聚合与路径映射；各组 README（五组新的双语三文件配对、被解散组的 README 删除、[packages/README.md](../../../../packages/README.md) 的层级结构表、根 `AGENTS.md` 的布局图）；重新生成的产物（`docs/module-graph.md`、内嵌路径的目录、锁文件的 importer 键）；以及散文与门禁脚本中以仓库根为基准的 `packages/...` 引用。其余每一处组路径引用（workspace 配置、测试 glob、lint 键）都由验收门禁的响亮失败机械地找了出来——这正是本仓库自己的「配置错误必须响亮失败」规则。

组移动未触及：npm 包名、import、`cordis.yml` 配置、快照 fixture（测试前置数据）、`pnpm-workspace.yaml` 与 `tsdown` 的 glob（都是 `packages/*/*`），以及 Python 运行时 manifest（元数据清单）——它们全部按 npm 包名引用包。每条 FIXME 都与创造其上下文的那次移动落在同一个提交。

`client/` 与 `host/` 不在本次范围内，保持不变。`experimental/` 组提案（PR #844）与本案正交：它是发布边界容器，不是聚类决策；两者唯一的交集是 packages/README.md 表格里一次很小的合并。

## Alternatives considered

**粗粒度领域桶**（`exec/` = subprocess+sandbox+bash+pty+code-runtime，`workspace/` = fs+lsp+workspace，`orchestration/` = subagent+workflow+tasks，`knowledge/` = web+skill，`collab/` = plan+todo+goal；约 16 个组）。不予采纳：实测依赖图与这些合并相矛盾。`sandbox` 和 `subprocess` 是被各家族跨界消费的共享基础设施（与 bash ×5、fs ×5、pty、lsp、mcp、subagent、scaffold 均有依赖边），`web` ↔ `skill` 之间零依赖边，而大桶只会在更大尺度上复现 `ui/` 式大杂烩。

**抽象分层名**（`capability/`、`policy/`、`extension/`、`provider/`）。不予采纳：这些名字对每个插件都同样地不达意，而且一个 `capability/` 桶会装下约 50 个包。

**一轮全量 npm 重命名**（每个包都改为 `dsh-<group>-<pkg>`）。不予采纳：npm 包名是扁平的，加组前缀只会在 import、配置和 fixture 之间制造改动，却换不来任何消歧收益；用 FIXME 跟踪的定点改名足以覆盖真正的撞名。

**在重组内部一并完成那五个改名。** 评审中否决：改名会成倍放大开放 PR 的冲突，并破坏纯移动的评审属性。FIXME 标记让这些改名保持为可见的发布阻塞项，留待以小型后续 PR 逐一解决。

**会话两分法**（`session-core/` + `session-utils/`）。不予采纳：query 放哪一侧都不干净，而且 `session-core` 容易与 `core/session` 混淆（后者是 `dsh-session`，常驻内存的实时服务，留在 `core/` 不动）。

**会话三分法**（`session-store/` + `session-query/` + `session-utils/`），即本 RFC 的初稿。评审中否决：`session-utils/` 是靠否定条件圈出来的附属区（「派生的、没有承重方依赖」）——正是指导准则禁止的大杂烩形态，而且事实层面也站不住（`session-query` 对 `dsh-session-title` 声明对等依赖）。杜撰的复合名也读起来不像人起的；一个朴素的 `session/` 组说的就是人会说的话。query 在两版草稿中都保持独立：它是被独立消费的读取面，自带自己的工具包与后端。

**把 `ui/` 重组为单一 `channels/` 组**（tui + jsonrpc + acp + 交互 seam + boot）。不予采纳：不过是换个名字的同一个大杂烩——这些包服务于四个平面，`jsonrpc` 的实测聚类归属是 SDK 通信栈，而 `acp/` 是自动化传输通道，不是人类通道。

**独立的单包 `tui/` 组**，即本 RFC 的初稿。评审中否决：`tui` 是交互平面最重的提供方／消费方（对 `commands`、`user-interaction` 有对等依赖边），把一个顶层名字花在一个插件上只添组不添信息；它折入 `interaction/`。

**保留组名 `sdk/`。** 评审中否决：整个 `packages/` 树本身就是 SDK，树里的 `sdk/` 组毫无区分度——与 `cordis/` 同病。`scaffold/` 说出了实际角色（从外部创建、启动、驱动项目）。

**把 `app-boot` 挪到 `apps/`**（评审提问）。不予采纳：`apps/` 是包层之上的组装层，而 `dsh-app-boot` 是被包层代码 import 的库（`scaffold/scripts` 的启动器对它声明对等依赖）——放进 `apps/` 会颠倒层级，并把一个 workspace 库放到 `packages/*/*` 构建 glob 之外。它仍是一个包；`boot/` 是它角色完备的家。

**把 `tool-cordis` 挪进 `core/`。** 不予采纳：自我修改是独立的产品 seam，预期还会生长；主干保持精简。该组最初命名为 `self-evolve/`；评审定为更朴素的 `self-modification/`。

**把 `context/` 改名为 `request-context/`。** 不予采纳：在这棵树里，该组就地看并无歧义；这份改动开销并不值得。

## Consequences

- 目录树与映射表一致：重组的六个组恰好持有所列成员；`ui/`、`sdk/`、`telemetry/`、`timeout/`、`cordis/`、`session-persistence/`、`session-projection/`、`session-title/` 这些组不复存在；其余每个组的内容不变。workspace 的包名集合在前后完全相同（npm 改名为零），五条 FIXME 标记钉住推迟的改名。日后若某条 FIXME 被证明不对，必须连同理由显式移除，绝不允许无声消失。
- 结果由以下检查钉住：`pnpm run typecheck`、每个被移动组的单元测试套件、`verify-package-paths`、`verify-md-links` 与全语料翻译配对在移动后的树上全部通过；`vitest.snapshot.config.ts` 中按组划定的测试 glob 随移动一并改写，套件收集到与移动前相同的测试文件（glob 匹配为空会无声地丢失覆盖）。
- 每个触碰被移动文件的开放 PR 都跨过这次移动做一次变基；PR 正文中的映射表与重命名检测可机械化解决大多数改动块。
- 单包组依然存在（`boot/`、`self-modification/`，以及 `acp/` 等既有单包组）。这是有意接受的：每个都是角色完备的整体而非某个家族的碎片，一个名实相符的小组胜过一次徒有其名的合并。
- 在推迟的改名落地之前，`scaffold/` 的目录名与其 npm 名并不一致——这是唯一的过渡性不对称，由 `tsconfig.base.json` 里三条显式 `paths` 映射承载，并由 FIXME 改名最终消除。
- **这次变更放弃了什么：** 功能上一无所失——变更只关乎导航。肌肉记忆和指向旧 GitHub 路径的外部链接会失效；在 pre-release、尚无外部消费者的前提下，这可以接受。
