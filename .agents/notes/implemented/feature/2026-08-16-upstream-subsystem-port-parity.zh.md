# Agent Note: 上游子系统按需移植——官方缺失面补齐（upstream parity port）

Status: implemented

[English](2026-08-16-upstream-subsystem-port-parity.md) | 中文

## Problem

oh-my-tianshu 是 deepseek-ai/deepseek-harness 的独立 fork（2026-08-14 公开快照，之后不追踪上游），而官方 master 在 fork 后继续新增子系统（preset、attachment、identity、schedule、runtime-diagnostics、sdk 等）。本仓库的 `/preset` 命令等消费端已就位但提供方缺失——真实装配抛 `cannot get property "agentPresets" without inject` 的根因正是内核不在本仓库。用户决定对齐：官方有的、本地没有的子系统整体移植过来。

## Decision

移植以"功能缺口"为准绳，逐组核对官方 49 组 vs 本地 48 组（2026-08-16 基线）：

- **改名覆盖、无需移植**：compaction→compact、extensions→self-modification、jobs→tasks、shell→bash、terminal→pty、test-support→support、sdk→scaffold（protocol/client/server 已驻）、runtime-diagnostics/invariants→support/invariants、context/agent-instructions→workspace-context、interaction/user-questions→user-interaction、interaction/permission-presets→permission、boot/cmdline→app-boot、web/web-fetch-http→web-fetch-local、skill/skill-filesystem→skill-local、hooks/hooks-claude-code→hooks-claude、core/agent-tool-presentation→core/tools 的 presentation 面。
- **真缺口、按序移植**：identity（anonymous-user-id）→ attachment 对（attachment、attachment-local）→ schedule → preset 对（persona + agent-presets）→ shell/pwsh-sandbox → extensions 三件套（cordis-client-runner、cordis-host-runner、ui-cordis）。
- **暂缓**：session-stats、message-feedback、sandbox-windows-acl、typert/protocol、client-ui-* 新面板——消费方是官方 web 客户端，本地 web 面已有自研对应物，待消费方确认后再定。

已落地：extensions client 半三件套（cordis-client-runner、ui-cordis、ui-input-trigger：TypeRT 原始返回值/null 语义适配、invokeFailure 教学、$on 守卫式接线、崩溃监督 seam 惰性化、单槽无 shadowing 的测试适配，101+30+16+128 用例全绿；client 面 tsdown 构建通过）。`packages/identity/anonymous-user-id`（官方源码移植，scope 迁移 @huiliyi37，home 路径适配本地默认 `~/.dsh-tianshu`，README 消费者声明按本地事实改写——本地仅 telemetry 接线 `user.id`，feedback/llm-deepseek 未接线）；`dsh-session-telemetry-otel` 的手写 `user-id.ts`（与官方包同构的复制实现）删除，改经官方包导入——依赖替换手写（dependency-over-hand-rolling 政策）；`packages/attachment` 组（attachment seam + attachment-local 内容寻址本地存储，引入 sharp 外部依赖，对象落 `<DSH_HOME>/attachments/v1/objects/<sha256>`）；`packages/schedule`（会话内持久提醒：session 日志为唯一状态源，schedule/change 事件、schedule_create/list/delete 三个 agent 作用域工具、live owner 到期投递；连同子系统文档 docs/subsystems/schedule.md、四篇官方设计 note 与 examples/web-schedule 示例 overlay 一并移植；工具目录 gen-tool-catalog 扩展 schedule recipe 收录三工具；built-invariant 校验暴露的共享 chunk 发布问题以 manifest files 声明 `lib/*.js` 修复）；`packages/preset` 内核（persona + agent-presets：按会话 agent 组成、standing mount、recompose 重绑、resolveSessionPreset 契约——即 /preset 命令的提供方；架构 note 随附）。preset 依赖闭包要求四项核心链升级（官方演进面）：dsh-scope 父链机制、dsh-tools view/guard 链感知、dsh-system-prompt complete/suppressRuntimeContext/链感知 assemble、dsh-session SessionHeader.agentPreset。shipped presets 数据（standard/minimal/cordis）+ profile-boot SHIPPED_PRESET_ROOT overlay + web-app bundle 装配行落地，/preset 命令端到端可用（真实组合 e2e 验证）。
- `packages/bash/pwsh-sandbox`（PowerShell 沙箱执行器；pwsh-local 对齐 bash-local 的 argv 保护 seam 与 4 参 onProcessDone）。
- `packages/self-modification/cordis-host-runner`（动态包宿主半：定义注册表、node:vm 沙箱生命周期、run 往返；typert-protocol→type-meta 映射；./typert 产物由本地 typert 管道生成）。
- extensions client 半三件套（cordis-client-runner、ui-cordis、ui-input-trigger）——见上文已落地。

移植注册面（每包）：package.json（版本 0.2.6、Apache-2.0、@huiliyi37 依赖约定）、tsconfig references（本包 + 依赖方）、tsconfig.base.json 的 `@huiliyi37/dsh-*` 与 `@huiliyi37/dsh-*/invariant` 通配组表、tsconfig.host.json references（依赖序）、packages/README 组表（中英 + i18n 重录）、model-experience 句子 allowlist（SENTENCE_MODEL_EXPERIENCE）、Known Limitations 与配对门禁、module-graph 重生成、pnpm-lock。

## Alternatives considered

- **全量跟随上游（track upstream）** — 否决：仓库定位就是独立演进（NOTICE 明文），全量同步会把本地 211 包的自研分歧（TUI/记忆/检索/门禁）置于上游 API 变动风险下；按需移植把上游增量当作可选功能面，移植节奏由本地消费方驱动。
- **只补 preset（用户报错的最小闭环）** — 否决：preset 消费端只是 TUI 面板，而 attachment/identity/schedule 等是官方 8 月后的成组能力；单点成本与整组移植相近，且组间存在依赖闭包（persona 依赖 system-prompt、attachment-local 依赖 sharp 等，本地均已具备或可评估）。
- **保留 telemetry 手写 user-id、只新增官方包** — 否决：两份同构实现并存违背"优先依赖、拒绝手写"（2026-07-26-dependencies-over-hand-rolling）；官方包测试矩阵覆盖本地 spec 全部用例，删除后测试面不减。

## Consequences

- 买到：官方缺失面按依赖序补齐；telemetry 的 user-id 实现回归官方单一来源；`/preset` 的提供方（agent-presets）进入移植队列，装配后命令即生效。
- 代价：`.userid` 旧持久化文件不迁移（预发布无兼容承诺，README 已记录为 deferred work）；每个新包都要过本地门禁面（README/model-experience/配对/预算），单包移植成本高于纯复制；本地与官方同名包 API 已分叉，后续包移植需按本地 API 适配（如 dsh-paths 的 resolveDshHome 签名相同但默认 home 不同）。

## Testing

验证（全部通过）：identity 9 + telemetry 25 + attachment 16 + schedule 131 + preset 138 + scope 24 + tools 365 + system-prompt 86 + session 291 + 消费方回归 2012 测试；client 面 101（client-runner，含 orchestrator 30 / evaluator 16）+ ui-cordis/ui-input-trigger 128；`tsc -b`（host + client 两个聚合）；`build:lib`（tsdown host/client 双面打包）；verify-package-paths、verify-package-invariants（222 伴生）、verify-built-package-invariants（222 编译伴生 plain-Node Loader）、verify-package-readme-limitations、verify-package-readme-model-experience（222 README，新包入句子 allowlist）、verify-translation-pairing（新页面/README 全部重录）、verify-module-graph、verify-export-jsdoc（移植包 0 诊断）、verify-doc-budgets、verify-lint-budgets（oxlint 全仓 0 诊断）、verify-md-links、verify-md-wrap、verify-doc-refs、verify-client-domain-graph（ui-input-trigger 纯内核按门禁平移到 src/client 顶层）、verify-cordis-catalog（新增 extensions/attachment 子系统页 + SERVICE_PAGE/EVENT_SCOPE_PAGE/豁免全量补齐，91 生成区）、verify-cordis-api、verify-persistence-catalog（会话事件单一声明：/preset 改 type-only 引用 agent-presets 合并）、verify-config-catalog（zh 侧镜像重录）、verify-runtime-closure、verify-node-next-types、verify-cordis-config、verify-source-budgets。

存量失败（与本轮无关、并行 agent WIP）：verify-source-budgets 与 verify-export-jsdoc 的 tui app.ts（TuiApp 无 JSDoc、超行数上限）、translation-pairing 的 tui/tui 与 tui/vision-ask。

## Deferred

- 文档化限制（本地 client 面缺口，按 no-op/空报告 + 注释处理）：$on 事件转发（Gateway 未实现）、slots 树快照与 entry 崩溃上报 seam（SlotCore 无 reportEntryError）、theme exportInspectTokens 检查面。
- code preset 依赖的 agent-tool-presentation：需 tools registry 的 presentAs per-scope 声明（core 重构），独立工作流；code preset 暂缓入 roster。
- 并行工作流提示：工作树可能含其他 agent 的未提交改动（如 search 包 async-refresh 修复），提交前按文件区分。
- session-stats / message-feedback / sandbox-windows-acl / typert/protocol / client-ui-*：待消费方确认后再定。
