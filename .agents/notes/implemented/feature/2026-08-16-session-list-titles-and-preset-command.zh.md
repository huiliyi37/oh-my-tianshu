# Agent Note: /session list 使用官方 session-title 事件展示标题，并新增 /preset 命令

Status: implemented

[English](2026-08-16-session-list-titles-and-preset-command.md) | 中文

## 问题

姊妹仓库 `dsh-tui`（以 `dshtui/*` refs 拉取）有两个本仓库缺失的 slash 命令能力：`/session list` 只打印裸会话 id 与时间戳，且没有查看/切换 agent 预设的途径。两个仓库无共同 git 祖先，均按语义移植。

## 决策

`/session list` 现在每行展示标题，经新增的只读 adapter `src/adapter/session-title.ts`：fold 官方 log-backed `session/title` 事件（由 `@huiliyi37/dsh-session-title` 写入，其 LLM provider `session-title-first-message-llm` 装配在 `dsh-base`，会话活跃时按 first-prompt cadence 自动生成标题），无标题事件时确定性回退到首条真人消息的开头词（`fallbackMaxWords: 5` / `fallbackMaxBytes: 40`，与 dsh-base 装配配置对齐），最后回退 `新对话`。TUI 不做任何生成：不调 API、不写 sidecar、不发明事件——纯展示纪律保持成立。`packages/tui/tui` 新增 `@huiliyi37/dsh-session-title` peer 依赖与 tsconfig project reference。

`/preset` 命令（查看/切换 agent 预设，标准/PTC/极简/创造）以最小结构面 `PresetFacet`（`list` / `composedPreset` / `recompose`）移植：列表用 `*` 标记当前组成预设；切换要求空白会话（官方 `recompose` 调用方契约——换工具集会留下历史 tool call 与新组成不匹配），成功后 append 类型化的 `agent-preset/selected` 会话事件（`@huiliyi37/dsh-session/types` 的 declare-module 扩展）。`BuiltinCommandDeps` 新增 `currentAgent()` 与 `isBlankSession()`。`agentPresets` 服务本仓库当前未装配，命令 fails loud 回显 `⚠ agent-presets 服务不可用`——与 `/goal` 相同的可选服务降级模式；宿主装配 `dsh-agent-presets` 后即激活。

## Alternatives considered

**移植早期自研 session-brief sidecar**（LLM 生成梗概 + TUI 私有缓存文件，`545122d`）。否决：姊妹仓自己已删掉它并改用官方 `session-title` 服务（`12a34e7`），且本仓库已自带并装配该服务——sidecar 会重复 harness 自己的标题生成，违反纯展示纪律。

**因 `agent-presets` 未装配而跳过 `/preset`。** 否决：命令在无服务时 inert-but-loud（镜像 `/goal`），类型扩展与测试面为宿主包就绪。

**把标题 fold 内联进命令而非 adapter。** 否决：adapter 让 `/session list` 保持单行消费，并给 fold 独立单测面，与姊妹仓结构一致。

## Consequences

`/session list` 行现在携带可读标题，无会话日志写入、无 API 调用、无 LLM 成本——历史会话展示确定性回退，空会话展示 `新对话`。命令菜单分页测试移动一项（`/compact` → `/clear`），因 `/preset` 加入 `BUILTIN_COMMAND_NAMES`。`/preset` 在宿主装配 `dsh-agent-presets` 前报不可用，装配后在空白会话上切换预设并落类型化事件日志。既有 `app.ts` 的 `tailLines` lint 发现保持不动。
