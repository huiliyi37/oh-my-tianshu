# @deepseek-ai/dsh-spark-anchors

English | [中文](README.zh.md)

**内部能力**（公开前决策去留）：spark 锚点补偿插件，与 `dsh-llm-deepseek` 的 spark wire 截断**成对上线**。

`dsh-llm-deepseek` 在 `deepseek-spark` route 上把 assistant 推理回传截断为尾部 N token（丢头部）；本插件从「截断丢失域」（前 len−N token 段）提取显式排除路径，随 `agent/pre-step` 注入为 plugin-source user message（form: `snapshot`），作为被截断段落的自足替代物——防止模型重复推导已经排除的路径。

## Config

```yaml
- id: spark-anchors
  name: '@deepseek-ai/dsh-spark-anchors'
  config:
    enabled: true        # optional; false 时完全不注册监听（默认 true）
    maxAnchors: 20       # optional; 去重后锚点条数上限，溢出淘汰最旧（默认 20）
```

## 关键性质

- **与 wire 截断精确互补**：锚点提取用同一 N 同一 tokenizer（`truncateCutStart` / `extractExcludedClaims` 来自 `dsh-llm-deepseek`）；N 从 `llm-deepseek` 的 settings 命名空间读取（同源无漂移），无 settings 时回落默认 `{flash: 300, pro: 0}`。
- **字节稳定**：锚点集合不变 → 注入文本与上次相同 → 跳过（前缀缓存前提）。
- **Model-visible ⟺ logged**：注入经 `createUserMessage` 成为 session 事件（`user/message`，source 标记本插件），从日志可重建。
- **非 spark 零注入**：route 判定走 `request/header` 折叠（provider），首个请求前经 `agentDefaultModel` 兜底。

## Model Experience

### What the model sees

在 spark 会话中，每步请求前会看到一条 `user` 消息，列出「已排除路径」锚点（如 `- A不是最优解`）。锚点集合变化才注入新快照；不变则不重复。非 spark 会话完全无感（零注入）。

### Token effect

锚点文本按条注入，每条为原始推理中一个短排除句；cap 20 条上限防止膨胀。被截断的推理头部不再随每轮回传（节省面在 wire 层）。

### KV Cache effect

注入消息作为新的 user message 追加——锚点集合不变时消息历史稳定，前缀可复用；锚点变化（新排除句出现）时从变化点重建缓存，与任何新消息追加行为一致。

## Known Limitations and Deferred Work

- 提取仅覆盖显式否定句式（中文 不是/不可行/排除…；英文 is not/unlikely/…），宁缺毋滥——非显式排除不提取。
- N 档位依赖 `llm-deepseek` settings 命名空间；若未来 llm-deepseek 改名/摘除，需同步本插件读取点。
- 质量探针（重复工具调用率对照）列公开前决策输入，未内置于插件。
