# @huiliyi37/dsh-approval-rules

[English](README.md) | 中文

作为 `ctx.approval` 缝之上的策略层，提供持久化的 per-tool allow/deny 审批规则。本包注册一个 `approval/request` waterfall 应答者，读取两个 YAML 层合并后的规则列表，在首条命中时确定性地结算请求——`allow` 解析为持续授权 `allowed-always`，`deny` 解析为 `rejected`——不咨询任何交互应答者。未命中时通过 `next()` 委托，因此后装的交互应答者仍可裁决。`/permissions` 命令（见下）管理规则文件；它与既有的单数 `/permission` 预设切换器刻意区分。

实现从不触碰 sandbox/mode，`'never'` 审批策略仍在任何应答者被咨询之前拒绝。每次自动决策都会向所属会话 append 一个 log-only 的 `approval/rule` 事件，使 asked → rule → decided 审计保持完整、可重放，且不进入模型转录。

## 问题

审批缝只授予一次性决策：应答者对面前这一动作返回 `allowed-once`，或返回拒绝。没有一种方式能说"这个工具、这些参数，永远允许"（或永远拒绝）并让之后的每次请求都尊重它。本包用一个**持久化规则层**补上这一缺口：策略负责人在磁盘上写入 allow/deny 规则，缝自动咨询它们，把不匹配规则的请求留给人类/agent 应答者。

## 规则语法

规则是以三个字段组成的 YAML 列表。两层合并，**用户层在前**，匹配按序返回首条命中。

```yaml
# <resolveDshHome()>/permissions.yaml
- tool: echo
  pattern: '*'
  decision: allow
- tool: bash
  pattern: '*git push*'
  decision: deny
```

- `tool` — 本规则管辖的精确工具名（严格相等匹配）。
- `pattern` — 对工具调用的**规范化参数串**做全串锚定的 glob：即请求（经其 `callId`）所指向的 `tool/call` 事件的原样 `arguments` 值，其中空白串折叠为单个空格。多数工具从模型收到的是 JSON 编码的参数——一次 bash 风格调用规范化后形如 `{"command":"git push","timeout":5000}`——因此应以两侧 `*` 锚定稳定的内侧子串（`'*git push*'`）；裸的 `'git push*'` 永不匹配 JSON 编码的调用。`*` 跨任意字符；其余字面匹配（这是 glob，不是 regex）。锚定是隐式的，故 `git push` 永不匹配 `safe-git push`。无法解析出调用时按 `""` 匹配。
- `decision` — `allow`（结算为 `allowed-always`）或 `deny`（结算为 `rejected`）。

YAML 格式损坏、顶层非列表、`tool`/`pattern` 为空、或 `decision` 非 `allow`/`deny`，都会在加载期 fail loud 并报出文件路径。未知工具名**不在**加载期校验（工具面可能晚装配）；此类规则在该工具缺席时自然永不命中。

### 层路径

- 用户层：`config.userFile` 或 `<resolveDshHome()>/permissions.yaml`。
- 项目层：`config.projectFile` 或 `<cwd>/.dsh/permissions.yaml`。

文件缺席时该层为空。`add` / `remove` 以 `mkdir -p` 建目录、以 `0600` 权限写好项目（或用户）文件。

## 装配顺序契约

Cordis waterfall 没有优先级机制：`approval/request` 监听者按**注册顺序**执行，sibling order 不是策略优先级机制。因此规则应答者仅在**本包先装配**时先于交互应答者。请在本包目标组合里、任何交互审批应答者之前装配本包；若后装配，则交互应答者赢得决策，规则永远不会生效。测试用一个会急切放行的"晚到交互应答者桩"钉住了这一顺序。

## 命令

`/permissions` 列出或管理生效规则（区别于 `/permission` 预设切换器）。

- 裸 `/permissions` 按优先级列出生效规则，格式为 `索引  层  工具  pattern  decision`。
- `/permissions add <tool> <pattern> <allow|deny>` 追加到项目层文件（缺席则创建）。
- `/permissions remove <index>` 按**生效**索引删除对应层的条目。
- 当可选的 `tui.commands` 缝存在时，命令镜像进 TUI 斜杠菜单，并委托给宿主命令注册表执行。

## 同进程 facet

交互应答者经 `approvalRules.persistAllow` facet（`ctx.get('approvalRules.persistAllow')`）结算 TUI 审批卡的「永久允许」：`persistAllowRule(req)` 从一条挂起请求推导精确匹配的 allow 规则——请求的工具名 + 其规范化参数串作为全串 pattern——追加到项目层并返回带层标记的规则。无可解析调用参数的请求显式报错（无限制通配不应由一次按键授予）。落盘后调用方以 `allowed-always` 结算本次请求；后续相同请求由规则应答者直接结算、不再询问。

## 配置

```ts
export interface Config {
  userFile?: string   // default <resolveDshHome()>/permissions.yaml
  projectFile?: string  // default <cwd>/.dsh/permissions.yaml
}
```

## 模型体验

### 工具审批决策

#### 模型看到什么

模型只看到请求消费方的最终工具结果——放行或拒绝——而非产生它的规则。`approval/asked`、`approval/rule`、`approval/decided` 都是 log-only 会话事件，永不进入模型转录；持久化规则层对模型是不可见的运行时策略，而非模型可见上下文。

#### Token 影响

不新增 token。放行保留消费方寻常结果；拒绝用任何拒绝本就会产生的小段保留错误替换它。

#### KV Cache 影响

Append-only。log-only 审计事件不增加模型可见内容，故不会使可复用的请求前缀失效。

### 规则管理

#### 模型看到什么

模型对规则库或 `/permissions` 一无所知。规则管理是对文件的人面向命令，不会被叙述进模型看到的请求。

#### Token 影响

不新增 token。规则变更不作为上下文暴露。

#### KV Cache 影响

Append-only。规则编辑不改变任何模型可见内容。

## 已知局限与延后工作

- **无文件监听**——两层在插件启动时各加载一次，对 YAML 文件的外部编辑要重启后才可见。`/permissions add` / `remove` 会重读其触及的层文件：磁盘是权威存储，变更先提交到磁盘、再更新应答者读取的内存快照，且 `remove` 按新读的磁盘解析其列表索引。
- **未知工具名不在加载期校验**——命名一个尚未装配工具的规则会被接受；它在该工具出现前自然永不命中。加载期工具清单可捕捉笔误，但已延后。
- **规则作用于全部 agent，含 subagents**——本版没有 per-agent 规则作用域；一份合并列表管辖经该缝路由的所有请求。per-agent / per-session 规则集已延后。
- **`pattern` 是 glob 而非 regex**——只有 `*` 是通配符（跨任意字符）；不支持字符类、交替或分组。更完整的 glob 方言已延后。
- **规则事件不带 approval id**——`approval/rule` 按工具名与 turn 位置、而非 `approval/asked` 的 id 关联其 asked 兄弟；keyless 快照（id 配对的规则决策）已延后。
- **命令的 `pattern` 是单个 token**——`/permissions add` 取一个不含空白的 `<pattern>`；含空白的 pattern 需直接编辑 YAML 文件。
