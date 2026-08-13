# Agent Note: dsh spark reasoning-tail truncation + anchor compensation (internal capability)

Status: implemented

> 日期：2026-08-12 · 类型：feature · 范围：packages/llm/llm-deepseek + packages/context/spark-anchors（新增） 上游参照：opencode-tui 桌面端 `src/pro/spark/`（闭源，外部目录，不进公开仓）

English | [中文](2026-08-12-dsh-spark-port.zh.md)

## Problem

桌面端 spark（推理尾部截断 300 token + 排除路径锚点补偿）是 DeepSeek 官方明文 `reasoning_content` 上的确定性变换：带 tool_calls 的 assistant 消息回传推理时 保留尾部 N token（flash 300 / pro 0），头部排除/分析段丢弃。本移植把该能力 做进 dsh，定位**内部能力**（用户确认：公开前再决定去留，不做付费墙）。

## Decision

**核心原则（继承桌面端 spec）**：截断必须与锚点同时落地，不得单独部署截断—— 锚点是「被截断段落的自足替代物」，防止模型重复推导已排除路径。

**与桌面端的架构差异（dsh 简化）**：
- 桌面端因静态 `PROVIDER_PRESETS` 联合类型需要 pro-registry 运行时注册 + 五消费点 合并视图 + 动态 import 闭源边界；dsh 模型路由是 config 字段驱动，spark 作为 `Config.spark` 开关 + 第二条 provider route（`deepseek-spark`，同 adapter 实例） 即可，无任何运行时注册 hack。
- N 会话 meta 固化（桌面端防 env 漂移）在 dsh 等价为「配置驱动即固化」： N 来自 adapter config（settings 文档持久化），配置稳定 → 确定性截断 → 前缀字节稳定。 未引入 session 事件固化（dsh session 无 metadata 面，成本不成比例）。

**Wave 1 — llm-deepseek 截断**（d17b414）：
- `src/spark.ts`（新）：`truncateReasoningTail` / `defaultTokenizer`（退化分词， CJK 单字 + 拉丁串 + 空白，u flag 码点匹配）/ `truncateCutStart` / `resolveTruncateN` （分段词匹配防 `includes('pro')` 误命中）/ `extractExcludedClaims`（中英排除句 正则，宁缺毋滥，>4 字符过滤）——逐字移植自桌面端
- `Config.spark`（schemastery：enabled 默认 false / truncateN flash 300 pro 0）+ `resolveAdapterOptions` fail loud 校验
- `serializeRequest`：仅 `deepseek-spark` route + enabled 时按模型档截断 `reasoning_content`（构造 wire 对象时应用，天然 copy-on-write，session log 原始 推理不受影响）
- `registerAdapter` 双 route + configurable provider 'DeepSeek Spark' + providerInfo 区分

**Wave 2 — spark-anchors 锚点插件**（3bcae85）：
- 新包 `packages/context/spark-anchors`：`agent/pre-step` waterfall，读 session 历史 assistant reasoning → `truncateCutStart` 判定截断丢失域 → `extractExcludedClaims` 提取 → 去重（保首现序）→ cap 20 淘汰最旧 → 内容与上次注入不同才 `createUserMessage` 注入（plugin-source，form: snapshot）
- **与 wire 截断精确互补**：同一 N 同一 tokenizer；N 从 `llm-deepseek` settings 命名空间同源读取（`ctx.settings.get`），无 settings 回落默认——消除桌面端 「两边配置漂移」风险
- 字节稳定短路：扫描 session 事件找上次注入文本比对（无内存状态，resume 安全）
- 非 spark 零注入：`request/header` 折叠判定 route，首个请求前 `agentDefaultModel` 兜底
- invariant 伴生插件（注入消息必须含非空文本块）

## 验证

- Wave 1：spark.spec 25 + spark-wire.spec 14（RED→GREEN）；llm-deepseek 189/189 绿
- Wave 2：anchors.spec 12 + prestep.spec 4（真实装配，不 mock 中间层）； 两包 205/205 绿
- Wave 3：loader-composition +2 装配冒烟（真实 Loader + mock API：spark enabled 截断 400→100 token、disabled 完整回传）；llm/context 组全量回归
- TUI：commands.spec 98/98、TUI 全量 1418/1418 绿
- typecheck（两包 tsc exit 0）+ oxlint 0 错


## Files

- `packages/llm/llm-deepseek/src/spark.ts`（新）：截断/分词/锚点提取纯函数
- `pack
## Consequences

**待验证假设**（不写进结论）：真实 API 无 400（桌面端已实证同端点同字段， 标「预期沿用」）；质量探针（重复工具调用率对照）列公开前决策输入。

ages/llm/llm-deepseek/src/serialize.ts`：RequestDefaults.spark + wire 截断
- `packages/llm/llm-deepseek/src/index.ts`：Config.spark + 双 route + 算法面导出
- `packages/llm/llm-deepseek/src/adapter.ts`：providerInfo 区分
- `packages/context/spark-anchors/`（新包）：src/index.ts + src/invariant.ts + 测试 ×2
- `packages/tui/tui/src/commands/registry.ts`：/model 别名
- `tsconfig.host.json`：spark-anchors 登记
- 测试：spark.spec / spark-wire.spec / anchors.spec / prestep.spec / loader-composition +2 / commands.spec +2

## Alternatives considered

**spark 独立 key（桌面端 DEEPSEEK_SPARK_API_KEY）**——未实现。dsh adapter 的 key 解析是 connection 级单值（`resolveApiKey(connection)` 无 route 参数），route 级独立 key 需改公共接口；内部自用阶段复用主 key，将来需要时加 provider 参数即可（接口已留）。

**锚点走 system-prompt context() 动态区**——否决。context() 是注册时静态提供者， 拿不到消息历史；`agent/pre-step` + createUserMessage 是 dsh 既有动态注入范式 （time-context 同款），且注入进 session log（Model-visible ⟺ logged 天然满足）。

**锚点状态落 session 专用事件 + fold**——否决（简化）。锚点从会话历史派生 （每条消息一次确定性提取），无持久化状态；字节稳定由「与上次注入文本比对」短路 保证，resume 后派生结果一致，无需 fold。
