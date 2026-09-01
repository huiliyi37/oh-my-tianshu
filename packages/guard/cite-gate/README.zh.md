# @huiliyi37/dsh-cite-gate

[English](README.md) | 中文

一个只给建议的引用闸门，不是面向模型的工具：不出现在工具列表里、不否决也不改写任何调用，只做一件事——每条助手消息落盘后，如果它引用了自己撑不住的东西，就把一条短提醒折进下一步：

1. **幻觉升级卡 ID**——不在 [dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill) 卡片词表（curated 版本卡片 + 走廊 rollup 编译而来）里的 `DSH-0.1.2-A9-99` 之类 ID。自造权威卡片是迁移类回答里最常见的幻觉形状；
2. **旧错误码**——0.1.1 时代的连字符码（`cancelled`、`internal`、`session-not-found` 等），alpha.2 已改为命名空间码（`gateway/cancelled`、`session/not-found` 等）。按老码分支在新宿主上永不命中；
3. （可选，默认关）不在 curated alpha.2 清单里的**未知命名空间码**；
4. **引了没读**——回答引用了本会话从未读取/写入过的文件路径。引用没打开过的路径是另一种经典幻觉形状。

决定权完全在模型手里；所有提醒都是建议性质，且每轮限流（默认 3 条，按会话去重）。

## 动机（2026-09-01 benchmark 标定）

upgrade-skill benchmark 的 with/without 双轮标定给出了本闸门要补的洞：闭卷 agent 内容正确率 60–90%，但仓库词汇命中 0%——并且会自造不存在的卡片（如"apply 生命周期替换"）当作确凿结论。本闸门把这个失败模式从事后判分扣分变成会话内的即时提醒。

## 机制

- `tools/post-execute`——带路径的读写工具调用把该路径记为"已见"（写过文件当然意味着会话产出了它的内容）；
- `agent/pre-step`——扫描上次以来新增的助手消息，发现项经 `decision.messages` 折进当前步（与 doom-loop-guard 同一投递路径；`agent.inject()` 会进 next-step 队列，在收尾回合里注入的条目不会被后续回合领取）。

## 配置（cordis.yml，插件 `config`）

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `reminderBudget` | `3` | 每条助手消息每轮提醒数 |
| `cardCheck` | `true` | 拦幻觉卡 ID |
| `legacyCodeCheck` | `true` | 拦 0.1.1 旧错误码 |
| `namespacedCodeCheck` | `false` | 也拦 curated 清单外的命名空间码（噪声大） |
| `pathCheck` | `true` | 拦"引了没读"的路径 |
| `readTools` / `writeTools` | 发现类 / 编辑类工具 | 登记路径的工具名 |

## 词表

`src/vocabulary.ts` 由 `scripts/compile-vocabulary.mjs <path-to-dsh-plugin-upgrade-skill>` 生成——上游技能仓库增补或重编号卡片后重新运行即可。旧码→新码映射是卡片 `DSH-0.1.2-A2-02` 的人工誊抄，刻意写成代码常量而非解析散文。

## 边界

- 纯建议：发现项不拦截消息、不改写回答、不失败验证；
- 词表是上游技能的 **curated** 清单，不是完整 API diff——ID 缺席是证据不是定论；
- 同一发现项每轮只提醒一次；超出预算后继续观察只是不再提醒。
