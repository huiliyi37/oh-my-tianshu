# Agent Note: 以会话事件供给流式提交流水线

Status: implemented

[English](2026-08-10-tui-streaming-commit-feed.md) | 中文

## 问题

assistant 回复从未到达 scrollback。移植的设计把 `text-delta → BlockStreamWriter`（节流）`→ StreamRenderer`（稳定的 markdown 块边界）`→ commit` 串联起来，但始终没有任何代码调用 `BlockStreamWriter.push`：流水线搭建完成，却从未接线。流式文本只显示在实时区域尾部，它由 transcript（文本记录）的 `streaming` 折叠区投影而来，并在轮次关闭的那一刻消失：UI 在缺失回复的上方显示着收尾信息。

## 决策

`mountSession` 为活动会话订阅一条流式供给：`assistant/chunk` 文本增量推入块写入器，`assistant/message` 与未中止的 `turn/end` 冲刷写入器并终结渲染器，提交所有剩余的待处理文本。实时区域尾部读取 `StreamRenderer.getLiveTailLines`（待处理内容加上写入器的缓冲区），而非 transcript 中整条流的文本，因此已经提交到 scrollback 的块绝不会渲染第二次。`handleAbort` 与会话 detach 会丢弃写入器缓冲区并重置渲染器；被中止的 `turn/end` 跳过终结步骤，使被取消的片段不会进入 scrollback。此次改动后不再使用的 `renderStreamingTail` 辅助函数随之移除。

## 备选方案

**在 `assistant/message` 上提交组装好的消息行，而不为流接线。** 不予采纳：这会搁置移植来的增量 markdown 机制（稳定边界提交、围栏闪烁防护、渲染缓存），并让长回复作为一个迟到的块落地，而不是让稳定段落渐进滚动显示。

**让推理（reasoning）增量走同一条流水线。** 不予采纳：transcript 的消息折叠区只保留文本块，因此提交推理会在 scrollback 中画出会话日志自身投影永远不会复现的内容。

## 影响

回复在轮次结束后持续存在，实时尾部只显示未提交的文本（scrollback 与实时区域之间的单一渲染所有权）。推理增量不再出现在实时尾部：它们曾是旧的、源自 transcript 的尾部的一部分，不在本次落地的设计范围内；恢复推理的展示面是一个独立的显示决策。
