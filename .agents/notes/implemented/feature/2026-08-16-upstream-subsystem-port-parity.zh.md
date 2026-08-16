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

已落地：`packages/identity/anonymous-user-id`（官方源码移植，scope 迁移 @huiliyi37，home 路径适配本地默认 `~/.dsh-tianshu`，README 消费者声明按本地事实改写——本地仅 telemetry 接线 `user.id`，feedback/llm-deepseek 未接线）；`dsh-session-telemetry-otel` 的手写 `user-id.ts`（与官方包同构的复制实现）删除，改经官方包导入——依赖替换手写（dependency-over-hand-rolling 政策）；`packages/attachment` 组（attachment seam + attachment-local 内容寻址本地存储，引入 sharp 外部依赖，对象落 `<DSH_HOME>/attachments/v1/objects/<sha256>`）。

移植注册面（每包）：package.json（版本 0.2.6、Apache-2.0、@huiliyi37 依赖约定）、tsconfig references（本包 + 依赖方）、tsconfig.base.json 的 `@huiliyi37/dsh-*` 与 `@huiliyi37/dsh-*/invariant` 通配组表、tsconfig.host.json references（依赖序）、packages/README 组表（中英 + i18n 重录）、model-experience 句子 allowlist（SENTENCE_MODEL_EXPERIENCE）、Known Limitations 与配对门禁、module-graph 重生成、pnpm-lock。

## Alternatives considered

- **全量跟随上游（track upstream）** — 否决：仓库定位就是独立演进（NOTICE 明文），全量同步会把本地 211 包的自研分歧（TUI/记忆/检索/门禁）置于上游 API 变动风险下；按需移植把上游增量当作可选功能面，移植节奏由本地消费方驱动。
- **只补 preset（用户报错的最小闭环）** — 否决：preset 消费端只是 TUI 面板，而 attachment/identity/schedule 等是官方 8 月后的成组能力；单点成本与整组移植相近，且组间存在依赖闭包（persona 依赖 system-prompt、attachment-local 依赖 sharp 等，本地均已具备或可评估）。
- **保留 telemetry 手写 user-id、只新增官方包** — 否决：两份同构实现并存违背"优先依赖、拒绝手写"（2026-07-26-dependencies-over-hand-rolling）；官方包测试矩阵覆盖本地 spec 全部用例，删除后测试面不减。

## Consequences

- 买到：官方缺失面按依赖序补齐；telemetry 的 user-id 实现回归官方单一来源；`/preset` 的提供方（agent-presets）进入移植队列，装配后命令即生效。
- 代价：`.userid` 旧持久化文件不迁移（预发布无兼容承诺，README 已记录为 deferred work）；每个新包都要过本地门禁面（README/model-experience/配对/预算），单包移植成本高于纯复制；本地与官方同名包 API 已分叉，后续包移植需按本地 API 适配（如 dsh-paths 的 resolveDshHome 签名相同但默认 home 不同）。

## Testing

验证（全部通过）：identity 包 9 测试 + telemetry 25 测试 + attachment 16 测试 + tui commands 135 测试；`tsc -b`（单包 + host 聚合）；`build:lib:host`（tsdown 全量打包，新包 lib 产出）；verify-package-paths、verify-package-invariants（212 伴生）、verify-built-package-invariants（212 编译伴生 plain-Node Loader）、verify-package-readme-limitations、verify-package-readme-model-experience（212 README）、verify-translation-pairing、verify-module-graph、verify-export-jsdoc、verify-doc-budgets、verify-lint-budgets（oxlint 全仓 0 诊断）、verify-md-links、verify-doc-refs。

存量失败（与本轮无关、main 同现）：verify-md-wrap 的 docs/2026-08-16-phase2-isolation.md、verify-source-budgets 的 tui app.ts / input-line.ts。

## Deferred

- schedule、preset（persona + agent-presets）、pwsh-sandbox、extensions 三件套：后续轮次按序移植。
- session-stats / message-feedback / sandbox-windows-acl / typert/protocol / client-ui-*：待消费方确认后再定。
