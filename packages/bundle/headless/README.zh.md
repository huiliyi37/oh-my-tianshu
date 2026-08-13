# `@deepseek-ai/dsh-headless`

[English](README.md) | 中文

dsh 一次性任务组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上：提供编码 persona 和工具模式、禁用 HMR（热模块替换）、将 Code Mode 的 worker 作为核心执行能力挂载，并插入本包的 `headless-runner` 插件（配置为 `{task}`）。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

Loader 结算后，runner 读取共享的 [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md)，通过 `ctx.agents` 创建一个全新的持久化 Agent（智能体），将任务作为普通用户消息提交，并等待完全停稳。它对 Session 执行 flush 后再汇总自身持有的持久化事件区间，将最后一条非空 assistant 文本写入 stdout，再经启动器提供的 `ctx.headlessIo` 宿主钩子请求退出（最终 `turn/end` 完成 → 0，否则为 1）。最终 reason 为 `error` 时，还会将持久化的 code 与 message 写入 stderr；成功运行时 stderr 保持为空。进程不会打开监听端口。启动器把任务文本 patch 进来（`dsh run "task"`）；若所选 profile 缺少该行，则显式报错。

## 模型体验

无影响，因为 runner 把任务作为普通用户消息提交；提示词与工具归 base 和 headless 组合包中的相应行所有。

#### KV Cache 影响

无；runner 不向请求前缀添加任何内容。

## 已知限制与延期工作

- **只提交一个任务**：runner 没有用于交互式后续输入的 surface；它会等待 Agent 在返回 idle 前完成的所有工作，并打印该区间内最后一条非空 assistant 消息。
- **`ctx.headlessIo` 由启动器持有**：在 `dsh` 启动器之外启动 headless profile 会在激活时明确报错，直到宿主提供该钩子。
