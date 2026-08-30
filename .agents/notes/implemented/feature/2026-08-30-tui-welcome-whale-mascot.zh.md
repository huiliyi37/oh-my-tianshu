# Agent Note: 可切换的欢迎页吉祥物——鲸鱼默认，狐狸保留

Status: implemented

[English](2026-08-30-tui-welcome-whale-mascot.md) | 中文

## Problem

本发行版获得了一个像素风鲸鱼吉祥物（举星星的鲸鱼），它比坐姿狐狸更契合 Oh My Tianshu 的身份，启动欢迎页应呈现它。狐狸已经发布、有文档、且有 golden 快照覆盖，直接替换会破坏既有安装户的资产连续性；吉祥物选择是用户偏好与部署级缺省，两者都不属于 agent loop 或组合层。

## Decision

欢迎页 hero 渲染一个可选择的吉祥物。鲸鱼为缺省；狐狸保留，且两者共用 `28×30` / `36×38` / `44×46` 休息档几何（分别对应 80/105/140 列），因此 `resolveWelcomeArtWidth` 与 `formatWelcomeHero` 保持与吉祥物无关。

鲸鱼复用狐狸的资产链形状：存档的 `assets/welcome-whale-source.png` 由仓库侧的 `scripts/author-welcome-whale-assets.ts` 制作——裁掉源图的 `DeepSeek </>` / `< Harness >` 文字带，从四边洪水填充把均匀深色背景置为透明（眼睛、描边等内部深色像素不可达而保留），再按不透明边界收紧。`scripts/generate-welcome-whale.ts` 把抠图投影为确定性的生成模块 `src/format/whale-frames.ts`（median-cut 15 色调色板，就近吸附，无误差扩散）。由于鲸鱼抠图是像素画原作的高分辨率渲染，投影前先恢复其原生像素网格（155×118，每个艺术像素 ≈ 6 个源像素，实测自抠图的主结构游程长度），再从该网格采样 band——一步 nearest 在 20–33 倍缩减下亚采样会摧毁星星、眼睛高光等小形体。狐狸制作时已接近原生分辨率，保持一步投影与字节一致的 band。调色板推导、band 吸附、校验与模块渲染集中在 `scripts/welcome-art-shared.ts`，与狐狸生成器共享；狐狸的 28/36 档在抽取后保持字节一致（`verify-welcome-fox` 即回归证据）。运行时渲染不做资产 I/O；`src/format/fox.ts` 拥有共享的索引半块渲染器与通用帧绑定，`src/format/whale.ts` 是对称的鲸鱼入口。

hero 细节栏够宽（40 列——所有带图案的宽度）时，品牌渲染为半块像素字标：`Oh My` 小字 kicker 行在上，`Tianshu` 以手绘 10 行混合大小写字体（`src/format/block-text.ts`，字形行两两并入半块格，纵向分辨率是全块字体的两倍）居中，下方是标注由来的 `< tianshu harness · from deepseek >` 小字行；无图案（紧凑）终端保留单行 `Oh My Tianshu >` / `< Harness >` 文本。品牌栈低于每个档位的行预算，hero 布局不变。

选择在欢迎提交处解析：`prefs.welcomeMascot`（用户经 `/welcome fox|whale` 的选择，持久化到 `~/.dsh-tui/prefs.json`）覆盖 runner 的 `welcomeMascot` 配置（部署级缺省，插件加载时硬校验），配置缺省为 `whale`。`settleWelcome` 在提交时现读偏好，因此结算前的切换立即生效；已结算的欢迎块永不重写，结算后的切换从下次启动生效。零导入的叶模块 `src/format/welcome-mascots.ts` 拥有封闭的吉祥物 id 集合，供渲染分发、`/welcome` 命令、prefs 解析与配置校验共用。

## Alternatives considered

**直接用鲸鱼替换狐狸**——删除已发布、有快照覆盖的资产，并强迫所有安装户换吉祥物且无回头路。两者并存的代价只是一个额外的生成模块与一个配置键。

**切换时就地重写已结算的欢迎块**——scrollback 仅可追加；动画方案当年拒绝重写已提交行，同理成立（终端历史不是画布）。切换刻意在下次启动生效，结算前窗口期则现读生效。

**经 settings 服务而非 prefs.json 持久化**——TUI 的用户级开关（`/bell`、`/info`）本就持久化到 `~/.dsh-tui/prefs.json`，该文件刻意与官方宿主插件共享，让一份偏好在两个发行线间通用；`/welcome` 沿用这条接缝，而不是为一个展示性开关新开 settings 命名空间。

**像狐狸一样制作鲸鱼 sprite sheet**——狐狸的八帧 sheet 是延后动画 pass 的溯源件；鲸鱼只发布单个静态姿势，编造帧等于伪造产品从未委托的美术。

**吉祥物挂在主题上**——吉祥物是产品身份而非配色；主题与欢迎图案保持正交。

**鲸鱼一步 nearest 下采样**——929 列中采样 36 列是对艺术原生像素的亚采样，星星会塌缩成不可辨认的色块；先恢复 116×88 原生网格可让每个形体在档位尺度下仍可寻址。

**调色板推导时给星星区域加权**——median-cut 本就把奶油色星星隔离成盒（离群色必得独立盒）；加权反而从腹部抢走色槽，把奶油色伪影涂到腹部上。调色板保持不加权。

**复用现成大字/figlet 依赖**——仓库未 vendor 此类依赖，而字标只需七个字形；手绘字体比任何新依赖都小，且与吉祥物的像素网格精确对齐。

**全块 5 行字体**——第一版出货的字形块状笨重，终端尺度下读作模糊；十行字形两两并入半块格，同样五个终端行内纵向分辨率翻倍，曲线清晰。

## Consequences

新安装户的首次开屏是超大块字标下的鲸鱼举星 hero；狐狸只差一条持久化的 `/welcome fox`。`welcome` 加入内置命令名后，`/w` 前缀与 `/workflow` 歧义（前缀解析拒绝之；`/we` 可消歧）。`examples/tui` 的欢迎 golden 快照改录两步法鲸鱼画面、半块字标与由来小字行，静态门禁在 `verify-welcome-fox` 旁新增 `verify-welcome-whale`。背景抠除的抠图保留了星星的深色光晕——深色主题下读作辉光描边，浅色主题下呈淡淡的暗晕——在档位尺度下可接受。命令体与图案选择分别落在 `welcome-mascot-command.ts` 与 `welcome-mascot-art.ts`；app 装配层只携带一次注册调用、一对 option/字段与 settle 时的一次查找，残余 +6 行使 `app.ts` 源码预算上限升至 6191——进一步拆薄属于 C4 拆分轨道，不属于本特性。欢迎面测试锚点统一为 hero 专属的 `Oh My` 文本行（两种品牌模式均在）；`█` 系负向锚点不可用，因为 live 区的输入光标就是全块。

## Verification

- 生成器覆盖：鲸鱼抠图从存档源字节一致重制作、透明边界检查、三个休息 band 经恢复的原生网格投影为无依赖模块、畸形抠图在产出数据前拒绝；狐狸生成器规格在共享助手抽取与新增 44 列档后保持绿色。
- 渲染覆盖：鲸鱼与狐狸全部三档的几何、字形卫生与宽度校验；hero 覆盖钉住 40 列以上的半块字标、紧凑路径的单行文本回退，以及不变的 hero 行预算；app 覆盖以显式狐狸选项对照鲸鱼缺省，并钉住 `/welcome` 的回显、拒绝与 prefs 落盘；runner 覆盖钉住 `welcomeMascot` 的硬校验。
- 真实的 [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY 快照已按两步法鲸鱼画面与块字品牌重录，仍断言零模型网络请求。

## Related

- [能力门控的狐狸启动欢迎](./2026-08-22-tui-fox-welcome.md)
- [两档静态狐狸欢迎](./2026-08-23-tui-fox-welcome-clarity.md)
- [坐姿狐狸欢迎 splash](./2026-08-25-tui-sitting-fox-welcome.md)
