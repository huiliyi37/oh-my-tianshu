# Agent Note：bash 模型输出成形

Status: implemented

[English](2026-08-21-bash-model-output-shaping.md) | 中文

## 问题

bash 结果的模型可见正文保留执行器采集的全部内容（最多 64KB 尾段）：冗长的成功命令把整个 happy-path 日志灌进上下文，失败命令的真实错误被淹没在输出墙里。token 花费与上下文膨胀毫无信息收益——上游天枢仓实测 61% 的 cacheCreate token 来自轮内工具结果增长，并把 rtk 的每命令过滤内生化成分层 output-store 策略。

## 决策

`dsh-tool-bash` 现在对前台模型可见正文成形（上游 `output-store` 脉络，内生化于 `packages/bash/tool-bash/src/model-output.ts`）：

- 成功正文超过 `outputSuccessTailLines`（缺省 20；0 关闭）折叠为尾部行并附精确省略计数。
- 失败正文超过 `outputErrorThresholdLines`（缺省 40）保留错误相关行——诊断词汇 regex 命中 ±2 行上下文，外加头 3/尾 2 锚——总量不超过 `outputErrorBudgetLines`（缺省 60）；命中数本身超预算时回退为同预算的确定性头尾切分。
- 不超过阈值的正文逐字节原样通过。只删不编；每次省略都带计数（继承纪律：小输出不动、只删不编、丢内容必留标记、原文可恢复）。

恢复：成形省略任何内容之前，完整组合正文（stdout + stderr 段，含执行器截断通知）先落盘 `ctx.spillStore`，省略通知携带定位符（前台值的 `outputSpillPath`）。重跑命令永远不是恢复手段——命令可能有副作用。设计上 best-effort：无 spill 后端、无会话主或落盘失败都降级为不带路径的省略计数，绝不使调用失败。

落点：成形函数是工具本地的（无跨包运行时依赖）；执行器自身的上限（64KB 内存尾段 + spill）与通用 `spill-policy` post-execute 上限（50KB，已在发货 `dsh-base` bundle 挂载）是其下/其上的不变层。`dsh-tool-pwsh` 今天只复用标记契约；把成形提升进 `dsh-bash` 等待真实的 pwsh 消费者出现。

## 验证

- 纯函数（`model-output.spec`）：正文组合（stderr 段、执行器截断通知）、丢弃判定（阈值、0 关闭）、成功折叠（精确计数、单复数、尾换行、spill 后缀）、错误精选（头/窗口/尾锚、缺口标记、超预算头尾回退）。
- 工具级真实执行器（`tools.spec`）：`seq 1 50` 折叠为 `[30 earlier lines omitted]`；真实失败的 61 行命令保留 `FATAL:` + 尾锚 + 末尾 `[exit code: 1]`；spill 接线保存完整正文并在通知中给出 `/spill/bash.txt`；无后端/无 agent 的调用诚实降级；短输出逐字节不变。
