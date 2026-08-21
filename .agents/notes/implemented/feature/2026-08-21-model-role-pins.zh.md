# Agent Note: Per-role model pins (vision / secondary / subagent)

Status: implemented

[English](2026-08-21-model-role-pins.md) | 中文

## Problem

三个消费模型的角色需要独立于默认 Agent 模型的路由：视觉桥的图片描述、廉价的副模型后台任务（会话标题、压缩摘要），以及委派的子代理会话的默认路由。没有共享属主时，每个消费方都会各自长出一套设置命名空间、写入路径和"无提供方即空操作"处理，用户也无法在同一个设置分节里看到并编辑这三组 pin。

## Decision

`packages/core/model-roles`（`@huiliyi37/dsh-model-roles`）拥有 `model-roles` 设置命名空间与 `ctx.modelRoles` 服务。分节 schema 为每个角色存放一个可选 pin——`vision`、`secondary`、`subagent`——均为 `{ provider, model }`，角色一旦出现两个字段都必填（schemastery 的 `union(object, never)` 可选对象惯用法）。`resolve(role)` 在消费方使用点实时读取设置作用域，提交的设置更改在下一次读取即生效，无需重启；`pin(role, selection)` 与 `unpin(role)` 经 `settings.mutate` 路径操作写入，未挂载设置提供方时不执行任何操作。

组合配置项按约定为空（`Config = Record<string, never>`，未知键在加载时拒绝）：所有 pin 都在设置用户层，绝不在 `cordis.yml`。服务不发出自己的变更事件——消费方在使用点解析，观察者订阅既有的 `settings/updated`。本包只存 pin；每个消费方自行负责未设 pin 时的回退链（例如跟随部署默认模型）。

不变量伴侣监听 `model-roles` 命名空间的 `settings/updated`，当 `resolve()` 未反映已提交分节时判定违规——该检查固定了服务构造器中的实时来源接线，防止退化为装配时快照；设置 seam 自身的提交不变量看不到这种回归。

## Alternatives considered

- **每个消费方一个设置命名空间**——三个平行分节会让写入／空操作机械结构翻三倍，并把同一个用户决定散落在文档各处；单一命名空间把词汇集中在一处。
- **在 `dsh-agent-default-model` 上扩展角色键**——该服务拥有 Agent 入口默认值，其组合配置项*必须*提供 provider/model；角色 pin 是严格可选的叠加层，没有组合配置值，生命周期不同。
- **包自有变更事件**——没有消费方需要：所有读取都在使用点经 `resolve()` 完成，seam 的 `settings/updated` 已经承载观察路径。
- **pin 放进插件配置（`cordis.yml`）**——pin 是用户层选择，必须可在运行时写入；部署组合配置项无法承担，还会遮蔽设置文档。

## Consequences

消费方（视觉桥、副模型任务属主、子代理路由）各自接入该 seam；在某个消费方解析其角色之前，对应 pin 不生效。未挂载设置提供方的部署无法保留 pin。服务不校验提供方／目录成员关系——实际发起模型请求的消费方负责可用性诊断，与 `dsh-agent-default-model` 一致。

## Testing

包级测试覆盖 schema 边界（空分节合法、不完整角色拒绝）、pin/unpin 可见性、提供方外部重发布、提供方卸载回退，以及无提供方空操作路径；不变量测试证明伴侣会拒绝服务无法解析的 `settings/updated` 发射，以及没有存活服务时的发射。
