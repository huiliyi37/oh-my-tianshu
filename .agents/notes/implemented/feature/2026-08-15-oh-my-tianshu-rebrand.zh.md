# Agent Note: Oh My Tianshu 改版——产品身份、琥珀默认主题、仓库改名

Status: implemented

[English](2026-08-15-oh-my-tianshu-rebrand.md) | 中文

## Problem

TUI 的视觉身份滞后于产品的公开定位：欢迎页还挂着内部 `DSH` 品牌，默认 `graphite` 主题读起来是泛中性风，仓库名 `dsh-tianshu-build` 说的是构建线而不是产品。以 oh-my-pi（omp）与 oh-my-dsh 为交互参照，产品定位为 **Oh My Tianshu**——界面应当带有 omp 风格的识别特征，仓库名应与产品一致。

## Decision

改版决策确立产品身份、默认调色板与仓库名：

- **品牌**：产品身份为 `Oh My Tianshu` / `Tianshu Harness`。包名（`@huiliyi37/dsh-*`）与 CLI 名（`oh-my-tianshu`）不动——改名只到仓名与产品品牌。
- **`omp` 主题（新默认）**：新琥珀强调色调色板（`packages/tui/tui/src/theme-palettes.ts`：primary `#febc38`、石板灰阶、暖金用户导轨），登记在 `THEME_PALETTES` 首位；`autoThemeFor` 暗背景映射到 `omp`（亮背景保持 `paper`），`theme.ts` 初值跟随。`graphite` 与其余 15 个主题保留，`/theme` 可切。
- **启动身份，部分被取代**：[能力门槛狐狸欢迎](./2026-08-22-tui-fox-welcome.md) 取代本 note 的圆角鲸鱼卡及其推迟 live intro 的决策。它拥有当前狐狸资产、响应式 wordmark、动画、结算与紧凑回退；本 note 继续拥有产品身份、默认主题、仓库改名，以及消息/chrome 面。
- **改名**：GitHub 仓 `huiliyi37/dsh-tianshu-build` → `huiliyi37/oh-my-tianshu`；全仓被跟踪的硬编码 URL 清零（`git grep dsh-tianshu-build` = 0），含各包 `repository.url`、文档链接与断言仓身份的检查脚本。

段式状态栏嵌进输入框顶边（`format/top-status-bar.ts`——左身份段 primary、右 metrics 段 muted、secondary 横线填充、窄宽从右丢段、ascii 降级）；`formatInputFrame` 接受预渲染 `topLine` 并与状态栏共用 `promptBorderColor`，整条顶边随模式变色（plan warning / always-approve error / normal 雾蓝）；footer 只留模式徽标 + 快捷键提示。

主题系统暴露可选 truecolor `SurfaceSet`——`userMsgBg` 与 `toolPendingBg`/`toolSuccessBg`/`toolErrorBg`——供 `omp` 与 `graphite` 调色板及继承的自定义主题使用；16 色 fallback 轨省略它并保持导轨/无底色样式。`format/bg-block.ts`（`withBgFill`/`withBgFillLines`）把行垫底色补到整宽；存在 `userMsgBg` 时用户消息渲染为整宽暖底气泡，工具卡正文按状态垫底色，diff 卡保持自绘色，`width` 经 `renderTranscript` options 接入各卡渲染器。`chromeBg` 把输入框顶边状态栏整行着为铬区色带。

## Alternatives considered

- **全量改名（含包名与 CLI）**：`@huiliyi37/dsh-*` 与 `oh-my-tianshu` 命令涉及数百处引用、发版链路与已装 profile，是独立的工程线。本波否决——用户可见品牌与仓名已足够承载身份。
- **就地改色 `graphite`**：会悄悄改变每个既有安装的外观，并抢占用户可能钉住的名字。新注册调色板让 `/theme graphite` 保持可用。
- **渐变作为鲸鱼默认**：因被取代的欢迎卡而否决——平色品牌蓝是既定的 256/16 色渲染。该选择不再约束当前狐狸；其索引调色板与文本回退属于 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md)。
- **本地检出目录同步改名**：纯装饰且打断会话；远端身份变更，本地目录名保持。

## Consequences

首屏经响应式狐狸 wordmark 与平级 `DeepSeek ◆ Tianshu Harness` 行读作 Oh My Tianshu，全部已注册主题仍可切换。GitHub 改名后旧 URL 自动重定向，清扫保证本地、CI 与文档引用指向新身份。`omp` 调色板、顶边状态栏与消息/chrome 表面色调仍是本 note 的当前约定；启动渲染与历史所有权属于 [狐狸欢迎决策](./2026-08-22-tui-fox-welcome.md)。

## Testing

- 主题、top-status-bar、背景填充与消息面 spec 钉住仍存的调色板与 chrome 约定。
- 当前首屏渲染、贴士选择、响应式回退与动画由 [狐狸欢迎各层](./2026-08-22-tui-fox-welcome.md#verification) 验证，而非已移除的卡或鲸鱼 spec。
- 仓库身份仍由 public-repository-link、package-path、documentation-link 与 workspace-constraint 检查覆盖。

## Related

- [能力门槛狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)
- [TUI 审查驱动的加固批次与 visionBridge 探测服务](./2026-08-15-tui-audit-hardening-batch.md)
- [TUI 图片粘贴/剪贴板与视觉桥（opencode-tui 移植）](./2026-08-13-tui-image-paste-and-vision-bridge.md)
