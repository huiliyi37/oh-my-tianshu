# Agent Note: 交互式 /config 面板

Status: implemented

[English](2026-08-22-tui-config-panel-interactive.md) | 中文

## Problem

`/config` 原是只读的 live 区投影：四个扁平段落倾倒原始 settings 命名空间、pin 状态、权限选项与一个硬编码的 `DEEPSEEK_API_KEY` 徽章，无导航、无编辑——TUI 里改任何东西都只能靠各自的 slash 命令。竞品的 `/config`（opencode-tui）示范了预期形状：双栏 framed overlay，类目组织字段，Enter 即编辑。

## Decision

`/config` 现为交互式双栏 framed overlay（`config-panel.ts` 的 `ConfigPanelController`——OverlayRenderer 契约下的状态机 + 渲染器，服务由装配方注入）。四类目：模型（默认模型、推理档位、三角色 pin）、权限（预设）、凭据（`/key` 向导的目录与引用解析给出的各供应商 key 状态）、概览（只读的已解析 settings 命名空间与脱敏标记）。Enter 把字段动作分派回装配方，打开与命令同一套编辑器——`/model` picker、角色 picker、档位 picker（选项取 `resolveModelInfo` efforts）、权限预设 picker（活会话上的 `/permission` 写路径）、或该供应商的 `/key` 对话框。

与竞品的两个刻意偏离。**无草稿/脏块/保存机制**：这里的全部写面都热生效（角色 pin、默认模型选择、权限 apply、凭据 set），Enter 即「改完即成」，状态行取代保存编舞——竞品需要草稿是因为它的配置是文件。**回开编舞而非 overlay 栈**：overlay 引擎是切换不是栈，编辑时面板失活、编辑器运行，其关闭路径（picker 提交/Esc、key 对话框关闭）经 `finishConfigReturn()` 重建数据并回开到原字段（`refresh` 按类目/字段键定位游标）。旧 live 区投影路径（`configPanelVisible`/`configProjection` 快照字段、`renderConfigPanel`、`/clear` 特判）随行为变更一并移除。

## Alternatives considered

- **整体移植竞品的草稿/脏块保存模型。** 否决：它解决的是本 harness 没有的问题（文件配置需要原子多字段写入）；热 seam 让即时生效既更简单也更诚实。
- **字段原地编辑（每类字段内联编辑器）。** v1 否决：picker 已经存在且久经考验；内联编辑会在面板里重复造一套，收益边际。
- **保留只读面板、另设 /settings 编辑命令。** 否决：一件事两个面；面板本身就是正确的面。
- **overlay 栈（返回上一层）。** 否决：引擎的单活跃 overlay 切换是承重的简单性（每个 overlay 都假设独占焦点）；回开编舞在不改该契约的前提下保住了体验。

## Consequences

- `/config` 编辑即时生效；面板每次回开都从 seam 重建数据、显示当前态。
- 凭据类目继承 key 向导的目录/引用解析，面板与 `/key` 互为入口、互相强化。
- 只读降级统一：服务缺席即缺类目（模型恒在、字段显示 `—`），无写路径的字段暗显、Enter 给「该项只读」状态。
- 宽度计算按显示宽度精确预算（CJK 2 格）分列、双栏居中窗口滚动；页脚超出预算即截断（测试抓到的真实溢出）。
- 档位 picker 每次打开读 `resolveModelInfo`；无推理元数据的提供方回退固定 `off/high/max`。
