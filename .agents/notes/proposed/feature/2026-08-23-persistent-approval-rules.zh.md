# Agent Note：持久化工具模式审批规则

Status: proposed

[English](2026-08-23-persistent-approval-rules.md) | 中文

## 问题

[审批 seam](../../../../packages/interaction/user-approval/README.md)只给一次性裁决：其文档化局限是既无记忆规则、无 `allow-always`、也无授权库，而[权限预设](../../../../packages/interaction/permission/README.md)打包的是整会话策略，不是按工具的模式。用户因此反复回答重复出现的审批，或者干脆切到 `/yolo` 放弃粒度。Claude Code 用持久化的工具模式规则（如 `deny Bash(git push:*)`）和管理面解决这个问题。

## 提案

新包 `@huiliyi37/dsh-approval-rules`，位于 `packages/interaction/approval-rules/`，持久化按工具的 allow/deny 模式规则，通过 seam 应答审批请求，并交付 `/permissions` 管理命令。挂载为 opt-in。

### 规则存储

规则放在宿主直接读写的 YAML 文件中；文件与内容永不进入模型请求。用户层是 `$DSH_HOME/permissions.yaml`，项目层是 `.dsh/permissions.yaml`；有效列表先合并用户条目、后合并项目条目，因此后到的项目规则确定性地赢得平局。格式非法的文件在插件装载时 fail loud。

一条规则指定一个已注册工具、一个对完整规范化参数串的 glob 模式（`*` 匹配任意串，匹配在两端锚定）以及 `allow` 或 `deny` 裁决：

```yaml
- tool: Bash
  pattern: 'git push:*'
  decision: deny
```

### 应答者语义

seam 契约要求每个部署只组合一个终态应答者，且不把兄弟监听器顺序当作策略机制，因此该包以构造保证优先级，而非依赖注册顺序。它注册部署的唯一终态应答者，形式为组合：先查规则，再以注入的交互式应答者为后备——宿主适配器通过一个小型服务 seam 暴露其应答者（TUI 的 `tui.approvalAnswerer`，目前 TUI 在内部注册监听器），组合后的 handler 在规则未命中时直接调用后备。没有注入应答者时链仍会终结：未命中 settle 为 `unavailable` 并 fail closed。首个命中的规则作答——`allow` 返回 `allowed-once`，`deny` 返回 `rejected`。规则只应答审批请求：不触碰 `sandbox/mode`、不改变 `approval/policy`，且 `never` 策略仍在应答者运行前拒绝，规则无法覆盖它。规则裁决在 `approval/asked` 与 `approval/decided` 之间追加 log-only 的 `approval/rule` 事件，携带命中的规则引用与裁决，因此日志可以重建每次自动应答请求的来源。

### 命令面

`/permissions`（无参）列出有效规则；`/permissions add <tool> <pattern> <allow|deny>` 追加到项目文件；`/permissions remove <index>` 移除所列规则。命令注册到 `ctx.commands`，并以 [`/next-workflow` 的方式](../../../../packages/workflow/next-workflow/README.md)进入 TUI 斜杠菜单。

## 备选方案

### 为什么不扩展 seam 的裁决词汇表？

给 `ctx.approval` 增加 `allow-always` 与记忆授权库会改变每个消费者都必须遵守的 seam 契约，而且会话本地的授权仍随会话消亡。规则是叠加在既有一次性词汇表之上的可分离策略层。

### 为什么不用沙箱命令策略 DSL？

Codex 的 execpolicy 式前缀 DSL 治理命令执行，比审批应答更宽，也更靠近沙箱 seam。[codex 候选清单](2026-08-22-codex-harness-enhancement-candidates.md)已把它列为单独评估项；在有证据之前，审批规则与执行策略保持分离。

### 为什么不用 settings 存规则？

settings seam 热提交的是部署配置；审批规则是逐项目的用户意图，权威归属是项目目录，而 settings 文件不是项目本地的。

## 验收标准

- 真实装配 e2e 在每种情况下驱动审批请求：`deny` 规则 settle 为 `rejected`、`allow` 规则 settle 为 `allowed-once` 且都不调用注入的交互式应答者，未命中请求到达后备——经组合出的唯一终态应答者证明，不涉及兄弟监听器顺序。
- e2e 断言 `approval/asked` → `approval/rule` → `approval/decided` 序列，且模型只看到消费者的工具结果。
- 模式测试覆盖两端锚定、`*` 任意串、多字节参数，以及跨两层的先命中优先顺序。
- 装载期失败被证明：非法的规则文件、未知工具名、保留裁决值分别 fail loud。
- HMR 安全测试销毁插件 fiber 并观察到应答者撤回；TUI 接线测试证明宿主暴露 `tui.approvalAnswerer`，并在规则参与组合时停止自注册内部监听器。
- `/permissions` 的 add/list/remove 面有单测覆盖，外加列表的 TUI 快照；包 invariant 锁定规则文件与已载规则的consistency及来源事件形状。双语 README 对与本笔记的晋升随落地提交交付。

## 风险

- 首版语法是简单的锚定 glob 而非正则：模式可能欠匹配或过匹配，`/permissions` 列表保持当前授权可见作为对冲。
- `allow` 规则是常设授权；文件仅宿主可写，README 记录文件权限卫生要求。
- 规则为部署内所有 agent 作答，包括 subagent；per-agent 规则作用域推迟到出现消费者需求。
- 应答者 seam 的补充触及 TUI；ACP 自动化桥保留自己的一次性机器裁决，首版不查询规则。

## 实现修订（2026-08-23）

已在工作区实现为 `packages/interaction/approval-rules`，含以下修正：

- waterfall 无优先级机制（顺序=注册顺序；seam 明言 sibling order 不是策略优先级）。「先于交互应答者」改为显式挂载顺序契约——写入 JSDoc/README，并用「晚到交互应答者桩」测试钉住规则先裁决、事件序列恰为 asked → rule → decided。
- 未知工具名不做加载期校验（工具面可能晚装配）；请求时自然不匹配即可。
- 溯源事件直接落在 `req.agent.session`——waterfall 请求自带 agent，无需会话反查。
- `/permissions` 文案显式区别于既有单数 `/permission` 预设切换器与 `permissions` 投影键。
- `.dsh/` 项目层约定已存在（`.dsh/skills|agents|memory`），`.dsh/permissions.yaml` 是其延伸而非新发明。
