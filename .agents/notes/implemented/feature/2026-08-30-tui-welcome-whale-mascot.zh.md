# Agent Note: 可切换的欢迎页吉祥物——鲸鱼默认，狐狸保留

Status: implemented

[English](2026-08-30-tui-welcome-whale-mascot.md) | 中文

## Problem

本发行版获得了一个像素风鲸鱼吉祥物（举星星的鲸鱼），它比坐姿狐狸更契合 Oh My Tianshu 的身份，启动欢迎页应呈现它。狐狸已经发布、有文档、且有 golden 快照覆盖，直接替换会破坏既有安装户的资产连续性；吉祥物选择是用户偏好与部署级缺省，两者都不属于 agent loop 或组合层。

## Decision

欢迎页 hero 渲染一个可选择的吉祥物。鲸鱼为缺省；狐狸保留，且两者共用 `28×30` / `36×38` 休息档几何，因此 `resolveWelcomeArtWidth` 与 `formatWelcomeHero` 不变，hero 布局与吉祥物无关。

鲸鱼复用狐狸的资产链形状：存档的 `assets/welcome-whale-source.png` 由仓库侧的 `scripts/author-welcome-whale-assets.ts` 制作——裁掉源图的 `DeepSeek </>` / `< Harness >` 文字带，从四边洪水填充把均匀深色背景置为透明（眼睛、描边等内部深色像素不可达而保留），再按不透明边界收紧。`scripts/generate-welcome-whale.ts` 把抠图投影为确定性的生成模块 `src/format/whale-frames.ts`（median-cut 15 色调色板，就近吸附，无误差扩散）。调色板推导、band 吸附、校验与模块渲染集中在 `scripts/welcome-art-shared.ts`，与狐狸生成器共享；狐狸生成模块在抽取后保持字节一致（`verify-welcome-fox` 即回归证据）。运行时渲染不做资产 I/O；`src/format/fox.ts` 拥有共享的索引半块渲染器与通用帧绑定，`src/format/whale.ts` 是对称的鲸鱼入口。

选择在欢迎提交处解析：`prefs.welcomeMascot`（用户经 `/welcome fox|whale` 的选择，持久化到 `~/.dsh-tui/prefs.json`）覆盖 runner 的 `welcomeMascot` 配置（部署级缺省，插件加载时硬校验），配置缺省为 `whale`。`settleWelcome` 在提交时现读偏好，因此结算前的切换立即生效；已结算的欢迎块永不重写，结算后的切换从下次启动生效。零导入的叶模块 `src/format/welcome-mascots.ts` 拥有封闭的吉祥物 id 集合，供渲染分发、`/welcome` 命令、prefs 解析与配置校验共用。

## Alternatives considered

**直接用鲸鱼替换狐狸**——删除已发布、有快照覆盖的资产，并强迫所有安装户换吉祥物且无回头路。两者并存的代价只是一个额外的生成模块与一个配置键。

**切换时就地重写已结算的欢迎块**——scrollback 仅可追加；动画方案当年拒绝重写已提交行，同理成立（终端历史不是画布）。切换刻意在下次启动生效，结算前窗口期则现读生效。

**经 settings 服务而非 prefs.json 持久化**——TUI 的用户级开关（`/bell`、`/info`）本就持久化到 `~/.dsh-tui/prefs.json`，该文件刻意与官方宿主插件共享，让一份偏好在两个发行线间通用；`/welcome` 沿用这条接缝，而不是为一个展示性开关新开 settings 命名空间。

**像狐狸一样制作鲸鱼 sprite sheet**——狐狸的八帧 sheet 是延后动画 pass 的溯源件；鲸鱼只发布单个静态姿势，编造帧等于伪造产品从未委托的美术。

**吉祥物挂在主题上**——吉祥物是产品身份而非配色；主题与欢迎图案保持正交。

## Consequences

新安装户的首次开屏是鲸鱼举星 hero；狐狸只差一条持久化的 `/welcome fox`。`welcome` 加入内置命令名后，`/w` 前缀与 `/workflow` 歧义（前缀解析拒绝之；`/we` 可消歧）。`examples/tui` 的欢迎 golden 快照改录鲸鱼画面，静态门禁在 `verify-welcome-fox` 旁新增 `verify-welcome-whale`。背景抠除的抠图保留了星星的深色光晕——深色主题下读作辉光描边，浅色主题下呈淡淡的暗晕——在 28/36 列尺度下可接受。命令体与图案选择分别落在 `welcome-mascot-command.ts` 与 `welcome-mascot-art.ts`；app 装配层只携带一次注册调用、一对 option/字段与 settle 时的一次查找，残余 +6 行使 `app.ts` 源码预算上限升至 6191——进一步拆薄属于 C4 拆分轨道，不属于本特性。

## Verification

- 生成器覆盖：鲸鱼抠图从存档源字节一致重制作、透明边界检查、两档休息 band 投影为无依赖模块、畸形抠图在产出数据前拒绝；狐狸生成器规格在共享助手抽取后保持绿色。
- 渲染覆盖：鲸鱼 band 几何、字形卫生与宽度校验；app 覆盖以显式狐狸选项对照鲸鱼缺省，并钉住 `/welcome` 的回显、拒绝与 prefs 落盘；runner 覆盖钉住 `welcomeMascot` 的硬校验。
- 真实的 [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY 快照已按鲸鱼画面重录，仍断言零模型网络请求。

## Related

- [能力门控的狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)
- [两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)
- [坐姿狐狸欢迎 splash](./2026-08-25-tui-sitting-fox-welcome.md)
