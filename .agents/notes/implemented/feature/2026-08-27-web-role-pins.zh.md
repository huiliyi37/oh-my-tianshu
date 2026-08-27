# Agent Note：Web 角色 pin 设置行——P2④ 最后尾巴收束

状态：implemented

[English](2026-08-27-web-role-pins.md) | 中文

范围：`packages/client/ui-model`（新 `role-pins.ts`、新 `RoleModelsRow.tsx` + css、`index.ts`、`locales.ts`、`package.json`）

## 问题

TUI 的 `/model vision|secondary|subagent` 角色选择器在 Web 没有对应物，尽管能力已可达：`model-roles` 挂在 base bundle，其 settings namespace 走既有的 `settings.describe`/`settings.update` 接缝。缺的是 UI 贡献——P2④ 阶段 3 收束时记为余留尾巴。

## 决策

`ui-model`（本就拥有模型面的包）里加一行 General 设置行（`settings.general.item` id `model-roles`），把尾巴收掉：

**控制器对准 namespace，不新开接缝。** `RolePinsController` 镜像 permission 设置控制器：`settings.describe` 找到 `model-roles` 视图，从 resolved value 解析三个 pin（`vision`/`secondary`/`subagent` 各 `{ provider, model }`），写走 `settings.mutate` 的 `set`/`unset` op 按角色 + `expectedRevision` 乐观并发。选择器的选项来自**全局**目录（`llm.models`）——root 作用域，与 composer 座位的会话目录不同——目录失败降级为空选择器而不影响 pins 读取。

**每角色一个 Menu。** 行头汇总三个 pin（目录显示名，缺省为跟随默认）；展开后每角色一个 Menu，列出跟随默认 + 全局目录（组标签 + 模型行）。选模型即 pin 路由；跟随默认清除。一次性保存态禁用选择器；namespace 缺失时隐藏整行（与 permission 行同款 unavailable 契约）。

**注册纪律。** ui-model 第三个 `ctx.inject(['slots', 'connection'])` 条目注册该行与 `settings/changed` + `connection/reset` 失效刷新（permission 行的生命周期）。`@huiliyi37/dsh-model-roles` 进 peerDependencies（`^0.3.0`，TUI 同区间）配 workspace devDependency；目录类型走 `dsh-client-connection/client`（既有再导出通道，零新依赖）。

## 备选方案

### 为什么不用会话作用域行 + 会话目录？

角色 pin 是设置——跨会话存活的全局偏好，slot 契约下 settings section 本就是 root 作用域。全局目录是正确的选项源；会话目录条目会把会话状态漏进偏好编辑器。

### 为什么扁平 Menu 而不是 provider→model 两步？

三个角色 × 两个下拉 = 六个控件服务于一个次级偏好；每角色单个 Menu（跟随默认 + 带标签的组）把行高与交互成本压到最小，组标签保留了步进式才有的 provider 上下文。

### 为什么放 ui-model 而不是新包或 ui-models？

ui-model 拥有模型选择面（composer 座位 + /model 弹层）且已依赖该行所需的一切（primitives、slots、connection）；ui-models 是 provider 目录编辑器。新包会为三行 UI 增加一个插件 + bundle 行。

## 后果

买入：Web 在 General 设置里编辑全部三个角色 pin，TUI 选择器与 Web 行收敛到同一 namespace（任一面设置的 pin 另一面可见）。

成本：多一个 settings 消费方（失效刷新 + 控制器生命周期是既有模式而非新机制）；pinned 路由不在全局目录时 summary 显示裸模型 id——诚实的回落，与 TUI 的路由显示一致。

## 验证

聚焦套件：`role-pins.spec.ts`（视图解析、目录降级、set/unset 形状与 revision、错误上浮、角色顺序），`role-models-row.spec.tsx`（行头汇总、展开、目录选择、跟随默认清除、unavailable 空态），加上既有 ui-model 套件（27 例）。组装设置的 e2e 泳道仍走 CI（浏览器 boot 在本地沙箱不可用）。
