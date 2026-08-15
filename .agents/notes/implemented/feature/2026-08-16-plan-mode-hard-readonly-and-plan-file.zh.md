# Agent Note:plan mode 硬只读守卫与计划文件落盘

Status: implemented

[English](2026-08-16-plan-mode-hard-readonly-and-plan-file.md) | 中文

## Problem

plan mode 此前只是提示层承诺:`plan:policy` 段落劝导只读,但没有任何机制阻止走神或被注入的模型调用 `write`/`edit`/`git_commit`——模式的全部价值都押在模型自觉上(旧测试甚至明确断言"引导与执行是分立的轴"、所有调用原样放行)。而已展示的计划只存在于审批提示和工具入参里:压实之后已批准的计划无法找回,resume 会话也无法重读。c7 编排对标(docs/dsh-编排机制对标-claude-c7.md §3.1)点名的 plan mode 差距正是这一条——Claude Code 里 plan 是权限档,编辑在工具层硬阻断。

## Decision

两处新增都在 `packages/plan/plan-mode`,读同一份落账的 `plan/mode` 状态:

**单调注册表守卫**(`ctx.tools.guard`,由 plan-mode 服务注册):`foldPlanMode` 活跃时拒绝变更工具族——`write`、`edit`、`str_replace_editor`(仅 `create`/`str_replace`/`insert` 变异子命令,从调用入参判别)、`git_commit`、`terminal_open/send/signal/close`。拒绝理由是模型可见文本,引导用只读工具探索并以 `exit_plan_mode` 提交计划。`bash`/`pwsh` 刻意放行——Claude Code 的 plan mode 同样保留只读 shell 探索,且仓内既定设计不做命令内容静态分析(tool-bash/src/index.ts:6-7);残余的 shell 写洞由正交的沙箱轴兜底,与 Claude Code 自身的沙箱残余同级。部署方经新增的 `PlanModeConfig.blockedTools` 加严名单。守卫只读**已落账**状态:turn 内的 pending 进入不能打断当前轮的合法写,已批准退出所在批次遵守"从下一步开始"契约。子代理会话 fold 自己的新日志,守卫不泄漏进子会话。请求工具目录不变——守卫作用于执行而非装配,"模式切换工具集稳定"依然成立。

**计划文件落盘**:每次 `exit_plan_mode` 调用——无论批准还是继续规划——把提交的 markdown 写到 `$DSH_HOME/plans/<编码 cwd>/<会话 id>/<slug>.md`(插件私有 `node:fs` 直写,spill-local/fs-snapshot 先例:不过 fs 沙箱,只读部署不会卡死评审),并追加 log-only 事件 `plan/file {path, heading}`。批准结果新增可选 `path` 字段并渲染进工具结果文本,replay/resume 从落账结果重算出同一张卡。

## Alternatives considered

- **复用 `sandbox/mode`(把会话切成 read-only)**:四个具体的坑——pty-local 在有开着的持久终端时否决模式切换(pty-local/src/index.ts:44-52);permission preset 共用同一事件槽会互相覆盖;计划文件本身在只读 cwd 下写不了(鸡生蛋);无沙箱组合完全失去保护。守卫与组合无关。
- **用 `tools/pre-execute` waterfall 而非 `guard()`**:guard 同步且单调——后续监听无法翻盘放行已被拒的写(core/tools/src/index.ts:953-959),而 waterfall 决定可被下游监听改写。对安全相关约束,单调形状正是目的。
- **计划文件与 JSONL 会话日志同址**(`sessions/<proj>/<id>/`):会把 plan-mode 耦合到特定持久化后端的目录布局。`plans/` 独立根与后端无关,浏览也更清晰。
- **连 bash/pwsh 一起封**:会破坏 Claude Code plan mode 明确允许的合法探索(`ls`、`git log`、只读查看);shell 洞的正解是按调用级沙箱降级,不是名单封禁。

## Consequences

- 旧软契约测试已改写为新契约:`integration.spec.ts` 现在断言 pre-turn `set()` 后变更调用被守卫拒绝;单测覆盖子命令判别、config 加严、mid-turn pending 不干扰、子会话隔离。`packages/plan/plan-mode` 91/91 绿。
- 模型可见面变化:守卫拒绝文本(仅在 plan mode 下尝试被封调用时出现)与批准退出结果文本追加 `Plan file: <path>`。回放落账结果的录制快照不受影响。
- 残余洞如实记录:`workspace-write` 沙箱下 bash 仍可在工作区内写——与 Claude Code 残余同级。封堵需要按调用级沙箱降级,不是本守卫的职责。
- `plan/file` 为 log-only:模型面无变化,fork/resume 回放安全。
- 门禁证据:`plan/file` 事件与 `blockedTools` 配置带 JSDoc,已流入 `docs/persistence-catalog.md` / `docs/config-catalog.md`(zh 对应文档已同步)。
