# @huiliyi37/dsh-cache-diagnostic

English | [中文](README.zh.md)

通过单例 `ctx.cacheDiagnostic` 服务做前缀缓存健康观测。它按会话从持久化日志推进一个隔离折叠（与 `@huiliyi37/dsh-token-meter` 相同的 replay 模式），回答三个问题：缓存前缀里**什么变了**（`request/header` 指纹）、provider 缓存的**命中情况**（逐轮快照与命中率）、以及一轮**为什么未命中**（分类诊断）。移植自 opencode-tui 上游缓存遥测，字段语义对齐本仓库约定。

## 配置

服务无设置项。任何配置键都会被拒绝。

## 服务契约

`ctx.cacheDiagnostic` 暴露四个操作：

- `diagnose(session, options?)` — 对最新一轮的缓存未命中分类，轮次健康时返回 null。`options.drift` 与 `options.wasCompacted` 可覆盖折叠得到的信号（供更了解上下文的调用方使用）。
- `turnHistory(session)` — 逐轮缓存快照（`turn`、`cacheRead`、`cacheWrite`、`inputTokens`、`outputTokens`），由 `assistant/message` 的 usage 折叠而成，每个上报过 usage 的轮次一条。
- `hitRate(session)` — 累计缓存命中率：整个会话的 `cacheRead / inputTokens`。
- `recentHitRate(session, lastN)` — 最近 N 轮的同一命中率。

命中率用**总输入 token** 作分母（而非 `cacheRead + cacheWrite`），provider 不报写 token 时命中率不会退化为 100%。

## 前缀指纹

`request/header` 事件喂给三源 SHA256 指纹：系统提示文本、工具 schema（哈希前按名称排序，目录重排不算漂移）、序列化后的调用配置（provider/model/推理档位/最大 token 及 adapter 默认值）。header 变化时，用前一个指纹与新指纹比较，按源归因漂移（`systemChanged` / `toolsChanged` / `configChanged`）——这是 `headerEquals` 给不了的归因：它回答**什么**变了，而不只是"有东西变了"。

## 未命中诊断

`diagnoseCacheMiss` 按下述顺序分类最新一轮：无缓存计数 → 首轮 → 命中率 ≥ 0.8（无需解释）→ 前缀漂移 → 压缩 → **前缀截断** → 缓存驱逐 → 正常增长。

`prefix_truncation` 是最需要关注的情形：追加式会话里 `cacheRead` 单调不减，所以相对上一轮的**回退**意味着共享前缀在中段停止匹配（客户端字节抖动或 provider 侧重渲染）——与尾部增长截然不同。上游 8396ac51 调查发现这类情形曾被误标为正常增长、掩盖了约 30K token 的重建事件；本分类器将它们区分开。

## 会话投影

组合提供 `ctx.sessionProjections` 时，服务通过可选子纤维注册一个投影单元：

`cacheHealth` 携带累计 `hitRate`、`recentTurnHitRate`、`lastMissReason`（仅 warn/error 级——首轮与正常增长的 info 级判定属正常运作，不进摘要）、以及最新的 `drift` 归因。

## 组合

```yaml
- name: '@huiliyi37/dsh-cache-diagnostic'
```

## 已知限制与后续工作

- **诊断是观察性的** — 它依据 provider 上报的计数解释未命中，并不预防未命中。前缀稳定性工程（plan mode 段落位移、zen 面收窄）归属拥有提示词的包。
- **不含冻结前缀持久化** — 上游 `frozen-snapshot.ts` / PromptEngine 继承（resume 时字节一致前缀）是提示词层的改动，另行跟踪。
- **usage 采样是逐轮聚合** — 同一轮内的多个步骤合并为一条快照；轮内变化不可观测。
- **provider 计数按上报采信** — 副本虚报 `cacheRead`（上游实测虚报 514K）会表现为漂移/截断噪声，而非修正后的数值。
