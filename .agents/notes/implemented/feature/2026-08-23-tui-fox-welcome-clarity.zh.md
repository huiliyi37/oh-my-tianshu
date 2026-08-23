# Agent Note: 两档静态狐狸欢迎

Status: implemented

[English](2026-08-23-tui-fox-welcome-clarity.md) | 中文

## Problem

40 列挤压，再加上 Floyd–Steinberg 抖动与盲文投影，让同一只抠图狐狸在普通 80 列终端上无法辨认。随后 3.24 秒开场还把这层颗粒留在 live 区，用户才能开始输入。

## Decision

运行时欢迎画面是两张 Lanczos 休息网格，吸附到同一套至多 16 色的平面调色板，且不做误差扩散：`56×42` 与 `72×54`。`formatFoxFrame` 只用半块绘制这些网格，并拒绝其他宽度。`formatWelcomeHero` 按列数与行数选档：

- 低于 80 列，或行数放不下 `56×21` 单元格加 chrome，或无彩色 / 窄块字形：紧凑文本
- `80 ≤ cols < 105`：56 档，标题与平级行留在狐狸右侧
- `cols ≥ 105` 且行数够承载 `72×27` 单元格加 chrome：72 档

身份栏以一行主题色 `Oh My Tianshu` 开头，贴在狐狸右侧。没有五行块字 wordmark，标题也不堆到画面上方。平级文案仍是 `DeepSeek ◆ Tianshu Harness`。

挂载立即提交所选休息姿态。`welcomeAnimation` 仍是 `auto|off`，两个值都产出这只静态狐狸。八帧 96×72 图集留在包内作溯源；生成模块只导出两档休息网格。品牌层级、恢复先于欢迎的顺序，以及运行时不用 sharp 的边界，仍由[能力门槛狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)拥有。

## Alternatives considered

**手绘 40 列终端精灵** — 它不再读得像这只狐狸。抠图仍是唯一源。

**只保留 72 或 96 狐狸** — 普通 80 列窗口放不下，只会回退成文本。

**盲文或 Floyd–Steinberg 抖动** — 两者都制造了这次改动要去掉的颗粒。

**运行时 40 列档** — 验收后脸、耳朵和尾巴条纹都丢了。抠图已经铺满画布，裁边换不来更多像素。

**在 56 与 72 之间连续缩放** — 中间尺寸会重新引入发软、被平均过的观感。

**在 `auto` 上保留 3.24 秒开场** — 动效只会重放一只投影不可读的狐狸；静态挂载立刻给出可读的休息姿态。帧时序保持闲置，直到后续改动重新引入动效。

## Consequences

买到的：56 档狐狸还能认，标题留在右侧；105 列用 72 更清晰；挂载不再把 3.24 秒花在开场上。

代价：`auto` 不再播放品牌开场；只有两档离散尺寸；96×72 图集是溯源，而不是运行时帧。

## Verification

- 生成器覆盖钉住两档休息网格、共享调色板、无抖动、无第三尺寸，以及相对已提交模块的过期检查。
- formatter 覆盖钉住欢迎路径只用半块、拒绝其他宽度，以及 80 列标题在右 / 105 宽档 / 文本回退。
- controller 与 app 覆盖钉住立即 complete、`auto` 等于 `off`、105×33 的 72 档，以及恢复先于欢迎 / 挂起动作顺序。
- 真实 [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY 快照记录结算后的 100×30 中档面，含半块、一行 `Oh My Tianshu`，且无盲文。

## Related

- [能力门槛狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)
- [Oh My Tianshu 改版](./2026-08-15-oh-my-tianshu-rebrand.md)
- [TUI 欢迎页打磨](./2026-08-13-tui-welcome-page-polish.md)
