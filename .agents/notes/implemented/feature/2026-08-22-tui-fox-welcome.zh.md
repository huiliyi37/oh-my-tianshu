# Agent Note: 能力门槛狐狸启动欢迎

Status: implemented

[English](2026-08-22-tui-fox-welcome.md) | 中文

## Problem

启动面需要确立 Oh My Tianshu 的身份，又不能让装饰性渲染成为运行时依赖，也不能削弱终端历史。现场开场还必须立刻让位于用户意图、resize 与启动自动化；为动画而扣住或改写已提交行，会使首次交互比它所引入的界面更不可靠。

## Decision

TUI 拥有一套仅展示的启动欢迎。在能承载狐狸档、且支持彩色与窄半块字形的终端上，`formatWelcomeHero` 把所选休息档狐狸放在 splash 身份左侧。档位尺寸、折行与紧凑文本回退由[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)拥有。splash 文案与坐姿抠图由[坐姿狐狸欢迎](./2026-08-25-tui-sitting-fox-welcome.md)拥有。详情列显示所选模型、其有效 effort、cwd 与发行版本。

`prepareWelcome` 向 `formatWelcome` 提供至多三行编号恢复行与一条已选 `Tip:`，由后者拥有最终有界块。没有 live hero 预览，因此恢复选项与贴士只在结算结果中出现一次。窄、矮、无色与全宽块字形终端通过紧凑文本形式保留同一身份与元数据。

仅限仓库的资产链从 `assets/welcome-fox-source.png` 确定性写出 `assets/welcome-fox-cutout.png` 与八帧 768×72 的 `assets/welcome-fox-sprite-sheet.png`（八个相同的 96×72 休息帧）。运行时渲染只导入生成的索引与固定调色板；不读 PNG 资产，不触碰文件系统，也不加载 `sharp`。图集是后续动效的溯源；生成模块的休息档内容由[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)拥有。

`welcomeAnimation` 是唯一公开控制项。它接受 `auto` 或 `off`，缺省为 `auto`，其他值 fails loud。只要画面受支持，两个值都提交同一只静态狐狸。[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)拥有静态挂载与闲置的帧时序。回退到紧凑文本的能力门槛仍是产品常量，而非部署可调项。

`WelcomeIntroController` 拥有一份不可变启动快照，以及单向的 active → settled 或 active → cancelled 转移。会话挂载阶段的恢复历史——恢复横幅、回放的 transcript 与恢复分隔符——直接写入并位于欢迎之前。挂载完成且欢迎取得启动所有权之后，attach 立即结算规范终态；首次按键输入、bracketed paste、命令行初始提示词、resize，以及后续 scrollback 提交，都保持该已结算块与挂起动作屏障，再继续触发动作或条目；该屏障不拦截挂载期的恢复提交。结算按当前终端尺寸组合，并经 `CommitEngine` 提交终块一次。dispose 取消且不做迟到的终态提交。自动密钥设置仅在非输入结算后打开；输入则取消挂起的 overlay。

解析有效 effort 是装饰性元数据：显式路由值优先，模型目录查找带一秒可取消边界，并在缺席、失败或超时时显示 `auto`。dispose 中止查找并阻止迟到的欢迎写入。欢迎不增加模型可见输入、会话事件、持久化行为或 agent-loop 行为。

## Alternatives considered

**保留圆角鲸鱼卡** — 它保留了较早的 chrome，但吉祥物与产品 wordmark 仍从属于通用卡框。狐狸分栏布局在宽屏给出清晰身份层级，同时保留紧凑文本回退。

**运行时用 `sharp` 解码 PNG 资产** — 会把原生图像解码、包内资产、文件系统访问与运行时失败模式放上启动路径。入库的索引 TypeScript 使启动独立于创作工具链，并让生成器可离线验证可复现性。

**始终动画或始终静态** — 单一的始终开场会拖慢无法承载狐狸的终端；删除 `welcomeAnimation` 会失去显式 `off` 与 fails-loud 校验。该字段仍是 `auto|off`；[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)拥有「两个值都提交同一只静态狐狸」这一决定。

**每帧擦除并改写终端历史** — 已提交行不是画布，resize 可能把它们移入受保护的 scrollback。预览留在 live 区、只追加一块规范终块，可保全时序历史。

## Consequences

首屏有一套品牌层级与一种结算表示。启动新增入库源图、抠图、溯源图集、生成休息档模块与生成器检查。[两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)拥有档位几何与静态挂载。不受支持的终端失去狐狸，但仍以文本保留全部启动元数据。

资产创作依赖留在运行时之外，固定生成模块可评审且可复现。仅追加边界使整项功能落在模型、会话、持久化与循环约定之外。

## Verification

- 生成器覆盖重建抠图、768×72 溯源图集、两档休息网格、无依赖生成模块，以及畸形资产拒绝路径。
- formatter、controller、runner 与 app 覆盖钉住响应式回退、平级品牌文案、元数据回退、配置校验、结算顺序、取消、延迟密钥设置，以及 `auto`/`off` 缓冲等价。
- 真实 [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY 快照覆盖 source 与 built 启动平面，只记录结算后的 100×40 中档面，并断言零次模型网络请求。

## Related

- [两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)
- [坐姿狐狸欢迎](./2026-08-25-tui-sitting-fox-welcome.md)
- [Oh My Tianshu 改版](./2026-08-15-oh-my-tianshu-rebrand.md)
- [TUI 欢迎页打磨](./2026-08-13-tui-welcome-page-polish.md)
- [TUI C4 概念稿 Wave 1+2](./2026-08-12-tui-c4-concepts-w12.md)
- [TUI C4 概念稿 B 布局 Wave](./2026-08-12-tui-c4-b-layout-bottom-bar.md)
- [会话恢复可见性链](./2026-08-20-session-resume-visibility.md)
