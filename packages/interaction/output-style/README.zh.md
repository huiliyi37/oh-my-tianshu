# @huiliyi37/dsh-output-style

[English](README.md) | 中文

面向组装后系统提示的可切换输出风格预设。本包挂载一个有序 `system-prompt` section——`output-style`，order `10`，位于部署 persona（`0`）与工具指引带（`100`–`199`）之间——承载三个逐字预设：`default`、`explanatory`、`learning`。当前风格保存在 `output-style` settings 命名空间；`/style` 命令负责查看与提交。挂载是可选的（opt-in），出厂默认组合不包含本包。

## Public API

- `apply(ctx, config)` — 函数插件（`name: 'output-style'`，注入 `systemPrompt` 与 `commands`）。只注册一次 section，经 `installSettingsSection` 接线 settings 命名空间，在 `ctx.commands` 注册 `/style`，并在组合了 `tui.commands` 时镜像进 TUI 斜杠菜单。
- `Config.defaultStyle` — 在任何 settings 提交之前生效的风格；未装配 settings provider 时的永久回退（缺省 `'default'`）。
- `OUTPUT_STYLES` / `OUTPUT_STYLE_TEXTS` — 封闭词汇表及其逐字正文；`OUTPUT_STYLE_SETTINGS_NAMESPACE` / `OUTPUT_STYLE_SETTINGS_SCHEMA` — `output-style` 命名空间契约。

### Live events

无。`/style` 切换只经由 settings seam 自身的提交路径写入；不新增任何会话事件。包不变量伴生入口（`@huiliyi37/dsh-output-style/invariant`）断言每次组装至多一个 `output-style` section——在伴生自身监听器下游的组装终值上、以及伴生装载时的全链上各断言一次。

## Switching semantics

Section 只注册一次，其 `text` 闭包在每次组装时读取实时解析的命名空间（与模型角色 pin 同款的实时读模式）——一次提交从下一次组装起生效，没有 dispose/重注册空档。`/style <style>` 对封闭词汇表校验，未知风格或缺少 settings provider 时 fails loud；裸 `/style` 报告当前值。未装配 settings provider 时永久渲染组合的 `Config.defaultStyle`。

## 模型体验

### 风格预设 section

#### 模型看到什么

多出一个有序 system-prompt section，其正文是当前预设的逐字文本。无论 zen 阶段的工具面如何，该 section 都会渲染——风格与工具暴露正交；不希望如此部署可以直接不挂载本包。三段正文是固定的产品文案，由测试逐字节钉住（`OUTPUT_STYLE_TEXTS`）；`default` 正文如下：

##### Default 预设正文

```markdown
Answer directly and concisely. Lead with the result or decision, then only the supporting detail needed to act on it. Skip preamble, restatement of the question, and unsolicited alternatives unless a real trade-off changes the answer.
```

#### Token 影响

挂载期间每个请求固定一段预设正文（约 50–70 token），与工具数量和 persona 长度无关。

#### KV Cache 影响

当前风格不变时前缀稳定。一次 `/style` 提交恰好改变一次渲染的 section 正文，使下一个请求从第一个变化的系统提示 token 起失效前缀复用；其后请求在新正文上恢复前缀稳定。

## 已知局限与延后工作

- 风格是部署全局的：subagent 与 router 渲染与父会话相同的预设。按 agent 的覆盖被推迟——尚无消费者要求 per-agent 风格通道，而加入它需要为遮蔽规则指定归属方。
- `/style` 之外无文件/CLI 编辑面：命名空间也可以经任何 settings 写入方（如 `/config`）编辑，但本包不附带专门 UI。
