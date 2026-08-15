# Agent Note: 非 bracketed paste 终端粘贴不再逐行分批发送

Status: implemented

[English](2026-08-16-input-paste-line-burst-merge.md) | 中文

## 问题

在不支持 bracketed paste（DECSET 2004——部分老 Windows 控制台、部分 SSH 客户端、未开 passthrough 的 tmux）的终端上，多行粘贴以裸字节到达：每行行尾的 CR（`\r`）被解析为一次 Enter，导致**粘贴的每一行被当作一条消息逐行发送**（"复制长文本换行进来就开始反复发送"）。支持 bracketed paste 的终端把粘贴包裹在 `\x1b[200~ … \x1b[201~` 里走 `onPaste` 路径（整段一次插入），该缺陷不可见。物理 CR 与用户按 Enter 无法区分，修复必须借助周边数据作为证据。

## 决策

`InputHandler` 现在给 `return` 键打上 `inline: true` 标记——当同一输入缓冲在该键**之后还有字节**时（`dispatchKeys`：`i + consumed < buf.length`）。用户按 Enter 时缓冲已空；粘贴行的 CR 后紧跟下一行文本（同一 flush）。`InputLine` 把内联 return 当作行分隔：累积当前值（`_inlinePasteLines`）并清空输入行、不提交；下一次普通 return（缓冲耗尽——即粘贴的最后一个 CR 或用户自己的 Enter）把所有累积行按 `\n` 合并为一次提交。Vim normal 的 return 路径同样合并。bracketed paste 流程不受影响（永不产生内联 return）；普通单次 Enter 不变（无累积 → 立即单行提交）；人工快速连按两次 Enter 仍是两次独立提交（每个 CR 独立成 chunk）。

两个仓库同步应用：`tianshu-public`（`packages/tui/tui`）与插件库 `dsh-tui`（`src/`）——两边源文件同源但无共同 git 祖先，以生成补丁按语义分别落地。

已知残余：终端把粘贴拆成多个 flush（如 >64KB、pipe buffer 边界）时仍按 flush 逐批提交；支持 bracketed paste 的终端永不进入此路径。

## Alternatives considered

**时间窗口提交防抖。** 否决：合并要求第一行也被扣留，会延迟每次 Enter；且已提交的行无法撤回，窗口合并仍会漏出第一行。

**把所有 CR 归一化为换行插入。** 否决：破坏普通输入的 Enter 提交语义。

**只依赖 bracketed paste。** 否决：它已是快路径；缺陷恰恰出现在终端无法提供它的场景。

## Consequences

非 bracketed paste 终端上的多行粘贴现在以一条 `\n` 连接的消息落定，与 bracketed paste 行为一致；粘贴流期间输入行逐行清空，提交时才显示合并文本。测试覆盖 handler 标记、行合并、单次 Enter 不变、app 黑盒用例（三行 → 一次 `followup` 调用）。插件库工作树同样携带该修复（未暂存），叠加在其进行中的 `review/prs` merge 之上。
