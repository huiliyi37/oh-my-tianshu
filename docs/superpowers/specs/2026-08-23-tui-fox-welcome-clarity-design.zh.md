# TUI 狐狸欢迎清晰度设计

[English](2026-08-23-tui-fox-welcome-clarity-design.md) | 中文

## Goal

沿用 [2026-08-22-tui-fox-welcome-design.md](2026-08-22-tui-fox-welcome-design.md) 中的同一只抠图狐狸，以及 `Oh My Tianshu` / `DeepSeek ◆ Tianshu Harness` 的品牌层级，替换导致吉祥物无法辨认的投影方式。

本改动只影响展示。它不增加模型可见输入、会话事件、持久化字段或 agent-loop 行为。

## Visual contract

运行时欢迎页不得另画第二只狐狸。离线生成读取 `welcome-fox-cutout.png`，用 Lanczos 缩放到两档偶数像素网格之一，再把每个不透明像素贴到固定平面调色板，不做误差扩散抖动。

运行时只用半块字形绘制这些网格。一个终端单元格对应两个纵向像素。欢迎路径不使用盲文、实心 `█` 填充，也不使用下列两档之外的任何尺寸。

| Band | Terminal columns | Art | Identity column |
| --- | --- | --- | --- |
| Narrow fox | `80 ≤ cols < 105` | `56 × 42` 像素 / `56 × 21` 单元格 | 标题与 peer 留在狐狸右侧 |
| Wide fox | `cols ≥ 105` | `72 × 54` 像素 / `72 × 27` 单元格 | 标题与 peer 留在狐狸右侧 |

左栏是狐狸。右栏是：

- 一行带主题色的 `Oh My Tianshu`（不用五行点阵字标）。
- `DeepSeek ◆ Tianshu Harness`，两个名字等重视觉权重。
- 模型与 effort、cwd、可选版本。

顶栏、可恢复会话列表、随机 tip、输入框和页脚保持现有职能。resize 按新尺寸选档，绝不插入第三档狐狸尺寸。

视口放不下 `56 × 21` 狐狸加 chrome，或缺少颜色、或不支持窄半块字形时，使用现有紧凑文字欢迎页。标题绝不堆到狐狸上方。

## Opening motion

本次改动不播放开场。挂载时按当前档提交静态休息姿态。

`welcomeAnimation` 仍是经过校验的 `TuiRunnerConfig` 字段。`auto` 与 `off` 在支持 art 的终端上都产出这只静态狐狸。帧时间轴保持闲置，直到后续改动重新引入动作。

## Source and generated assets

可编辑资源仍位于 `packages/tui/tui/assets/`：JPEG 源图、透明抠图，以及现有的八帧 `96 × 72` 精灵表。精灵表保留给后续动作阶段作出处；本次改动只需要休息姿态。

生成器写入 `packages/tui/tui/src/format/fox-frames.ts`，包含两档休息网格（`56 × 42` 与 `72 × 54`）、共享调色板和 final-frame id。运行时只导入该模块。它绝不打开资源文件，也不调用 `sharp`。

过期产物门禁在内存中重建两档网格，并拒绝不匹配、抖动编码、缺失休息帧，或两档之外的尺寸。

## Rendering components

`src/format/fox.ts` 把选定的一档网格渲染成半块 ANSI 行。混合单元格用带显式前景与背景的 `▀`；单个不透明像素在默认背景上用 `▀` 或 `▄`；透明游程保留终端背景，并在内部空格前恢复该背景。每行以 RESET 结束。

`formatFoxFrame` 接受 `56` 或 `72` 的档位宽度，拒绝其他目标。欢迎区合成在已按列数和行数选定档位后再调用它。

`src/format/welcome.ts` 负责选档、单行标题、换行与单行 identity、紧凑文字回退、恢复行和 tip。它仍然接收预先渲染的 art 行及其分配宽度。

## Lifecycle ownership

启动仍准备一份不可变欢迎快照（route、cwd、version、恢复行、tip），并仍在欢迎页取得启动所有权之前写入会话挂载的恢复历史。

因为没有 intro 时间轴，快照一旦存在就执行 `settleWelcome`。live region 不再前置动画 hero。输入、粘贴、resize 以及后续 scrollback 提交仍沿用 2026-08-22 规格中的结算与待处理动作顺序，确保早到的按键不会落在规范欢迎页之前。

dispose 取消剩余的 intro 簿记，并且不写第二次欢迎页。

## Failure and degradation

非法 `welcomeAnimation` 仍在 plugin 加载时失败。过期或非法的生成帧让生成门禁和测试失败，而不是在运行时降级。

resize 跨档时按新尺寸重算静态欢迎页。渲染仍走 `LiveEngine` 与 `CommitEngine`；欢迎路径不发出 kitty、iTerm2 或原始清屏命令。

## Verification

生成器测试钉死两档网格的 Lanczos 加平面调色板输出，拒绝抖动，并拒绝第三档尺寸。

渲染器测试钉死半块字形、欢迎路径无盲文、显式背景复位、行末 RESET，以及 `56` 或 `72` 的显示宽度上界。

欢迎区测试钉死单行 `Oh My Tianshu` 标题贴在狐狸右侧、80 列换行 identity、56 列档、72 列宽档，以及低于 80 列或无颜色时的文字回退。

应用与 `examples/tui` 的 PTY 快照只记录已结算的静态画面。golden 含狐狸半块、不含盲文，并含单行标题而非五行字标。

## Alternatives rejected

手绘一只 40 列终端精灵被拒绝，因为它不再能被认成这只狐狸。

只提供 72 或只提供 96 被拒绝，因为普通 80 列窗口放不下。

盲文和 Floyd–Steinberg 抖动被拒绝，因为它们造成了当前欢迎页上的噪点。

在 56 与 72 之间连续缩放被拒绝，因为中间尺寸会重新引入发软的平均化观感。

验收后拒绝默认 40 列：脸、耳朵和尾巴条纹都消失了。标题留在 56 列狐狸右侧。
