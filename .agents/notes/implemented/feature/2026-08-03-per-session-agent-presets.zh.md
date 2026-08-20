# Agent Note: 按会话 Agent 预设

Status: implemented

[English](2026-08-03-per-session-agent-presets.md) | 中文

## Problem

本 fork 缺少官方的 `dsh-agent-presets` 子系统:会话没有按会话的 agent 预设组成,CLI 没有查看或切换预设的途径,类型化的 `agent-preset/selected` 会话事件也没有归属声明。服务、会话头记录与 `/preset` 命令面随官方仓库一并移植(语义移植;无共同 git 祖先)。

## Decision

每个会话从且仅从一个 agent 预设组成其模型面插件集。预设是在会话创建时解析的包列表,记录在会话头(`SessionHeader.agentPreset`)里;之后的 `recompose` 换预设只在会话仍为空白时合法——在累积历史之下换工具集,会留下与当前组成不再匹配的历史工具调用。服务(`ctx.agentPresets`)把预设的插件挂载到会话自己的 fiber 上、按会话为键,因此插件实例、工具注册、提示片段与投影单元每个会话恰好一份。`resolveSessionPreset` 按头中记录的预设名重建——绝不继承 fork 父会话的活组成。

移植按本仓库命名适配了官方链语义:scope 链(`dsh-scope` 父绑定、`chainLayers`、祖先标签路由)、链感知的 `dsh-tools` view/guard(`ctx.tools.get(name, scopeOf(ctx))`)、链感知的提示组装(`PromptSection.complete` / `suppressRuntimeContext`),以及 `dsh-session` 的 `agentPreset` 头字段。预设 isolate 键使用本地服务名;`/preset` CLI 命令经 `ctx.reflect.get('agentPresets', false)` 访问服务,host 未装配该包时大声失败并给出教学信息。`agent-preset/selected` 会话事件全仓只有一处声明(`dsh-agent-presets` 的 `SessionEventMap` 合并),由 persistence catalog 门禁强制;CLI 以 type-only 引用把该合并引入编译面,不引入运行时依赖。

## Alternatives considered

**让各包本地声明会话事件。** 拒绝:persistence catalog 要求每个日志事件只有一处声明;记录该事实的服务拥有它。

**给 CLI 一个 `dsh-agent-presets` 运行时依赖。** 拒绝:`/preset` 命令刻意保持最小 `PresetFacet` 服务面(`list` / `composedPreset` / `recompose`),让 CLI 保持精简;事件类型合并走 type-only 引用。

**允许任意会话 recompose。** 拒绝:沿用官方仅空白会话的调用方契约——历史之下换工具集会留下失配的历史工具调用。

## Consequences

`dsh-agent-presets`(连同 `dsh-persona`)随 `packages/preset/` 落地;在预设下创建的会话在恢复或 fork 后重建相同组成。`/preset` 列出预设并在空白会话上切换,带类型化事件日志;host 未装配 `dsh-agent-presets` 时报告服务不可用(惰性但大声,同 `/goal`)。工具可见性经链感知的 tools view/guard 跟随会话 scope,预设工具可达其会话与子代理,而不跨会话泄漏。
