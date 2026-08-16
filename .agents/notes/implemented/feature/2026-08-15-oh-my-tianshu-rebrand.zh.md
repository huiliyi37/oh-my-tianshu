# Agent Note: Oh My Tianshu 改版——omp 对标欢迎卡、琥珀默认主题、仓库改名

Status: implemented

[English](2026-08-15-oh-my-tianshu-rebrand.md) | 中文

## Problem

TUI 的视觉身份滞后于产品的公开定位：欢迎页还挂着内部 `DSH` 品牌，默认 `graphite` 主题读起来是泛中性风，仓库名 `dsh-tianshu-build` 说的是构建线而不是产品。以 oh-my-pi（omp）与 oh-my-dsh 为交互参照，产品定位为 **Oh My Tianshu**——界面应当带有 omp 风格的识别特征，仓库名应与产品一致。

## Decision

omp 对标的第一波（仅身份层），外加仓库改名：

- **品牌**：`formatBrandWelcome` 缺省改为 `Oh My Tianshu` / `Tianshu Harness`（`packages/tui/tui/src/format/welcome.ts`）。包名（`@huiliyi37/dsh-*`）与 CLI 名（`oh-my-tianshu`）不动——改名只到仓名与产品品牌。
- **`omp` 主题（新默认）**：新琥珀强调色调色板（`packages/tui/tui/src/theme-palettes.ts`：primary `#febc38`、石板灰阶、暖金用户导轨），登记在 `THEME_PALETTES` 首位；`autoThemeFor` 暗背景映射到 `omp`（亮背景保持 `paper`），`theme.ts` 初值跟随。`graphite` 与其余 15 个主题保留，`/theme` 可切。
- **欢迎卡**：`formatWelcomeCard` 把既有响应式 hero 包进圆角盒，品牌嵌在顶边左侧（`╭─ Oh My Tianshu ───╮`）；鲸鱼新增可选对角身体渐变（`bodyGradient`，仅 truecolor 轨——白肚/眼/腮红保持品牌色，16 色轨不变）；卡下落一条斜体 dim 随机 `Tip:`（`WELCOME_TIPS` / `pickWelcomeTip`）。hero 本体不动，既有 hero spec 语义保持。
- **改名**：GitHub 仓 `huiliyi37/dsh-tianshu-build` → `huiliyi37/oh-my-tianshu`；全仓被跟踪的硬编码 URL 清零（`git grep dsh-tianshu-build` = 0），含各包 `repository.url`、文档链接与断言仓身份的检查脚本。

第二波（同批落地）：段式状态栏嵌进输入框顶边（`format/top-status-bar.ts`——左身份段 primary、右 metrics 段 muted、secondary 横线填充、窄宽从右丢段、ascii 降级）；`formatInputFrame` 接受预渲染 `topLine` 并与状态栏共用 `promptBorderColor`，整条顶边随模式变色（plan warning / always-approve error / normal 雾蓝）；footer 只留模式徽标 + 快捷键提示（metrics 上移）。

消息面（同批落地）：主题系统新增可选 `SurfaceSet`（仅 truecolor 轨）——`userMsgBg` 与 `toolPendingBg`/`toolSuccessBg`/`toolErrorBg`——omp 与 graphite 调色板已定义，自定义主题继承；16 色 fallback 轨不产生这些 token，渲染面降级为既有导轨/无底色样式。新 `format/bg-block.ts`（`withBgFill`/`withBgFillLines`）把行垫底色补到整宽；主题带 `userMsgBg` 时用户消息渲染为整宽暖底气泡（否则保持 ▌ 导轨），工具卡正文按状态垫底色（terminal/generic 结算卡与 live 进行中 tail；diff 卡按 omp 惯例保持自绘红绿），`width` 经 `renderTranscript` options 从 app 侧接入各卡渲染器。第五个 token `chromeBg` 把输入框顶边状态栏整行着为铬区色带（每个 SGR reset 后重挂底色），在终端自身背景之上锚定底部铬区；表面色调按「抬升面板」观感重新调校，避免在常见深色终端上读作黑洞。

记录在案的延期及理由：渐变扫光 intro 需要把欢迎卡扣在 live 区播动画，但欢迎页启动即提交只增 scrollback——侵入性与收益不成比例。

## Alternatives considered

- **全量改名（含包名与 CLI）**：`@huiliyi37/dsh-*` 与 `oh-my-tianshu` 命令涉及数百处引用、发版链路与已装 profile，是独立的工程线。本波否决——用户可见品牌与仓名已足够承载身份。
- **就地改色 `graphite`**：会悄悄改变每个既有安装的外观，并抢占用户可能钉住的名字。新注册调色板让 `/theme graphite` 保持可用。
- **渐变作为鲸鱼默认**：平色品牌蓝被基线 spec 钉住，且 256/16 色轨就该用平色——渐变做成显式 `bodyGradient` 选项，只由欢迎路径开启。
- **本地检出目录同步改名**：纯装饰且打断会话；远端身份变更，本地目录名保持。

## Consequences

首屏现在一眼是 Oh My Tianshu（琥珀强调色、边框欢迎卡、渐变鲸鱼、随机贴士），16 个既有主题全部保留可切。GitHub 改名后旧 URL 自动重定向，清扫保证本地/CI/文档引用指向新身份。`app.ts` 的 source budget 抬到 3069（PR #1 的钉底接线 + 本波欢迎卡接线）。渐变开启后 truecolor 欢迎页不再出现平色品牌蓝——任何印刷/平色品牌用途要显式选轨。

## Testing

- `pnpm exec tsc -b packages/tui/tui`：0 错误。
- `pnpm vitest run packages/tui/tui/tests`：1648 通过（92 文件），含新增 `formatWelcomeCard` / `pickWelcomeTip` / 鲸鱼渐变 / `top-status-bar` / `bg-block` / 消息面底色 spec 与更新后的品牌/默认主题/footer 布局断言。
- `verify-source-budgets`、`verify-doc-refs`、`verify-public-repository-links`、`verify-package-paths`、`verify-md-links`、`verify-md-wrap`、`check-workspace-constraints`：改名清扫后全过。

## Related

- [TUI 审查驱动的加固批次与 visionBridge 探测服务](./2026-08-15-tui-audit-hardening-batch.md)
- [TUI 图片粘贴/剪贴板与视觉桥（opencode-tui 移植）](./2026-08-13-tui-image-paste-and-vision-bridge.md)
