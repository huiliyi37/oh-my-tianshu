# Agent Note: Slash menu rows join the live-region high-water so the input rail stays pinned

Status: implemented

[English](2026-08-20-tui-slash-menu-pin.md) | 中文

## Problem

slash 命令菜单渲染在 TUI live 区的 chrome 段内（`packages/tui/tui/src/ui/app.ts` 的 `renderLive`），紧贴输入轨上方。其行数随每一次过滤匹配列表的按键变化（最多 `SLASH_MENU_MAX_ROWS` 行加溢出提示行），而定高视口的高水位垫高此前只跟踪 `chromeStart` 之前的动态段。菜单每次涨缩因此直接推移输入轨的屏上行位——输入 `/…` 时输入框 visibly 逐键弹跳，菜单关闭时又跳回去。

## Decision

菜单（或无匹配时的一行内联提示）先收集进局部数组 `slashLines`，其 display rows 合计 `slashRows` 计入高水位记账，不再推移输入轨。`renderLive` 向 `nextDynamicBudget` 传 `dynamicRows + slashRows` 作为被跟踪行数、`ceiling + slashRows` 作为上限，并向 `padDynamicRegion` 传 `budget - slashRows`。由于 `ceiling` 已减去 `chromeRows`（含 `slashRows`），调整后的上限与菜单高度无关：菜单的开合、过滤、关闭、重开只改变菜单上方垫空行的数量，输入轨行位恒定。`skipPad` 欢迎豁免现在额外要求 `slashRows === 0` 且高水位为零——未被触碰的欢迎首帧保持不垫，而首次打开菜单即启动垫高，吸收此后一切变化。`packages/tui/tui/src/engine/live-engine.ts` 的 `nextDynamicBudget` 与 `padDynamicRegion` 不变，只改了调用点。

## Alternatives considered

**把菜单移进动态段。** 否决：超预算裁剪从顶部丢最旧的动态行，小终端会裁掉菜单本身；chrome 成员身份正是菜单所需的永不裁剪保证。

**空闲时把 chrome 垫到全上限，让输入轨从首帧起沉底。** 否决：那是 [chrome-pin Agent Note](2026-08-15-tui-chrome-pin-ghost.md) 已否决的空白带欢迎布局，且用户反馈的痛点是弹跳而非静止位置。

**常驻预留固定菜单高度槽位。** 否决：补全不激活时输入轨上方横亘一条永久空带，是用浪费视口换缺陷。

## Consequences

首次打开菜单时输入轨向下落定一次——菜单需要真实行数而高水位从零起步——此后的过滤、关闭、重开都让输入轨纹丝不动；菜单让出的行变为垫空行。`dynamicRowsHighWater` 现在跟踪动态段加 slash 行的合计，既有的会话切换与 `newSession` 重置点不变。小终端行为不变：预算钳到零，不垫不裁，菜单仍在 chrome 完整渲染。其他可变高度 chrome 行（提问/审批卡、vim 模式标签、图片摘要、Ctrl+C 提示）仍会推移输入轨；若日后成为被反馈的问题，可用同一记账吸收。

## Testing

- `packages/tui/tui/tests/app.spec.ts`——钉住用例打开菜单、过滤到单一匹配、再关闭，断言传给 `LiveEngine.render` 的帧中输入轨行位始终不变；该用例在修复前的记账下失败、修复后通过。

## Related

- [chrome 钉住与幽灵轨修复](2026-08-15-tui-chrome-pin-ghost.md)——拥有本 note 所扩展的定高视口高水位契约。
