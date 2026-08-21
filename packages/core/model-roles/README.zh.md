# @huiliyi37/dsh-model-roles

[English](README.md) | 中文

从用户设置文档解析的按角色模型 pin。`ModelRolesService` 提供 `ctx.modelRoles`，为三个消费模型的角色分别存储提供方／模型 pin，使部署可以让它们独立于默认 Agent 模型各自路由：

- `vision` —— 视觉桥生成的图片描述。
- `secondary` —— 廉价的后台任务，如会话标题与压缩摘要。
- `subagent` —— 委派的子代理会话的默认路由。

插件配置按约定为空：所有 pin 都存放在 Settings 的 `model-roles` 分节中，其用户层在每次调用 `resolve()` 时实时读取，因此提交的更改在下一次读取时即生效，无需重启。该服务不发出自己的变更事件；观察者使用既有的 `settings/updated` 事件。

- `ctx.modelRoles.resolve(role)` 返回该角色 pin 定的 `{ provider, model }`；角色未设置 pin 时返回 `undefined`。本包只存 pin——未设 pin 的角色遵循的回退链（例如部署默认模型）由各消费方自行约定。
- `ctx.modelRoles.pin(role, selection)` 经设置用户层持久化一个 pin；`ctx.modelRoles.unpin(role)` 移除它，使角色恢复遵循默认路由。未挂载设置提供方时两者都不执行任何操作，且每个角色都解析为 `undefined`。

```yaml
# settings.yaml
model-roles:
  vision:
    provider: acme-gateway
    model: acme-vision-large
  secondary:
    provider: acme-gateway
    model: acme-small
  subagent:
    provider: acme-gateway
    model: acme-large
```

该服务不校验目录成员关系。提供方路由可以服务未在目录中公布的模型；实际发起模型请求的消费方负责可用性诊断。

## 模型体验

通过各消费方为其角色解析的提供方／模型选择间接影响；模型可见请求由消费方负责。

#### KV Cache 影响

pin 只影响其生效之后解析的请求。请求日志已经指明选择的现有会话仍沿用该选择，因此本服务不会使其已建立的前缀失效。

## 已知限制与暂缓事项

- 本包只存 pin；角色只有在其消费方（视觉桥、副模型任务属主、子代理路由）解析后才生效，未设 pin 时的回退链由各消费方各自负责。
- 未挂载设置提供方时，`pin()` 与 `unpin()` 无法保留选择供后续读取使用。
