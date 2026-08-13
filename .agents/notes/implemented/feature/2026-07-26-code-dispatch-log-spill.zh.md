# Agent Note: 将 Code Mode 子分发结果的持久化副本纳入 spill 机制

Status: implemented

[English](2026-07-26-code-dispatch-log-spill.md) | 中文

> 范围：Code Mode UI 堆叠 PR（Pull Request）链的第四个 PR，即用既有的 spill 机制为 `tool/code-dispatch` 事件的内容施加边界。[宿主侧基础 Agent Note](2026-07-26-code-dispatch-ui-foundation.md)当初有意接受了不设上限的日志，并指明本 PR 就是兑现点；[实时并行 Agent Note](2026-07-26-code-mode-live-parallel-dispatch.md)敲定了本次整形所挂接的事件对。

## 问题

自携带完整内容的分发日志落地以来，读取大文件的 `run_code` 程序过去会把完整的渲染文本写进会话日志，不设上限、位于 spill 策略之外；而原生结果在记录之前就已被限制在 `maxInlineBytes` 以内。这种不对称的方向完全反了：子调用（本就为批量数据工作而设计）恰恰是最可能携带巨大结果的调用，而每个这样的轮次都会让 JSONL 增长数 MB。

## 决策

**在注册表上增设一个日志整形 waterfall（瀑布式事件），spill 策略作为其第一个监听器。**

- **扩展点**：`tools/code-dispatch-log`，一个按作用域过滤的 waterfall，由桥接层在追加 `tool/code-dispatch` 之前对每个已结算的子分发运行（经由注册表的私有 `shapeDispatchLog` 调用器——作为能力闭包经 `RunCodeBridgeOptions` 交给桥接层；waterfall 才是公开约定，调用器绝不扩大服务接口。故障被兜住：监听器抛出异常时回退到未整形的内容，并用可处理任意抛出值的错误格式化，确保恶意抛出值无法逃出兜底）。载荷（`CodeDispatchLog`）携带外层执行、提升出来的 `agent` 路由键、子调用标识与默认内容——即原生 `tool/result` 所载的渲染后结果投影（程序本身收到的是结构化 `value`）。可整形的只有持久副本；模型两者都看不到。整形作为被跟踪的旁路工作在程序路径之外运行，但有界：待处理日志任务超过 `maxParallelSubCalls` 时有序提交通道会暂停，因此慢速 spill 后端会对整个 run 施加背压，而不是无限累积待完成 I/O；run 结算仍会在开放轮次内排空全部任务。
- **策略**：`dsh-spill-policy` 在新扩展点上注册第二个分支，与其面向模型的分支共用一模一样的替换流水线（同样的 `maxInlineBytes` 上限、同样的预览 + 定位符 + 不超上限不变式、同样的尽力而为回退），产物以 `dispatch` 为标签，记在子调用 id 名下。UI 与回放通过 spill 产物读取全文，方式与读取被 spill 的原生结果完全相同，因此与原生同等保真的渲染在施加边界之后依然成立。
- **一处有意的不对称**：面向模型的分支跳过 `read`（避免 `read → spill → read again` 循环）；分发日志分支则连 `read` 子调用也施加边界：日志副本不是模型上下文，该循环因此不可能发生，而 `read` 恰恰是会产生巨大日志的那个工具。

## 曾考虑的替代方案

**在桥接层内部用普通上限施加边界（不做 spill）。** 否决：没有定位符的截断会丢失回放与 UI 可能需要的数据，还会重新引入本堆叠 PR 链已经移除的「截断摘要」降级渲染路径。

**直接在桥接层内做 spill（从 code-mode.ts 调用 `ctx.spillStore`）。** 否决：注册表会因此对 spill 能力产生硬依赖；waterfall 则把策略留在所有其他 spill 决策所在的地方，既可组合也可禁用（省略 `maxInlineBytes` 依然意味着真正的 no-op）。

**让嵌套调用复用 `tools/post-execute`，而不是新增一个事件。** 否决：post-execute 整形的是面向程序的那份结果（嵌套调用有意跳过它，好让程序拿到完整数据）；持久副本需要一个属于自己的决策点，位于程序取得其值之后。

## 后果

对 Code Mode 轮次而言，会话日志重新有了边界：README 中关于分发日志不设上限的 「已知限制」条目已经解决，现在指向本篇。携带超大分发内容的旧日志仍可回放（事件形状未变；只有今后的追加才会变小）。Web UI 经由与原生完全相同的路径，把被 spill 的子调用输出渲染为预览 + 定位符文本，没有任何特殊处理。
