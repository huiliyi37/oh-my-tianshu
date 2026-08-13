# Agent Note: 在 TUI 实时区域中呈现 agent 错误

Status: implemented

[English](2026-08-10-tui-agent-error-live-surface.md) | 中文

## 问题

失败的轮次在 TUI 中不产生任何可见输出。agent loop（智能体循环）通过 `agent/error` 上报 LLM（大语言模型）失败（无效的 API 密钥、网络错误），并以携带错误原因的 `turn/end` 结束轮次；`trackAgent` 已把该事件折叠进 `live.state.lastError`，但没有任何渲染路径消费它，而 transcript（文本记录）折叠又有意忽略非消息事件。用户看到的是已提交的消息、一次短暂的状态变化，然后是空闲提示符——一段无声无息死掉的对话。

## 决策

`renderLive` 把最近一次呈现的 agent 错误绘制为一行 `✗ <message>`（字形降级时为 ASCII `x`），使用主题的错误颜色，并在第一个换行符处按终端宽度截断。投影在 agent 下次进入 `running` 时清除 `lastError`，因此干净启动的重试不会在屏幕上留下陈旧的失败，而错误在失败轮次之后的空闲状态期间仍然保留。

## 备选方案

**把错误作为 transcript 行提交进 scrollback。** 不予采用：`turn/end` 的错误原因不是消息行，而制造一种新的 transcript 行类型，会为一个状态类事实扩大投影词汇；实时区域本就是瞬态状态所在之处（`✗ 已停止` 的 agent 消失行就是相邻先例）。

**直到会话切换才清除错误。** 不予采用：失败会比一次成功的重试停留得更久，而改为在空闲时清除又会立即隐藏错误，因为失败的轮次以 running → error → idle 结束。

## 影响

配置错误现在会在 TUI 中大声失败——无效密钥的情形会在下一帧显示 `✗ AUTH: Authentication Fails…`，而不是无声无息地死掉。出错的轮次之后，工作流状态行仍显示最后一个 phase，因为非 `completed` 的 `turn/end` 不改变 phase 视图；这是一个独立的外观缺口，刻意不纳入本次修复。
