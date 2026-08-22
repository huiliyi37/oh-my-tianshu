# Agent Note：vision-bridge 描述撞 token 上限的续写补偿

Status: implemented

[English](2026-08-22-vision-bridge-description-continuation.md) | 中文

## Problem

一张六主体幻想生物概念图经桥转述后，描述在半句处截断并带 `[图片描述被截断]` 标记：通用结构化 prompt（文字内容/界面元素/可能意图）叠加多主体图片，输出超出缺省 `maxTokens: 1024`，且撞限是非确定性的——同一张图重试一次就装下了。标记触发正确，但主控模型拿到的仍是半份描述，且没有任何恢复路径。

## Decision

`@huiliyi37/dsh-vision-bridge` 两处变更：

- **缺省预算提升**：1024 → 2048 输出 token。
- **一次有界续写**：首次调用以 `max-tokens` 结束时，桥携带助手的截断文本加继续指令再次请求（"从中断处接续，不要重复"），拼接尾部。连续第二次撞限——或续写自身失败——才追加 `[图片描述被截断]` 并保留部分文本（fail soft：部分优于全无）。最坏情况是两次各 `maxTokens` 的调用；没有无限循环。

流式路径重构为 `callOnce` 助手，两次调用共享 error/aborted 处理；fallback 备用模型的重试语义不变，包裹整个 attempt。

## Alternatives considered

**只提缺省。** 拒绝：不够——比新预算更长的尾巴照样截断，等于在更富信息的图片上复现今天的失败。

**不限次的 continue-until-stop 循环。** 拒绝：恰在模型啰嗦时成本失控；一次续写把花费封在 `2 × maxTokens`。

**prompt 里要求写短一点。** 拒绝：简短指令会牺牲逐主体的细节，而那正是描述的价值所在。

## Consequences

多主体图片不再丢尾；标记现在的含义是"截断了两次或续写失败"——可行动而非常态。续写对每份被截断描述最多多花一次辅助调用，与桥的其余部分一样远离活请求路径。覆盖：`packages/context/vision-bridge/tests/vision-service.spec.ts`（continue-ok 拼接无标记、双截断两次调用落标记、续写失败 fail-soft、schema 缺省 2048）。假 adapter 现经 `resolveModel` 声明 `supportsVision`——统一图片管线会把 image block 从纯文本模型请求中剥除，不声明则请求内容断言观察不到原始 image block。
