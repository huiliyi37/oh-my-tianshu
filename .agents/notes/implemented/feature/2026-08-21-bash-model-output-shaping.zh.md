# Agent Note：bash 模型输出成形

Status: implemented

[English](2026-08-21-bash-model-output-shaping.md) | 中文

## 问题

bash 结果的模型可见正文保留执行器采集的全部内容（最多 64KB 尾段）：冗长的成功命令把整个 happy-path 日志灌进上下文，失败命令的真实错误被淹没在输出墙里。token 花费与上下文膨胀毫无信息收益——上游天枢仓实测 61% 的 cacheCreate token 来自轮内工具结果增长，并把 rtk 的每命令过滤内生化成分层 output-store 策略。

## 决策

`dsh-tool-bash` 现在对前台模型可见正文成形（上游 `output-store` 脉络，内生化于 `packages/bash/tool-bash/src/model-output.ts`）：

- 成功正文超过 `outputSuccessTailLines`（缺省 20；0 关闭）折叠为尾部行并附精确省略计数。
- 失败正文超过 `outputErrorThresholdLines`（缺省 40）保留错误相关行——诊断词汇 regex 命中 ±2 行上下文，外加头 3/尾 2 锚——总量不超过 `outputErrorBudgetLines`（缺省 60）；命中数本身超预算时回退为同预算的确定性头尾切分。
- 不超过阈值的正文逐字节原样通过。只删不编；每次省略都带计数（继承纪律：小输出不动、只删不编、丢内容必留标记、原文可恢复）。

恢复：成形省略任何内容之前，完整组合正文（stdout + stderr 段，含执行器截断通知）先落盘 `ctx.spillStore`，省略通知携带定位符（前台值的 `outputSpillPath`）。重跑命令永远不是恢复手段——命令可能有副作用。设计上 best-effort：无 spill 后端、无会话主或落盘失败都降级为不带路径的省略计数，绝不使调用失败。

每命令过滤器（P2，同一提交族）：`command-filters.ts` 在通用成形**之前**压缩三个最高频噪音族——超 30 行的 git log 保留 ≤`gitLogMaxCommits`（15）个最新 commit（剥 Author/Merge/trailer、消息 ≤3 行、行宽 120；自定义 --format 原样），超 40 行的 git diff 每 hunk 封顶 60、总量 300、每文件附 `# +A -R` 计数，可识别测试运行超 15 行保留失败块（±5 上下文、锚）于 `testRunMaxLines`（120）内。被策展的正文跳过通用成形（再折叠策展输出会保错端——这个次序正是过滤器住在 render 管线而非 `tools/post-execute` 插件的原因：post-execute 在 render 之后运行，只能看到已折叠的文本）。未过滤原文经同一谓词扩展先行落盘。

环境失败诊断（P3）：exit 126/127/130/137/143 且正文只有壳层一两行时，在锚定的 exit 标记之前插入一行标准化 `[environment: …]` 诊断（语义 + 勿盲目重试指引），终端 pill 解析契约不变；有真实输出的正文不诊断。

落点：成形函数是工具本地的（无跨包运行时依赖）；执行器自身的上限（64KB 内存尾段 + spill）与通用 `spill-policy` post-execute 上限（50KB，已在发货 `dsh-base` bundle 挂载）是其下/其上的不变层。`dsh-tool-pwsh` 今天只复用标记契约；把成形提升进 `dsh-bash` 等待真实的 pwsh 消费者出现。

## 备选方案

- **以 `tools/post-execute` 插件承载成形**（spill-policy 所用 seam）对比落地后的 render 管线位置。`output.render` 先于 post-execute 瀑布运行，插件只能看到已被通用层折叠的文本——对 `git log`（新在前）而言那次折叠保错了端——且拿不到成形决策所需的命令与结构化结果。管线位置让每命令过滤器先跑、并能让策展正文跳过通用折叠。
- **成形函数放共享 `dsh-bash`** 供 `dsh-tool-pwsh` 复用，对比工具本地文件。今日没有 pwsh 消费者（投机泛型），且跨包运行时导入解析到包的构建 `lib/`，破坏源面测试解析——真实消费者出现时再提升。
- **集成 rtk 二进制**（上游早期路径）对比内生化。rtk 引入外部依赖与健康探针面；上游自己也已把策略内生化。本仓三个过滤器族覆盖实测高频元凶，零二进制依赖。

## 代价与收益

买到：冗长成功输出与失败输出墙不再灌进上下文（上游实测大部分 cacheCreate token 正来自这种轮内增长）；失败保留错误相关行且省略计数精确；被丢弃的每个字节都经 spill 路径可恢复、无需重跑有副作用的命令；阈值可部署配置、装载期校验。

代价：模型看到的少于执行器采集的——恢复依赖省略通知被遵循；成功折叠可能藏掉成功尾部之前的早期告警（尾部阈值可调低）；渲染文本不再与结构化正文逐字节一致，解析 envelope 的消费方（今日除锚定存活的 exit 标记外无）须走结构化值。

## 验证

- 纯函数（`model-output.spec`）：正文组合（stderr 段、执行器截断通知）、丢弃判定（阈值、0 关闭）、成功折叠（精确计数、单复数、尾换行、spill 后缀）、错误精选（头/窗口/尾锚、缺口标记、超预算头尾回退）。
- 工具级真实执行器（`tools.spec`）：`seq 1 50` 折叠为 `[30 earlier lines omitted]`；真实失败的 61 行命令保留 `FATAL:` + 尾锚 + 末尾 `[exit code: 1]`；spill 接线保存完整正文并在通知中给出 `/spill/bash.txt`；无后端/无 agent 的调用诚实降级；短输出逐字节不变。
