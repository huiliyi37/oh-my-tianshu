# Agent Note: 常设审批授权——allowed-always 全链路

Status: implemented

[English](2026-08-25-approval-standing-grants.md) | 中文

范围：`packages/interaction/user-approval`（结果并集）、`packages/interaction/approval-rules`（映射 + facet）、`packages/core/tools`、`packages/sandbox/sandbox`、`packages/host/apiproxy`（消费方）、`packages/tui/tui`（卡片/控制器/应用）、`examples/tui`（冒烟场景）

## 问题

审批缝只授予一次性决策：每次放行都是 `allowed-once`，审计轨迹无法区分"用户本次允许"与"常设授权放行"——而 TUI 审批卡也没有*创建*常设授权的路径：`a` 只设会话内 always 开关（审计词汇里不可见），持久 allow 规则只能手工经 `/permissions add` 写入。

## 设计

`ApprovalOutcome` 新增 `allowed-always`：本次调用的授权，其来源是常设授权。它在所有消费方（工具注册表 pre-execute、沙箱升级）与 `allowed-once` 授权等价——区分在审计语义（`approval/decided`），不是单次许可的宽度。能力缝按全角色同步演进：Service Definition（user-approval 并集 + OUTCOMES + invariant）、提供方（approval-rules 应答者、TUI 控制器）、消费方（tools、escalation、apiproxy `approval/resolved` 线上并集）。ACP 与远端 decide 并集保持窄（只答一次/拒绝）；被规则结算的请求不会到达它们。

approval-rules 把 allow 规则命中映射为 `allowed-always`（命中规则天然是持续授权——同一规则结算后续每次匹配请求），并暴露同进程 facet `approvalRules.persistAllow`：`persistAllowRule(req)` 推导精确匹配规则（请求工具名 + 规范化参数串，`match: exact`），追加到项目层并返回带层标记的规则。省略/`glob` 仍是手工 `/permissions add` 的默认，那里的 `*` 继续当通配。无可解析调用参数的请求显式报错——无限制通配不应由一次按键授予；工具级规则仍走 `/permissions add` 的郑重路径。

TUI 审批卡新增 `[p] 永久允许`：先落盘，写入进行中忽略 y/n/a/esc，成功且挂起仍是同一 `req` 才结算 `allowed-always`（写失败卡片留在原地等 y/n/a）。`a` 更名 本会话总是允许 且同样结算 `allowed-always`（与实际发生一致）；控制器 always-approve 短路同样返回 `allowed-always`。键位提示行在窄轨按段折行（`wrapApprovalHintRows`），`[esc] 取消` 永不截断。apiproxy decide API 与 client slot 并集有意保持 `allowed-once`/`rejected`：它们是人类应答通道，常设授权不是人类的一次性回答。

## 凭证

单测：approval-rules 应答者映射 + facet（推导/追加/`match: exact`/命令含 `*` 不 glob 放大）、user-approval 透传 + 审计、tools/escalation 消费方、TUI 卡片折行/控制器取值、app p 键（facet 在 → 落盘+结算；落盘中忽略 `n`；缺 → 告警且卡片保持可改选）。装配级：交互冒烟第三个 PTY 场景驱动卡片 → `p` → 工具执行 → `/permissions` 列出 `project  bash` → 第二条助手回复必须落地（split 长度 ≥ 3）且无卡、退出码 0——常设授权闭环经真实 Loader 组合得证。

## 非目标

撤销 UX、卡片内规则编辑、`p` 的 pattern 放宽到精确匹配之外（glob 授权仍归 `/permissions add`）皆延后；远端/Web decide 面在自带 always-allow 入口之前保持窄并集——该入口已落地为 Web 审批常设授权（[2026-08-27-web-approval-standing-grant](2026-08-27-web-approval-standing-grant.md)）。
