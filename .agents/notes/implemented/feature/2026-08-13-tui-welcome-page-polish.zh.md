# Agent Note: TUI 欢迎页打磨——友好可恢复会话行

Status: implemented

[English](2026-08-13-tui-welcome-page-polish.md) | 中文

## Problem

C4 B 布局启动页让会话身份难扫读：可恢复行使用裸完整 id，且 `cwd` 只在 live 会话出现，因此持久化行可能读作 `○ <uuid> · 1 小时前 · fork: <uuid>`。短显示标签须改善识别，且不得替换用于恢复与切换的完整 id。

## Decision

友好会话行决策仍在 `restore-session.ts`：`formatRestorableSessions` 在有标题时用标题，并使用相对年龄、cwd basename、`#` 前缀短 id 与短 `fork #` 父 id。格式化永不改变身份；完整会话 id 仍驱动恢复与切换。

[能力门槛狐狸欢迎](./2026-08-22-tui-fox-welcome.md) 部分取代本 note 的首屏组合。它用响应式 hero 与最终欢迎组装器替换原 `formatBrandHeader`、`formatEnvCheckLine` 与 `formatWelcomeMenu` 符号；这些已移除符号不是当前接口。编号启动列表使用 `formatRestorablePickerList`，并保留友好行投影。

## Verification

- `restore-session.spec.ts` 钉住标题、年龄、cwd basename、短 id、fork id、损坏、编号与行上限行为，且不改变完整 id。
- `app.spec.ts` 钉住编号欢迎行，并按完整会话 id 路由所选行。
- 当前 hero、贴士、响应式回退与结算后的首屏组合由 [狐狸欢迎各层](./2026-08-22-tui-fox-welcome.md#verification) 验证。

## Files

- `packages/tui/tui/src/restore-session.ts`：友好摘要行与编号选择器投影
- `packages/tui/tui/src/ui/app.ts`：标题查找、三行启动投影与完整 id 路由
- `packages/tui/tui/src/format/welcome.ts`：当前首屏组合，由 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md) 拥有

## Alternatives considered

**Hero 大框 / 品牌字符画欢迎页（概念 A hero、概念 B 品牌字符画）** — 本决策推迟：友好会话身份不需要宽装饰框。其后的 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md) 采用能力门槛的 92 列 hero，且未恢复已移除的头行、环境行或菜单组装器。

**保留裸完整会话 id** — 否决：完整 UUID 一眼不可读；8 位 `#` id 对齐 git 短 SHA 惯例，完整 id 仍是 `/session switch` 的权威标识（格式化只影响显示）。

**显示完整 `cwd` 路径** — 否决：顶部栏已承载完整路径；会话行只需 basename 即可区分。

## Consequences

- 欢迎行用短 id 便于识别；碰撞只影响显示，因为完整 id 仍驱动恢复与切换。
- 当前首屏品牌、元数据、行上限、贴士与结算行为属于 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md)；本 note 仍为友好会话行理由保持活跃。
