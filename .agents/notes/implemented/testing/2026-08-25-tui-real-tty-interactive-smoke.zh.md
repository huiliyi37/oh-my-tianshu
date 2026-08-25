# Agent Note: TUI 真实 TTY 交互验收冒烟（P0）

Status: implemented

[English](2026-08-25-tui-real-tty-interactive-smoke.md) | 中文

范围：`examples/tui/tests`（新冒烟 + 组合 fixture + 驱动器 + 共享 PTY harness）、`packages/tui/tui`（rewind 完成帧修复）、`examples/package.json`

## 问题

已发布的 TUI 没有任何"真实终端真的收到完整交互主干"的自动化验收：欢迎快照钉住了落定的欢迎卡与 Ctrl+Q 干净退出，但审批流、`/rewind`、`/theme` 只有直接驱动渲染器的单测覆盖。v0.4.0 版本线在缺这道闸门的状态下发布；代理沙箱拒绝 `posix_openpt`，因此 PTY 驱动的覆盖被设计为在任何有宿主 PTY 的环境（CI runner、开发机）运行于标准 keyless 快照泳道。

## 设计

`examples/tui/tests/interactive-smoke.snapshot.ts` 在 100×40 的 `node-pty` 会话里经真实 Loader 启动 `tests/fixtures/interactive-smoke.cordis.yml`，并用 headless xterm 解析字节流——标记只对解析后的活动缓冲（normal 或 alternate）匹配、绝不对裸字节匹配，ANSI 组帧无法伪造通过。fixture 组合是 examples/tui 主干加上约束性 bash 栈（`subprocess` → `sandbox` → `sandbox-policy` → `bash-sandbox`）与审批缝（`@huiliyi37/dsh-user-approval`，策略 `ask`）。模型由回环 `dsh-llm-mock-server` 顶替：第一个请求返回 `bash` 的 `tool_call_success`，携带 `sandbox_permissions: danger-full-access` + justification，从而弹出真实审批卡（升级校验只要求严格更宽与字段配对——首调升级在线上是合法的）；第二个请求返回收束文本。`DEEPSEEK_BASE_URL` 指向 mock；全程不接触任何密钥或网络。

场景一驱动完整主干：落定欢迎 → 用户消息 → 审批卡（`审批 · bash`、`[y] 允许`）→ `y` 结算 → 转录里的工具输出 → 助手回复 → `/rewind` 列表 → 粒度（`convo`）→ 完成页 → 关闭 → `/theme` 选择器 → 下移一步 + 确认 → `主题已切换:` 回显 → Ctrl+Q 退出码 0。场景二在卡片挂起时按 Ctrl+Q——这条拆卸路径会把审批结算为 cancelled 并中止开放回合——同样要求退出码 0。两个场景都断言假 API key 绝不跨过 PTY。

可复用部分在 `tests/helpers/pty-harness.ts`（隔离的 HOME/DSH_HOME/AGENTS_HOME 临时根、白名单子环境、解析器排空跟踪、带截止与退出检测的标记轮询、优雅 Ctrl+Q → kill 清理）。冒烟复用既有 `resolveExampleLaunch` 的 src/lib 双平面；fixture 驱动器 `tests/fixtures/interactive-driver.ts` 是纯粹的启动即让位驱动器——它不能复用 `welcome-driver.ts`，后者启动 Tip 的 `Math.random` 调用点守卫假设欢迎之前没有原生 addon 加载（bash 沙箱栈会加载 koffi 并触发该守卫）。

## 发现并修复的缺陷：rewind 完成页从不渲染

驱动 `/rewind` 暴露的是真实产品缺陷而非测试噪音：`RewindOverlay.run()` 异步执行，但唯一的重绘触发是按键路径（`handleKey` → `overlay.rerender()`），最多画出 `executing` 帧。executor 落定时无人重绘，`回退完成`/`回退失败` 页——连同其 `任意键关闭` 契约——在真实使用中不可见；下一次按键反而会路由进取 done 阶段处理器并立刻 deactivate。`RewindOverlay` 现在接受 `{ onSettled }`（`run()` 落到 done 时恰好触发一次，成功与失败皆然），`TuiApp` 把它接到 `overlay.rerender()`。`rewind-overlay.spec.ts` 钉住契约（执行未决不触发，成功与失败各恰好一次）。按 keyless 快照策略，本冒烟即该修复的装配级凭证。

## 边界

- 本泳道的审批卡是升级审批流；P1①（持久 always-allow 规则扩展 `ApprovalOutcome`）是后续工作，可在同一 fixture 上加第三个场景。
- 开发期间工作树中观察到的 4 个 `app.spec.ts` 既有失败属在途 fox WIP（还原本改动后验证仍复现），与本泳道无关。
- 沙箱注记：DSH 代理沙箱内 `posix_openpt` 被拒；请在宿主 TTY 上下文运行本泳道（`pnpm test:snapshot` 带文件过滤）。CI runner 原生提供 PTY。
