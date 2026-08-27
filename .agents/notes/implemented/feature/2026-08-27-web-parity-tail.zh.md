# Agent Note：Web 追平收尾——损坏会话标注与 spark 别名（P2④ 阶段 3）

状态：implemented

[English](2026-08-27-web-parity-tail.md) | 中文

范围：`packages/host/apiproxy`（`api/sessions.ts`、`api/sessions.schema.ts`、`api-proxy.ts`），`packages/client/runtime`（`sessions/service.ts`、`sessions/lineage.ts`、`sessions/manager.ts`），`packages/client/ui-workspace`（`tree.ts`、`rows/Rows.tsx` + css、`locales.ts`），`packages/client/ui-model`（`index.ts`、`locales.ts`），以及 fixture/测试替身

## 问题

审批与 rewind 两阶段之后还剩两条 P2④ 边缘。其一：TUI 的 `/session list` 把损坏持久化工件标注为 `不可恢复`（header `version < 0`，持久化层的损坏占位）；Web 会话列表不带 version，损坏行看起来像普通会话、只在打开时失败。其二：TUI 的 `/model` 提供 `spark-flash`/`spark-pro` 一键别名；Web 模型弹层只列目录行，捷径无对应物。

## 决策

**损坏标注乘现有列表 wire 端到端走通。** `SessionSummary` 增 `version`（header 透传；runtime 的客户端 summary 与 `SessionListEntry` 原样贯穿）。`ui-workspace` 在浏览与搜索两条节点路径都派生 `SessionNode.corrupt = version < 0`，渲染暗色 `不可恢复` / `Unrecoverable` 徽标 + 标题变暗。全链路零过滤：损坏行保持可见并标注——TUI 的可见性契约，绝不静默跳过。wire 增列由编译器在每个 summary 构造点（fixture、测试替身、合成 subagent 行）强制执行——这正是闭集 summary 形状的意义。

**别名是固定路由上的弹层行，不是目录条目。** `optionsOf`（`/model` 命令弹层的选项构造器）前置两行别名——`alias/spark-flash`、`alias/spark-pro`——由 `selectionOf` 解析为固定的 `deepseek-spark` 路由，镜像 TUI 的 `SPARK_ALIASES` 表。别名刻意不带 `reasoningEffort`（无目录推理元数据），且排在目录之前，目录加载慢或失败时仍可用；host 在选择时照常校验路由。

## 备选方案

### 为什么贯穿 `version` 而不是加一个专门的 `corrupt` wire 位？

version 是源事实（TUI 从同一 header 字段派生损坏）；加派生位会制造第二个可能漂移的事实源。`version < 0` 是本仓库的损坏契约，客户端 fold 只保留一处派生。

### 为什么别名只在弹层、不进 composer 座位？

TUI 的别名在 `/model` 命令面；Web 的命令面是弹层，composer 座位渲染完整目录。别名只进弹层保持该映射，避免把捷径复制进座位的分组列表。

### 为什么本阶段不做角色 pin 的 settings section？

角色 pin 在 Web 已可达：`model-roles` 挂在 base bundle，其 settings namespace 走既有的 `settings.describe`/`settings.update` 接缝，通用 settings 客户端今天就能读写 pin。缺的是一个**专门的** section 贡献（三行 provider/model 选择器）——新 UI 面，不是能力缺口。记为余留尾巴；TUI 的 `/model vision|secondary|subagent` 选择器仍是其捷径。

## 后果

买入：损坏的 Web 会话可见标注而非打开时失败；spark 一键路由两面都有。

成本：wire summary 再次扩宽（闭集 summary 形状的每个消费方都要付编译器税）；`optionsOf` 现在恒列两行别名，即便 host 无 spark 路由——刻意的追平选择（host 在选择时拒绝无效路由，与 TUI 一致）。

## 验证

聚焦套件：`ui-workspace` tree/rows/browser（新损坏派生用例、徽标与暗标题断言、更新的搜索结果 golden），`ui-model` browser-plugin（别名行、active 标记、别名选择解析为固定路由），加上 runtime/connection/apiproxy 套件的 summary 形状传播。
