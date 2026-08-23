# TUI 狐狸欢迎设计

[English](2026-08-22-tui-fox-welcome-design.md) | 中文

本文档仍负责品牌层级、抠图出处、结算原因，以及恢复历史写在欢迎页之前的顺序。狐狸尺寸、标题布局、调色板投影和静态挂载见 [2026-08-23-tui-fox-welcome-clarity-design.md](2026-08-23-tui-fox-welcome-clarity-design.md)。

## Goal

用透明动画狐狸与参考式分栏 hero 替换既有鲸鱼欢迎卡。欢迎页将产品标识为 `Oh My Tianshu`；`DeepSeek Harness` 与 `Tianshu Harness` 仍是平级 harness，为避免重复「Harness」而紧凑显示为 `DeepSeek ◆ Tianshu Harness`。

本改动只影响展示。它不增加模型可见输入、会话事件、持久化字段或 agent-loop 行为。

## Visual contract

源插画从其桃色 JPEG 背景抠出，并缩减为透明索引精灵。宽布局把狐狸放在左侧、品牌列放在右侧：

- 紧凑五行像素 wordmark 渲染 `Oh My Tianshu`。
- 下一行渲染 `DeepSeek ◆ Tianshu Harness`；`◆` 使用品牌强调色，两个名称视觉权重相等。
- 模型与 effort、会话工作目录，以及一条稳定启动贴士跟在平级行下方。
- 既有顶部栏仍在 hero 之上。
- 可恢复会话列表、随机贴士行为、输入框与 footer 保留当前职能。
- 圆角欢迎卡边框与快捷键列表列被移除。

创作与生成帧为规范 `96 × 72` 像素。运行时把每帧投影/降采样进固定的 `40 × 30` 像素 / `40 × 15` 单元格分配，使用半块字形；该分配不随终端放大。分栏 hero 至少需要 92 列与 24 行，使画面、三列字形 wordmark、平级行与输入 chrome 不会换行或被裁切。更小视口、无色输出，以及遗留全宽块字形终端改渲染纯文本欢迎。

## Opening motion

狐狸在每次 TUI 进程 attach 播放一次 3,240ms 开场，然后冻结在规范蜷曲姿势。动效组合轻微摆尾、两次呼吸节拍、一次睁眼眨眼与星光闪烁。八个互异索引帧可被多个时间线步骤复用；所有帧边界相同，因此旁侧文本永不位移。

既有 120ms TUI ticker 驱动动画。帧选择由 `performance.now()` 与累计时间线时长推导，因此延迟 tick 会跳过已过期帧，而不是拉长开场。狐狸运动时，wordmark 与环境文本保持静态。

`welcomeAnimation` 是经验证的 `TuiRunnerConfig` 字段：

- `auto` 为缺省，仅在输出是交互彩色 TTY、宽度与高度足够，且块字形宽度模式受支持时播放。
- `off` 跳过动效，但在画面本身受支持处仍保留静态狐狸。

动画时长与帧时序是固定展示常量，而非部署可调项。

## Source and generated assets

可编辑资产为 `packages/tui/tui/assets/` 下的 `welcome-fox-source.jpg`（提供的插画）、`welcome-fox-cutout.png`（已批准的透明抠图）与 `welcome-fox-sprite-sheet.png`（八个 `96 × 72` 帧组成的 `768 × 72` 横向图集：规范帧加七个动效变体）。源图与抠图留在图集旁，供日后重绘与溯源；进入已发布运行时的只有生成的 TypeScript。

确定性仓库脚本读取图集，应用已批准的固定调色板与 alpha 阈值，并生成 `packages/tui/tui/src/format/fox-frames.ts`。运行时代码只消费生成的调色板索引与时间线；永不打开资产或调用 `sharp`。

生成模块记录 `96 × 72` 帧尺寸、调色板条目、索引行、时间线步骤与规范终帧 id。顶层已执行门禁在内存中再生，并拒绝过期输出、非法调色板索引、不等帧尺寸、缺失终帧或意外总时长。

## Rendering components

`src/format/fox.ts` 把一帧索引帧转为 ANSI 半块行。每个单元格代表两个竖直像素：两像素皆不透明时在 `▀` 上使用前景加背景；仅一像素不透明时在默认背景上使用 `▀` 或 `▄`；两像素皆透明则不绘制。离开混合单元格时，每行显式恢复默认背景并以 RESET 结尾；尾随透明单元格省略。

真彩与 256 色轨使用已批准的狐狸调色板。16 色轨把调色板映射到稳定命名近似色。颜色等级为零时不画剪影，因为会失去可识别的毛色、青绿尾巴与金星对比。

`src/format/welcome.ts` 拥有静态欢迎组合与宽度守恒。其输入携带已渲染画面行及其固定宽度，而不是导入吉祥物专用全局常量。该模块渲染宽分栏 hero、紧凑文本回退、最终可恢复会话区与启动贴士，不含定时器或可变状态。

过时的鲸鱼渲染器、圆角欢迎卡与快捷键列渲染器随其测试与导入一并移除。既有随机贴士与可恢复会话投影行为保留。

## Lifecycle ownership

`WelcomeIntroController` 拥有进程局部 intro 状态：不可变欢迎快照、单调开始时间、当前时间线位置，以及已结算/已取消状态。它不拥有定时器；app 从既有 ticker 提供当前时间。

启动把环境、会话行、已选贴士、路由展示、cwd、分支与规范最终输出准备为一份快照，然后立即提交顶部栏。一旦输入、resize 与 ticker 处理器已安装，`renderLive()` 把当前动画 hero 前置到普通 live 区动态段，同时把输入 chrome 作为保留尾部加以保护。

恢复列表与最终贴士在短动画期间保持挂起。其数据已可用，因此开场中按下的欢迎数字键能先结算 intro，再把该数字路由到既有恢复行为。

`settleWelcome(reason)` 是唯一提交点，且幂等：

1. 在终端写入前把 controller 标为已结算。
2. 清除临时 live 区。
3. 按最新终端尺寸与当前主题重算规范最终欢迎。
4. 恰好一次批量提交最终 hero、可恢复会话行与贴士。
5. 渲染普通 live 区。

自然完成与普通输入走此提交路径。输入结算在原按键继续进入正常路由之前完成，因此不丢按键。resize 按新尺寸结算，而不是重放。dispose 取消 controller，经正常拆卸清除临时输出，且不做最终欢迎提交。命令行初始提示词走同一输入结算路径。

intro 不计入 `dynamicRowsHighWater`；结算后，普通 live 渲染从既有空会话预算开始。

## Failure and degradation

无效配置在插件加载时失败。无效或过期的精灵数据使生成门禁与测试失败，而不是在运行时降级。

不受支持的颜色深度、尺寸或字形宽度在动画开始前选择确定性文本回退。跨越能力边界的 resize 直接结算为新尺寸下的回退。渲染只使用 `LiveEngine`；不发出独立光标移动、清屏、kitty 或 iTerm2 图像命令。

最终静态输出由规范终帧计算，永不从最近显示的动画帧拷贝。这使自然完成、跳帧、中断动画与禁用动画启动保持等价。

## Verification

纯渲染器测试覆盖帧尺寸、调色板合法性、半块选择、显式背景复位、行 RESET、显示宽度边界、固定画面对齐、真彩/256/16 色输出，以及纯文本能力回退。

controller 测试用伪单调时钟覆盖每个时间线边界、延迟 tick 跳帧、自然完成、输入结算、resize 结算、重复结算与 dispose。它们断言一次最终提交、无迟到渲染，以及触发输入被保留。

欢迎组合测试钉住 `Oh My Tianshu` wordmark、`DeepSeek ◆ Tianshu Harness` 平级行、宽分栏布局、紧凑回退、最终恢复列表与随机贴士稳定性。

app 与终端缓冲测试覆盖 `LiveEngine` 事务。自然完成后的解释终端状态必须等于禁用动画的静态启动；开场中途 resize 后也要求同样等价。live 区帧数保持有界，输入框仍然存在。

可运行的 `examples/tui` 组合新增 keyless Loader-plus-PTY 场景与稳定输出快照。真实 PTY 会观察动画预览的出现与随后结算；golden 只记录结算后的终态面。中间时序由 controller 测试钉住。已发布路径验证在跑 built 冒烟前先构建 TUI bundle。

## Documentation and decision records

更新两种语言的 TUI README 及其翻译记录，写入品牌层级、动画配置、能力回退与启动打断行为。

为狐狸 intro 新增 Agent Note，并交叉链接部分被取代的 `2026-08-15-oh-my-tianshu-rebrand` 决策——其欢迎卡形态与推迟动画的结论不再适用。旧 note 保持活跃，因为其主题与仓库品牌决策仍属当前。将会话恢复可见性 note 中的「welcome card」改为「welcome area」，不改其恢复语义。

## Alternatives rejected

运行时 `sharp` 解码被否决，因为即便每帧在发布时已固定，启动仍会依赖原生图像工作与异步解码。

Kitty 与 iTerm2 图形动画被否决，因为协议图像有独立生命周期与清理语义，在终端与多路复用器间行为不一致，并复杂化 scrollback 结算。

硬编码预渲染 ANSI 字符串被否决，改为调色板索引帧，因为索引数据可校验、可按终端色轨重着色，并能以显式背景复位保证渲染。
