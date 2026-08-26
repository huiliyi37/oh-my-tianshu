# Agent Note: Sitting-fox welcome splash

Status: implemented

[English](2026-08-25-tui-sitting-fox-welcome.md) | 中文

## Problem

团着的抠图被塞进 `56×42` / `72×54` 后，坐姿像素狐狸被压扁，调色板又耗在米色渐变上。旧平级行 `DeepSeek ◆ Tianshu Harness` 贴着那只盒子，腾不出已批准的 splash 艺术字位置。

## Decision

欢迎图是坐姿透明 PNG。编排读取 `assets/welcome-fox-source.png`，裁到不透明边界，写出抠图，以及八帧相同休息姿态的 768×72 图集。运行时是两张 nearest-neighbor contain 网格、吸附到同一套 15 色平面调色板，尺寸对齐已批准的 196 像素预览：`28×30` 与 `36×38`（`28×15` 与 `36×19` 单元格加上 chrome 分别需要 21 与 25 行）。`formatFoxFrame` 仍然拒绝其他宽度。

身份栏是一行 `Oh My Tianshu >`，下一行 `< Harness >`。尖括号与 Harness 行使用固定 splash 色 `#b48cff`。主间距是六列。标题留在狐狸右侧。紧凑文本保留这两行身份。

[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md) 仍拥有只画半块、无抖动、静态挂载，以及 80 / 105 列切换。

## Alternatives considered

**继续用团着狐狸和 4:3 盒子** — 已批准的坐姿图会被压扁，描边也会糊掉。

**继续用 56 列档只改高度** — 在常见字号下大约是已批准 196 像素预览的两倍，会把 splash 标题压没。

**28 / 36 档上继续 Lanczos contain** — 会把坐姿描边平均成米色渐变，平面调色板也耗在这些中间色上，狐狸读起来像糊，而不像像素画。

**五行块字或 TUI 里的 Press Start 2P** — 终端没有该字体；五行块字已经被否。颜色、尖括号和第二行 Harness 承担 splash 层级。

**保留 `DeepSeek ◆ Tianshu Harness`** — 和 splash 字冲突，而且重复 Harness。

**把旧动效矩形套到坐姿身体上** — 那些尾巴/眼睛位置是按团着狐狸手摆的，会画错解剖。

## Consequences

得到：坐姿狐狸按已批准的预览比例；右侧栏对齐 splash；普通 24 行终端仍放得下 28 档狐狸。

代价：狐狸只有原先 56 列宽的一半，细描边会更粗，nearest-neighbor 单元格也更块状；图集在为这具身体另做动效之前是八份休息帧。

## Verification

- 生成器覆盖钉住 PNG 编排、相同休息帧、`28×30` / `36×38`，以及对已提交模块的过期检查。
- 排版覆盖钉住 `Oh My Tianshu >`、`< Harness >`、80 列折行、21 行走 28 档、25 行走 36 档，以及文本回退。
- 应用覆盖钉住静态挂载，以及 105×25 时的 36 档。
- 真实 [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY 快照记录结算后的 100×40 中档面，含半块、`Oh My Tianshu >`、`< Harness >`，且无盲文。

## Related

- [两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)
- [能力门控的狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)
