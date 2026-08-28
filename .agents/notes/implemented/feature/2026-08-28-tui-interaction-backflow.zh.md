# Agent Note: TUI 交互回流浪——响铃、排队、插队与可达性

Status: implemented

[English](2026-08-28-tui-interaction-backflow.md) | 中文

Scope: `packages/tui/tui`（`term-bell.ts`、`controllers/submit-queue.ts`、`theme-contrast.ts`、`engine/ansi.ts`、`engine/input-handler.ts`、`format/keymap-panel.ts`、`prefs.ts`、`ui/app.ts`）

## 问题

兄弟仓 `dsh-tianshu-tui` 发布了 rc.25（「P0 交互三连」波次）加两项可达性修复，本仓 `packages/tui/tui` 移植版尚未吸收：终端用户缺少能穿透 SSH 的完成信号（无响铃，且本包根本没移植 OS 通知通道）；agent 忙碌期间输入的消息无法提交（回合结束前 Enter 无效）；自定义主题可以声明不可读的颜色而无任何警告；事实标准的 `NO_COLOR` 被无视。

## 决策

从兄弟仓五个用户可见面回流（响铃 `704a833`、排队 `9d7f421`、插队 `c53a497`、主题对比度 + `NO_COLOR` `3e2cb2f`、Ctrl+R 别名 `181d517` 部分），各自独立成提交，差异点如下。

**响铃门闸落在本包 prefs，而非 `notifyOs`。** 上游把响铃与 OS 通知偏好耦合，因为两者都是完成提醒；本包从未移植 OS 通知子系统，故 `term-bell.ts` 就地声明 `SKIP_NOTIFY_ENV`，开关是新 `bellEnabled` 偏好键（`/bell` 命令，合并写进共享的 `~/.dsh-tui/prefs.json`）。其余门闸语义同上游：`DSH_TUI_SKIP_NOTIFY` / `VITEST` / `CI` 静默，SSH 明确不静默（BEL 穿透 pty 到本地终端——远程会话正是它存在的意义）。写失败静默吞掉；响铃是装饰性的，永不承载正确性。响铃点在 `subagent/end`、`workflow/end`、`tasks.onTaskDone`。

**排队是 TUI 侧的主动取舍，丢弃回显落在 `switchSession` 而非 `mountSession`。** 宿主 followup 通道是无取回 API 的 inbox FIFO，故 running 态的 Enter 进本地 `SubmitQueueController`（输入轨上方渲染 `⏳` 行）；`turn/end` completed 按提交顺序经正常「气泡 + followup」路径排空，aborted 保留。空输入 ↑ 把最旧一条取回输入行。本包 `followup` 返回 `void`（同步 inbox 入队），上游的失败回显路径（`⚠ 排队消息发送失败`）无 rejection 可接，未移植。切会话丢弃回显提交在 `switchSession` 的 detach 之前——`mountSession` 首行就把 `this.transcript` 换成新会话，回显落在那里会写进新会话视图。

**Ctrl+Enter（cancel-and-send）直接接线，running 守卫内联。** 兄弟仓按键走其新 action registry（`c275902`，未回流）；本包 `ctrl_return`——由 `enhancedKeyFromCode` 从 kitty CSI `13;5u` 解码（flag 1 已随 attach 推送）——走 Ctrl+T 旁的守卫分支：仅 `running` 态消费（空闲 Ctrl+Enter 不动草稿），`cancelAndSendInput` 的时序是清输入行 → abort → `whenIdle` → 正常提交路径，草稿由此排到更老的排队消息之前。`handleAbort` 现以 `keepInbox: true` 取消：手动打断不再丢弃宿主 inbox 未消费的工作，与本地队列「打断永不丢弃意图」一致。

**Ctrl+R 是带 vim 态守卫的别名，不是遮蔽。** app 层 `ctrl_f` 拦截先于 `inputLine.handleKey` 运行，裸 `ctrl_r` 别名会抢走 vim NORMAL 的 redo。别名写成 `(key.name === 'ctrl_r' && !(vimEnabled && vimMode !== 'insert'))`；Ctrl+F 不受限。

**主题对比度只警告，永不阻断。** `validateThemeContrast` 按声明 `dark`/`light` 档的名义背景校验自定义主题前景 token；低于 3.0:1（WCAG AA 大文本）写 `[theme] low contrast in <file>` stderr 警告并照常注册（fail-open——保留用户意图）。非 hex 值（chalk 命名色）跳过：16 色轨语义归内置主题维护。`NO_COLOR`（no-color.org：存在且非空）压制 `fg`/`bg` 输出并在模块加载时把 chalk 压到 level 0；`setColorSuppressed` 供测试使用且用后必须复原。

未回流、属刻意取舍：action registry（`c275902`——约 2k 行重构，在本仓价值主要是上游测试工效；若其审批分层工作落地再重估）、审批决策分层（`fd99567`——`p <prefix>` 白名单与拒绝附反馈须先与本仓 chrome-closed-loops 线自己的常设授权工作对账）、vim insert 两键 remap（`181d517` 另一半——依赖带 `.` 录制的上游 `VimInput` 引擎，本移植从未吸收）、attachment-preview 控制器抽取（`79b539c`——内部重构，无用户可见增量）。

## 已考虑的替代方案

### 为什么不只靠环境变量门控响铃？

无用户开关的 `shouldBell` 把部署相关选择硬编码；prefs 文件已存在、按合并写契约与官方宿主插件共享，`/bell` 只是一条注册命令的成本。

### 为什么不在 abort 时也排空队列？

回合被打中止恰是用户想打断改向的时刻；在他们刚执行的打断之后自动发出其排队消息，会背叛队列的存在目的。↑ 取回与下一次手动提交才是恢复路径。

### 为什么不先回流 action registry 再把本浪叠上去？

registry 是兄弟仓对自家 4 千行 `app.ts` 棘轮的答案；本仓 `app.ts` 已分叉到移植即是重构而非回流的地步。延后它让每个用户可见改动可独立评审、可独立回退；两个消费点（插队守卫、keymap 投影）小到可以带诚实注释内联。

## 后果

买到：能到达 SSH 用户的完成信号、带取回与插队车道的 Claude Code 式消息排队、成文的打断契约（`keepInbox`）、readline 惯例的历史搜索入口、WCAG 感知的自定义主题、合规的 `NO_COLOR`。prefs 文件获得第二个建模 key（`bellEnabled`）——合并写已覆盖。后续债务明确：action registry、审批分层、vim remap（见「未回流」）。
