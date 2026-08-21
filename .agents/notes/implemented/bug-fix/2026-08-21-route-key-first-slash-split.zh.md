# Agent Note: 路由键按首个斜杠分割

Status: implemented

[English](2026-08-21-route-key-first-slash-split.md) | 中文

## Problem

TUI 把 picker 行与 `/model` 实参都编成 `provider/model` 字符串，而所有消费方都用 `value.split('/')` 解构解析——模型 id 自身含 `/` 时会被**静默截断**。OpenRouter 风格 id（`stealth/ox-alpha`、`anthropic/claude-sonnet-4.5`）让 picker 确认成 `{provider: 'openrouter', model: 'stealth'}`、让命令文法把三段输入判为畸形，于是选择内置 OpenRouter 模型后的首次请求以截断 id 的 `UNKNOWN_MODEL` 形错误失败。

## Decision

`provider/model` 键只按**首个**斜杠分割：provider 路由键不含 `/`（目录 id 与 settings 字典键皆是），而模型 id 确实可能含。解析函数是 TUI 共享纯函数层 `model-roles.ts` 里的 `parseRouteKey`,主/角色 picker 回调与两处 `/model` 实参路径统一换用。无斜杠输入保持既有裸模型语义（沿当前 provider 换模型）；含斜杠输入一律读作 provider 在前，因此当前 provider 不匹配时的 `stealth/ox-alpha` 会以目录校验失败点名可疑 provider，而不是去猜。

## Alternatives considered

- **按 provider 感知解析**（首段命中已知路由才当 provider）。否决：解析结果将依赖实时目录状态，同一段输入会随路由增减改变含义，纯函数层还得注入 llm seam。
- **在 profile 层拒绝含斜杠的模型 id**。否决：这类 id 是提供方原生的（OpenRouter 及任何带厂商前缀的网关）；强迫改名会让 harness 目录与线上协议脱钩。

## Consequences

- OpenRouter 目录路由在 TUI picker 与 `/model` 实参（含角色 pin `/model vision openrouter/stealth/ox-alpha`）下完整可用。
- `a/`、`/b` 一类空侧输入不再走用法错误分支，而是落入裸模型路径，在目录校验以与其他未知模型相同的响亮消息失败。
- Web composer 不受影响：它组装的是结构化 provider/model 值，从不做字符串解析。
