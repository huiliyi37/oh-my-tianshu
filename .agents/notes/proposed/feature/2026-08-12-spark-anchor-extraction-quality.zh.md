# Agent Note: spark 锚点提取质量——实测缺陷记录与待分析问题

[English](2026-08-12-spark-anchor-extraction-quality.md) | 中文

Status: proposed

## Problem

`dsh-llm-deepseek` 的 spark 推理截断（`truncateReasoningTail`）与 `dsh-spark-anchors` 的锚点补偿（`extractExcludedClaims`）是成对设计：截断丢推理头部，锚点把头部中的"已排除路径"提取回灌，防止模型重复推导。**锚点提取质量是当前功能短板**——纯函数实测（下附数据）发现提取结果存在误提、片段不完整与前导噪音三类问题：EN 排除正则跨中文句号吞段（已修复，commit `339fbba`）、锚点带前导边界字符噪音、提取片段被截成残句、同段重复句不内部去重、误提率无量化语料评估。

## Proposal

锚点提取质量的三类问题按影响排序处理：① 句边界吞段（已修）；② 前导噪音与残句（候选修复：提取后剥离前导 `[.;。！？\s]+`、向完整句边界扩展）；③ 误提率量化与措辞类误提（需代表性语料评估后决定是否升级提取策略）。本文档记录问题与实测数据，供后续分析决策。

## Acceptance criteria

- [ ] 锚点提取在混合语言（中英混杂）推理文本上不跨句边界吞段（已部分达成：`339fbba`）
- [ ] 锚点片段自足（不含前导边界字符噪音、不被截成残句）
- [ ] 锚点误提率（把未排除分析当已排除路径）在代表性语料上可量化评估
- [ ] 锚点质量对模型行为的影响（防重复推导 vs 误导）有分析结论

## Risks

- 锚点误提会把"未排除的分析"当"已排除路径"回灌——模型据此跳过有效路径，比漏提更伤（实现注释明言"宁缺毋滥"）
- 锚点注入增加前缀缓存扰动面：注入文本随锚点集合变化，破坏缓存复用（已由 enabled 同源门控 + lastInjectedText 跳过缓解）

---

## 实测数据（2026-08-12，纯函数探针，非真实模型）

**输入**：典型混合语言工具轮推理（中文分析 + 英文排除句，repeat ×3 放大），1158 token（退化分词）。

| 指标 | 实测值 |
|---|---|
| 原文 | 2334 chars / 1158 tokens |
| 截断后（flash 档 N=300） | 576 chars / 300 tokens |
| 节省 | 1758 chars / **858 tokens（74.1%）** |
| 互补性（丢失域 ∪ 保留尾段 = 原文） | true ✓ |
| 锚点均在丢失域内 | true ✓ |
| 锚点数 | 9 |

**锚点样本**（修复前）：
- `"的方案被排除了"` —— 片段不完整（应为"尝试用 mock provider 的方案被排除了"），重复 ×3
- `".\n再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh "` —— **误提**：EN 正则 `[^.;]` 不含中文句号「。」，从上一句跨句吞段，把未排除的中文分析当已排除路径
- `".\nThe mock provider approach is not feasible because it bypa…"` —— 前导边界字符噪音（`"。"` / `".\n"`）

**最小复现**（已修）：
```
输入: '再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh is not the root cause — the test asserts early.'
修复前: ["再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh is not the root cause — the test asserts early"]
修复后: ["。\nThe token refresh is not the root cause — the test asserts early"]
```

**修复**（`339fbba`）：EN 字符类 `[^.;]` → `[^.;。！？]` + 边界 `[.;。！？]`。回归测试：混合语言输入锚点仅含英文排除句、不含前句中文字段。spark.spec 26 tests 全绿；llm-deepseek + spark-anchors 210 tests 全绿；tsc exit 0。

## 待分析问题清单

1. **前导边界字符噪音**：修复后锚点仍带 `"。\n"` 前缀（正则边界字符包含在 match[0]）——`trim()` 清不掉中文标点。影响：模型可见文本含噪音前缀；不影响语义但丑。修法候选：提取后剥离前导 `[.;。！？\s]+`。
2. **片段不完整/残句**：`"的方案被排除了"` 被截断（正则 `{0,40}?` 非贪婪 + lookbehind 边界导致捕获从中间开始）。理想锚点应是完整句"尝试用 mock provider 的方案被排除了"。修法候选：提取后向两端扩展到完整句子边界。
3. **EN 正则跨中文分号/逗号**：`[^.;。！？]` 不含中文逗号「，」与分号「；」——排除句内含中文列举时可能同样吞段（未实测，理论风险）。
4. **重复锚点**：repeat 语料下同一排除句提取 3 次（`collectAnchors` 有去重，单次 `extractExcludedClaims` 内部不去重——跨事件聚合时 OK，但同一 reasoning 内重复句去重缺失，浪费 maxAnchors 配额）。
5. **误提率无量化**：无代表性语料评估"把未排除当已排除"的比例——修复只覆盖了句边界，措辞类误提（如 "is not the best option" 这类非排除句）未覆盖。
6. **锚点质量 → 模型行为影响无实证**：防重复推导效果、误导副作用均未用真实模型实测（需 DEEPSEEK_API_KEY + 真实 spark 会话）。

## Alternatives considered

修复方案对比：正则扩展（已选，改动最小）vs 用分句器（先分句再匹配，更准但引入依赖）vs LLM 提取（最准但成本与不确定性高）。当前取正则扩展 + 句边界补丁；后续若误提率实测偏高再评估分句器方案。

<!-- 相关实现：packages/llm/llm-deepseek/src/spark.ts（extractExcludedClaims）；packages/context/spark-anchors/src/index.ts（collectAnchors/renderAnchors） -->
