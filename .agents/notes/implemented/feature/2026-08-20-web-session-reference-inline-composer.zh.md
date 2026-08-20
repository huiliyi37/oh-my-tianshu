# Agent Note: Web session references and the inline-reference composer

Status: implemented

[English](2026-08-20-web-session-reference-inline-composer.md) | 中文

## Problem

Web 编辑器本有斜杠/引用触发管线与 occurrence 表，但 `@` 来源只是无行为的 subagent 标签文本，且每颗引用只占一个 `U+FFFC` 占位符。占位符破坏显示保真（标签被截到 chip 宽度），重新挂载恢复出的是不可解析的字形，结构化会话引用也无法走完从 pick 到模型的链路。Web 需要在编辑器中获得结构化的跨会话快照，但不能在浏览器里扫描 Host 文件系统，也不能把会话身份绑定在显示标签上。

## Decision

一次会话 pick 是一颗结构化编辑器引用。其可见形态是保留在透明 textarea 中的完整 `@label` 显示文本——对话气泡字形加业务色会话标题，没有胶囊——其剪贴板与模型形态是 Host 产出的规范 `@[label](dsh-session:…)` mention。对齐的 backdrop 为该区间着色并把前导标记换成领域字形，因此宽度、折行、选区与光标位置都由原生文本度量决定。occurrence 区间（`offset` + `length`）保留引用身份用于序列化；在其边界的 Backspace/Delete 整颗删除，在区间内部编辑会把剩余字符转为普通文本。输入机器把普通草稿文本与原子引用一直保留到 default sink 报告 Host 接受：草稿只在成功结算后清除，序列化或传输失败会把同一草稿还回编辑（往返期间键入的文本优先）。其会话 store 镜像持久化每个 occurrence 的规范剪贴板投影，因此没有 occurrence 表的重新挂载保留的是可解析引用而非仅供显示的标签。每次 sink 调用都携带该 attempt 的 `AbortSignal`，shell 销毁即中止 Host 侧准备。

普通 `session.prompt` 传递不改写规范 mention；`ISession.prompt` 接受该 attempt 的 signal。session-reference 服务在外层 `agent/pre-step` 监听器中解析已被接受的直接 user 消息（下游监听器先决策；只处理 `enter` 决策），捕获每个来源，把规范 mention 替换为可读文本并保留直接消息的 id，再把冻结快照紧跟在该消息之后插入。队列编辑与队列转 steer 的重定位无需引用专属处理，因为解析发生在最终 inbox 领取之后。无效 mention、源读取失败、取消或预算失败会在该轮消息进入模型可见历史之前结束这一轮。

聊天侧按持久的「直接消息在前、召回行在后」顺序渲染，并且只从紧随其后、带来源的召回中关联精确会话标签——既保留多词标题，又让连续引用互相独立（Chat 快照构建器中的 `ReferenceLabelProjector`；user/steering Chat 节点数据上的 `referenceLabels`）。召回上下文行使用同一对话气泡字形，其他上下文沿用文档字形，user 气泡下方显示一行紧凑的「引用会话 · …」摘要。`MessageItem` 把可识别的 mention 装饰为图标加文本的引用，把不带引号的 `@path` token（含无扩展名基名）视为文件，把句读标点留在引用区间之外，并把快照 JSON 收在折叠的召回行之后。斜杠菜单支持 `showGroupTitle: false`（在 pending 与 ready 状态下都隐藏原始组标题）与候选 `section` 行；pick 还可以返回 `{text, continue: true}`，让目录形态的拼接保持补全打开并在光标处重新跟踪。

## Reference transaction

```text
pick session reference → atomic occurrence over inline display text
     → serialize draft → ordinary session.prompt enqueue
     → agent/pre-step parses mentions → capture sources → readable prompt + context
```

会话准备对一次被接受的模型步骤是全有或全无的。已入队消息在被领取时捕获各来源，因此队列编辑与队列转 steer 的重定位走同一条路径，不需要网关协调。

## Alternatives considered

**单字符 `U+FFFC` 占位符加 backdrop chip。** 否决：占位符无法在不截断的情况下显示多词标签，重新挂载后恢复为不可解析的字形，并与原生选区和折行相冲突。行内显示文本保留全部原生文本行为；occurrence 表单独承载身份。

**用纯 `@label` 文本表示会话。** 否决：标签既不稳定也不唯一，无法标识源快照。Host 产出的规范 mention 在保持可读显示的同时保留不透明会话身份。

**在 prompt 准入结算前清空编辑器。** 否决：传输或准入失败会丢失请求的唯一可编辑副本，并在视觉上声称了从未发生的接受。

**经通用 `SendOptions`/delivery 附带上下文。** 否决：通用 delivery 将拥有一条贯穿准入、steering、取消与观察的领域事务；领域专属的 `agent/pre-step` 监听器与现有 next-step inbox 在不扩大每个直接 prompt 的前提下保住所需配对。

**为浏览器消费者提供 Host 侧 Remote 发现面。** 暂缓：rc8 的 Remote 方法与 `ui-reference`/file-reference 包未在本仓组合，因此尚不存在浏览器候选来源；编辑器的 `quoted` 命中标志与菜单的 section 行已为其就位。把它记为剩余缺口，而不是走 API Proxy 的路径——引用流程不新增任何 proxy 路由、依赖或错误码。

## Verification

包级测试锁定了 occurrence 平移/删除/内部编辑语义、边界 Backspace/Delete、部分选区 copy/cut 扩展、事务化清稿与失败保留（含交错编辑情形）、跨重挂载的规范草稿持久化、codec 失败阻断发送、销毁中止 sink signal、pending 与 ready 状态下的源标题隐藏、不改变选项序号的 section 行、continue 文本 outcome、相邻会话标签投影（多词、连续）、无扩展名文件与句读标点渲染、pre-step 准备顺序（直接消息在前、其上下文在后）、下游拒绝直通，以及无效 mention 的轮次终止。窄视口计划 chip 的 e2e（`apps/web/tests/plan-control-row.e2e.ts`）及其金样已移植但尚未在本地执行（无内置 Chromium）。

## Consequences

Web 编辑器引用成为带持久身份的保真行内文本，会话召回作为结构化快照与引用它的消息成对到达。Host 服务仍是会话访问的权威。引用准备失败发生在 prompt 接受之后并结束该 agent 轮次。会话引用保留 `dsh-session-reference` 拥有的有界快照成本与信任定界。文件发现（`@file`）在本仓尚无生产方：触发管线的 `quoted` 标志、section 行与文件夹字形已就绪，但还没有来源注册它们。
