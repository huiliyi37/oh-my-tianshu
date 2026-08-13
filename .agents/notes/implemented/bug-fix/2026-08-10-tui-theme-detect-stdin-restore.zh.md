# Agent Note: 在终端背景检测后对称恢复 stdin 状态

Status: implemented

[English](2026-08-10-tui-theme-detect-stdin-restore.md) | 中文

## 问题

在真实 TTY 上，`dsh tui` 渲染出了空闲状态与提示符，但不接受任何按键，连 Ctrl+C 也不例外。`TuiApp` 构造函数创建 `InputHandler`，后者启用 raw 模式、恢复 stdin 并订阅 `data`；随后 `attach()` 在默认的 `theme: 'auto'` 下运行 `detectTerminalBackground()`，其清理逻辑无条件调用了 `stdin.pause()`。`pause()` 是流级状态：它会停止向所有监听器投递 `data`，包括刚刚接入的 `InputHandler`，而进程内没有任何代码再恢复该流。raw 模式保持启用，因此终端也不回显：UI 看似存活，而每个按键字节都被丢弃。该包的测试注入了一个非 TTY 的假 stdin，它在进入 pause 路径之前就走环境变量兜底分支，因此该缺陷带着全绿的测试上线。

## 决策

`detectTerminalBackground` 在响应路径与超时路径上都会把流恢复到进入时的状态：它在既有 `wasRaw` 守卫旁捕获 `wasPaused = stdin.isPaused()`，仅当流在进入时处于暂停状态，才在退出时调用 `stdin.pause()`。模块约定从「必须在 TUI 接管 stdin 之前调用」变更为恢复保证：无论接管是否已发生，该保证都成立。

## 备选方案

**强制检测先于接管的调用顺序**：在检测完成后惰性构造 `InputHandler`，或在构造 `TuiApp` 之前检测。不予采纳：为兑现一个函数在文档中声明却未实现的约定而进行更大规模的重构；对称恢复直接在违规的那一行修复缺陷，且在任一调用顺序下都保持正确。

**在检测后于 `attach()` 中重新恢复 stdin。** 不予采纳：它只在一个调用点掩盖了破坏性的拆除行为，而 `detectTerminalBackground` 对其他所有现存与未来的调用方仍然不安全。

## 影响

主题检测不再干扰正在流动的 stdin；使用假 TTY 流的回归测试固化了 OSC 11 响应、超时与进入时已暂停三条路径。在最长达 500 ms 的检测窗口内键入的按键，仍会在按键路由注册之前被解析并被静默丢弃：这是一个既有的启动窗口缺口，本次变更刻意保持不动。
