# Agent Note: Oh My Tianshu 改版——omp 对标欢迎卡、琥珀默认主题、仓库改名

Status: implemented

[English](2026-08-15-oh-my-tianshu-rebrand.md) | 中文

## Problem

TUI 的视觉身份滞后于产品的公开定位：欢迎页还挂着内部 `DSH` 品牌，默认 `graphite` 主题读起来是泛中性风，仓库名 `dsh-tianshu-build` 说的是构建线而不是产品。以 oh-my-pi（omp）与 oh-my-dsh 为交互参照，产品定位为 **Oh My Tianshu**——界面应当带有 omp 风格的识别特征，仓库名应与产品一致。

## Decision

omp 对标的第一波（仅身份层），外加仓库改名：

- **品牌**：`formatBrandWelcome` 缺省改为 `Oh My Tianshu` / `Tianshu Harness`（`packages/tui/tui/src/format/welcome.ts`）。包名（`@huiliyi37/dsh-*`）与 CLI 名（`tianshu`）不动——改名只到仓名与产品品牌。
- **`omp` 主题（新默认）**：新琥珀强调色调色板（`packages/tui/tui/src/theme-palettes.ts`：primary `#febc38`、石板灰阶、暖金用户导轨），登记在 `THEME_PALETTES` 首位；`autoThemeFor` 暗背景映射到 `omp`（亮背景保持 `paper`），`theme.ts` 初值跟随。`graphite` 与其余 15 个主题保留，`/theme` 可切。
- **欢迎卡**：`formatWelcomeCard` 把既有响应式 hero 包进圆角盒，品牌嵌在顶边左侧（`╭─ Oh My Tianshu ───╮`）；鲸鱼新增可选对角身体渐变（`bodyGradient`，仅 truecolor 轨——白肚/眼/腮红保持品牌色，16 色轨不变）；卡下落一条斜体 dim 随机 `Tip:`（`WELCOME_TIPS` / `pickWelcomeTip`）。hero 本体不动，既有 hero spec 语义保持。
- **改名**：GitHub 仓 `huiliyi37/dsh-tianshu-build` → `huiliyi37/oh-my-tianshu`；全仓被跟踪的硬编码 URL 清零（`git grep dsh-tianshu-build` = 0），含各包 `repository.url`、文档链接与断言仓身份的检查脚本。

第二波（已记录、未实施）：嵌入输入框顶边的 powerline-thin 段式状态栏、随模式变色的输入框边框、omp 式消息面（用户消息整宽暖底、工具块状态色浅底）、启动 3 秒渐变扫光 intro。

## Alternatives considered

- **全量改名（含包名与 CLI）**：`@huiliyi37/dsh-*` 与 `tianshu` 命令涉及数百处引用、发版链路与已装 profile，是独立的工程线。本波否决——用户可见品牌与仓名已足够承载身份。
- **就地改色 `graphite`**：会悄悄改变每个既有安装的外观，并抢占用户可能钉住的名字。新注册调色板让 `/theme graphite` 保持可用。
- **渐变作为鲸鱼默认**：平色品牌蓝被基线 spec 钉住，且 256/16 色轨就该用平色——渐变做成显式 `bodyGradient` 选项，只由欢迎路径开启。
- **本地检出目录同步改名**：纯装饰且打断会话；远端身份变更，本地目录名保持。

## Consequences

首屏现在一眼是 Oh My Tianshu（琥珀强调色、边框欢迎卡、渐变鲸鱼、随机贴士），16 个既有主题全部保留可切。GitHub 改名后旧 URL 自动重定向，清扫保证本地/CI/文档引用指向新身份。`app.ts` 的 source budget 抬到 3069（PR #1 的钉底接线 + 本波欢迎卡接线）。渐变开启后 truecolor 欢迎页不再出现平色品牌蓝——任何印刷/平色品牌用途要显式选轨。

## Testing

- `pnpm exec tsc -b packages/tui/tui`：0 错误。
- `pnpm vitest run packages/tui/tui/tests`：1633 通过（90 文件），含新增 `formatWelcomeCard` / `pickWelcomeTip` / 鲸鱼渐变 spec 与更新后的品牌/默认主题断言。
- `verify-source-budgets`、`verify-doc-refs`、`verify-public-repository-links`、`verify-package-paths`、`verify-md-links`、`verify-md-wrap`、`check-workspace-constraints`：改名清扫后全过。

## Related

- [TUI 审查驱动的加固批次与 visionBridge 探测服务](./2026-08-15-tui-audit-hardening-batch.md)
- [TUI 图片粘贴/剪贴板与视觉桥（opencode-tui 移植）](./2026-08-13-tui-image-paste-and-vision-bridge.md)
