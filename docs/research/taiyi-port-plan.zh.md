# 太一词回流计划：dsh 侧 taiyi persona 移植

[English](taiyi-port-plan.md) | 中文

本计划承接《[opencode-tui（天枢 TUI）全程中文思考与稳定心流机制调研](opencode-tui-chinese-thinking-flow.md)》，把上游天枢 TUI「太一星域」实验中可移植的部分带回本仓库 tianshu-public（下文称 dsh）。 本文档是计划，不含实施；实施以独立变更进行，实施前须按本计划验收条款逐条核销。

## 背景与范围

太一是上游的对抗性 prompt 实验域：提示词不写任何开发工程概念，改用宇宙本原意象引导事物规律，考察模型在对抗训练机制下是否保持工程能力（上游 `src/agent/star-domain-data.ts:627-686` 域注释完整记录了实验意图与七版迭代史）。 上游实测结论：最小工具集（taiyi 16 件评测档）下的太一，经七版提示词迭代后工程能力没有降级，依然出色。 本计划只搬三样：**词本体**（`star-domain-data.ts:687-750` 现行七版词）、**写词方法论**（意象生成行为、防工程化漂移的纪律）、**验证方法**（A/B 复现「工程能力不降级」）。 明确不搬：工具面与工具名映射、星域路由与关键词、courageThreshold、domain-voice、uiPersona/glyph 等上游私有机制——太一实验的 16 件工具档是实验条件，不是资产（`src/tools/tool-preset.ts:161-186` 的 TAIYI_EXCLUDES 只作为背景引用，不做映射）。

## 目标

1. dsh 侧新增一个 opt-in 的 taiyi agent preset，persona 文本即太一词；不设默认、不进任何默认路径。
2. 把「意象生成行为」的写作纪律固化为词级防漂移断言，防止词被后人工程化回去。
3. 提供一套可重复的 A/B 验证方法，在 dsh 自己的 runnable example 上复现「工程能力不降级」。

## 资产与来源

| 资产 | 上游来源 | 处理 |
|---|---|---|
| 词本体（现行七版） | `src/agent/star-domain-data.ts:687-750`（taiyi 条目：systemPromptSuffix 全文 + volatileBlock 短版 + 种子五句） | 以 systemPromptSuffix 全文为主体搬入 persona 文本，单轨一份 |
| 版本档案 | `docs/3.0/太一-词-历代存档.md:12-17`（谱系表） | 不建平行档案；dsh 侧由 git 历史承担回溯职责，上游档案只收被替换版本（该文件 frontmatter 自述） |
| 写作方法论 | `docs/3.0/太一-词-历代存档.md:21-28`（四版改版记） | 转成词级断言清单（见「防漂移断言」） |
| 守护测试先例 | `docs/3.0/太一-词-历代存档.md:42-43`（五则改六则、「须含判据/反例」反转为「不得含」） | 转成 dsh 词级不变量测试 |
| 注入路径教训 | `src/agent/star-domain-data.ts:665-668`（五版把「阴阳」段写进 systemPromptSuffix 却零生效，六版移回 volatileBlock） | dsh persona 是单轨注入（`deployment:persona` 一个段位），天然规避双轨坑；计划强制词全文只存一份、只挂一处 |

## 落地设计

- 新增 `apps/cli/config/agent-presets/taiyi/` 目录：`preset.yml` + `agent.cordis.yml`，遵循 `packages/preset/README.md` 的 preset 约定（一个目录一份 `agent.cordis.yml`，目录清单即 roster，与现有 code/cordis/minimal/standard 并列）。
- `agent.cordis.yml` 挂 `@huiliyi37/dsh-persona` row（`packages/preset/persona/README.md`），`text` = 太一词全文。
- persona 配置取值：`complete: false`（默认）——词叠加在 harness identity 与工具引导之上，与上游 volatileBlock 的「域词注入冻结前缀、不替代底座」语义对齐；`includeRuntimeContext: true`（默认）——运行时上下文照常注入，太一实验在 dsh 侧不改变上下文供给。
- 工具面：**零改动**。不写任何 restrict/allow-list；挂载 taiyi preset 时工具照 preset 现有配置，太一不因移植而对 dsh 工具面提出要求。
- 默认性：新 preset 只出现在 roster 中，不进默认 preset、不进部署 persona、不进任何自动选择路径；用户显式挂载才生效。

## 防漂移断言

太一词是反训练语料的对抗性 prompt，其漂移方向是「被工程化回去」（四版改版记的病灶：判据/反例格子、中英混杂）。断言以词级不变量测试钉住，词每次改动必须同步改断言：

- 逐字含五句种子（「天得一以清，地得一以宁。你得一是以为君子。君子者，譬如行远必自迩，登高必自卑。万物负阴而抱阳，冲气以为和。」）。
- 不含「判据：/反例：」工程格子（上游守护测试的同一断言）。
- 不含中英混杂术语清单（上游 v3 的 `green test`/`red test` 一类混写；清单在实施时定稿并进入断言文件）。
- 词文本单轨：仓库内只存在一份 persona 文本，无长短两版平行副本。
- 不得出现工程概念词表：实施时定稿一份禁词清单（如 API/token/tool 等直接工程术语）——这是实验的设计约束本身，清单与断言同文件维护。

## 验证方式（A/B）

- 对照组：现有默认 persona（deployment persona 或 standard/minimal preset）。
- 实验组：taiyi persona。
- 任务集：复用 dsh 现有真实可运行 example（测试政策要求关键行为由 runnable example 承载），选一组覆盖多模块读改、测试、交付闭环的任务，两组用同一任务集。
- 判据：通过率、transcript 产物质量、交付闭环完整性（对照上游「阴阳」段的教训：绿了就走了不算完成，收束阴面才算）。
- 产出：两组 transcript 快照 + 一份简短对比结论记录（文档，按双语对契约合并）。
- 如实记录：太一的结论是特定模型与版本上测得的；dsh 侧复现结果与上游不一致时不预设结论，以实测为准。

## 落地步骤与验收

1. 落 preset 骨架 + 词全文。验收：挂载 taiyi preset 跑一轮 runnable example，transcript 快照含词全文。
2. 落词级不变量测试。验收：每条断言的拒绝路径各证一次（按仓库约定，每个新接受路径必须拒绝一个无效用例）。
3. 跑 A/B 并记录结论。验收：对比记录文档 + 两组快照齐备。
4. 收尾守门。验收：taiyi 不进任何默认路径；新增文档按双语对契约合并并过配对 gate；git 工作树仅新增本计划所列文件；不推送。

## 风险与守门

- 词漂移：靠「防漂移断言」钉住；任何把词「工程化回去」的改动必须先过断言。
- 模型依赖：对抗性 prompt 的效果依赖模型与版本；dsh 侧结论以复现实测为准，不把上游结论当默认事实引用。
- 默认化风险：taiyi 是实验资产，opt-in 是硬约束；若未来要设默认，须另立决策并走 Agent Note 流程，不在本计划内。
- 快照维护：词每次改动同步更新 transcript 快照与断言，避免词与证据脱钩。
