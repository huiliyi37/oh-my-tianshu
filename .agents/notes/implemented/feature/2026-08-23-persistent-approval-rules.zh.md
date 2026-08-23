# Agent Note：持久化工具模式审批规则

Status: implemented

[English](2026-08-23-persistent-approval-rules.md) | 中文

## 问题

[审批 seam](../../../../packages/interaction/user-approval/README.md)只给一次性裁决：其文档化局限是既无记忆规则、无 `allow-always`、也无授权库，而[权限预设](../../../../packages/interaction/permission/README.md)打包的是整会话策略，不是按工具的模式。用户因此反复回答重复出现的审批，或者干脆切到 `/yolo` 放弃粒度。Claude Code 用持久化的工具模式规则（如 `deny Bash(git push:*)`）和管理面解决这个问题。

## 决策

新包 `@huiliyi37/dsh-approval-rules`，位于 `packages/interaction/approval-rules/`，持久化按工具的 allow/deny 模式规则，通过 seam 应答审批请求，并交付 `/permissions` 管理命令。挂载为 opt-in。

### 规则存储

规则放在宿主直接读写的 YAML 文件中；文件与内容永不进入模型请求。用户层是 `<resolveDshHome()>/permissions.yaml`，项目层是 `.dsh/permissions.yaml`（延续既有 `.dsh/` 约定），两者均可经 `Config` 覆盖；有效列表先合并用户条目、后合并项目条目，匹配按合并序返回首条命中。格式非法的文件在插件装载时 fail loud。磁盘是权威存储：`add`/`remove` 先提交到层文件、写成功后才镜像内存快照，`remove` 按新读的磁盘解析其列表索引；无文件监听——外部编辑重启后可见。

一条规则指定一个工具、一个 glob `pattern` 与一个 `decision`：

```yaml
- tool: bash
  pattern: '*git push*'
  decision: deny
```

pattern 对工具调用的规范化参数串做全串锚定——即所引用 `tool/call` 事件的原样 `arguments` 值、空白折叠后。多数工具从模型收到 JSON 编码的参数（bash 风格调用规范化后形如 `{"command":"git push",…}`），因此 pattern 以两侧 `*` 锚定稳定的内侧子串；README 写明了这一形状，因为裸的 `git push*` 永不匹配 JSON 编码的调用，而静默失效的 deny 规则等于 fail open。

### 应答者语义与装配顺序

Cordis waterfall 没有优先级机制：`approval/request` 监听者按注册顺序执行，且 seam 明确警告兄弟顺序不是策略优先级机制。因此实装设计持有显式的**装配顺序契约**：只有本包先装配，规则应答者才先于交互式应答者；README 与 JSDoc 写明该契约，测试用一个会急切放行的"晚到交互应答者桩"钉住它。规则未命中时应答者经 `next()` 委托。本包不改 `ApprovalOutcome` 词汇表、不触碰 sandbox/mode，`never` 策略仍在任何应答者之前拒绝——在存在命中 allow 规则的 `policy: 'never'` 测试下证明。

### 来源事件

每次自动裁决向所属会话追加 log-only 的 `approval/rule` 事件（waterfall 请求自带 agent，无需会话查找），落在匹配的 `approval/asked` 与 `approval/decided` 之间，携带命中规则的工具、pattern、裁决、有效索引与所属层。包不变量伴生在预提交处校验该事件（`internal/dispatch`——throw 即否决 append）、提交后应用其 fold、并在伴生装载时重校验既有会话的历史。

### 命令面

`/permissions`（无参）列出有效规则；`add <tool> <pattern> <allow|deny>` 追加到项目文件；`remove <index>` 按有效索引从所属层移除。命令注册到 `ctx.commands`（可选注入，纯规则的无头组合也能装载），并以 [`/next-workflow` 的方式](../../../../packages/workflow/next-workflow/README.md)镜像进 TUI 斜杠菜单；文案显式区别于既有单数 `/permission` 预设切换器。

## 备选方案

### 为什么不用组合式唯一终态应答者？

原提案让本包持有部署的唯一终态应答者组合——先查规则、未命中直接调用注入的交互式应答者——以构造而非注册顺序保证优先级。它落选是因为需要新增 `tui.approvalAnswerer` 宿主 seam 来暴露各适配器的交互应答者：这是只有一个消费者的跨适配器契约变更，还颠倒了 seam 的组合所有权。装配顺序契约对正确的组合达到同等保证，且 seam 保持不动；错误装配会显性失败（交互应答者应答一切），而非静默。

### 为什么不扩展 seam 的裁决词汇表？

给 `ctx.approval` 加 `allow-always` 与记忆授权库，会改变每个消费者都必须遵守的 seam 契约，且会话内授权仍随会话消亡。规则是既有一次性词汇表之上可分离的策略层。

### 为什么不用沙箱命令策略 DSL？

Codex 的 execpolicy 式前缀 DSL 管辖命令执行，是比审批应答更宽的机制，也更贴近沙箱 seam。[codex 候选目录](../../proposed/feature/2026-08-22-codex-harness-enhancement-candidates.md)已将其列为单独评估项；审批规则与 exec policy 在有证据之前保持分离。

### 为什么不用基于 settings 的规则？

settings seam 热提交部署配置；审批规则是按项目的用户意图，其权威归宿是项目目录，而 settings 文件不是项目局部的。

## 后果

- 组合测试覆盖各情形：`deny` 结算 `rejected`、`allow` 结算 `allowed-once` 且不触碰晚到的交互桩，未命中请求经 `next()` 委托；loader-composition spec 经真实 Loader 引导证明同样行为，外加格式非法文件的装载期失败。pattern 测试覆盖全串锚定、`*` 串、多字节参数与跨两层的首命中优先；变更测试钉住磁盘权威提交（失败的 add 永不进入有效快照）与外部编辑一致性（remove 按新读磁盘解析）。
- 不变量伴生有独立 spec：接受配对、拒绝未配对与重复规则、拒绝非法词表、装载时拒绝重放。
- 未知工具名不在装载期校验（工具面可能晚装配）；它们在请求时自然永不命中。
- 第一版文法是简单的锚定 glob 而非 regex：pattern 可能欠匹配或过匹配，`/permissions` 列表让当前授权始终可见，作为制衡。
- `allow` 规则是常设授权；文件以 `0600` 写入，README 记录文件权限卫生。
- 规则为部署内全部 agent 应答，含 subagent；per-agent 规则作用域推迟到有消费者提出。
- `approval/rule` 事件不带 approval id；按工具名关联其 asked 兄弟，不变量的配对 fold 强制该纪律（id 配对的 keyless 快照已延后）。
- ACP 自动化桥保持自己的一次性机器裁决，本版不咨询规则。
