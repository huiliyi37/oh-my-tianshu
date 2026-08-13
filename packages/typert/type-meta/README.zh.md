# @deepseek-ai/dsh-type-meta

[English](README.md) | 中文

该包提供不依赖编译器的声明，由业务包、生成的 TypeRT 产物、Host Gateway 和 Client API 共享。它负责 Remote Service 基类、装饰器、显式 binding 回退、可通过声明合并扩展的协议映射、调用描述符、编解码器和提供方约定；它不执行 TypeScript 分析，也不注册具体 Cordis 服务。

## Remote 声明

- `@Remote` 将公开实例方法标记为可在其注册的 Cordis 服务上直接调用。
- `@RemoteScope(key)` 标记接收者选自合并声明的作用域 Context 类型的方法。
- `GatewayService` 将 `super(ctx, serviceKey, options?)` 接收的 Cordis key 同时绑定为默认 wire namespace。
- `bindTypeRTGateway(this, serviceKey, options?)` 为无法继承 `GatewayService` 的 Service 提供同样可见且冻结的绑定。
- `remoteMethods(service)` 返回按声明顺序排列、与内部状态分离的快照，供 Gateway 的 SRC 回退路径使用。

Host 方法通过将 `signal: AbortSignal` 声明为最后一个参数来启用协作式取消。`InvocationDescriptor.cancellation` 记录这个保留的注入点；signal 绝不会成为 JSON 参数或 lookup 字段。SRC 识别末位参数名，严格生成还会校验它是否具有全局 `AbortSignal` 类型。

装饰器初始化器将标记保存在以服务 prototype 为键的模块私有 `WeakMap` 中。它们不会在构造函数上添加 symbol，也不会添加 prototype 属性、参数元数据或运行时反射字段。`GatewayService` 会暴露与显式 helper 相同的 public readonly `typertGateway` 绑定。

## TypeRT 协议

业务包扩展 `TypeRTLookupMap` 和 `TypeRTContextMap`，以关联 Host 对象或作用域 Context 与其协议身份。生成的产物扩展 `TypeRTRemoteMap`、`TypeRTRemoteScopeMap` 和 `TypeRTRemoteNamespaceMap`，使 Client 导入后仅暴露选定的 Remote 方法。`InvocationDescriptor` 是供注册表、Gateway 和 Client Remote 使用的共享运行时形式。

查找包与 Context 包同时负责其约定的两侧：声明合并提供静态关联，运行时提供方则向 `ctx.typert` 注册身份解析。lookup 或 Host Context provider 提供稳定声明与默认 resolver，Host 组合可以另行配置同步或异步 resolver；策略拒绝可用 `TypeRTLookupFailure` 携带由边界适配器拥有的失败值。严格编解码器携带生成的 schema；`src-json` 编解码器标识约束更弱的源码启动路径。

## 模型体验

无，因为该协议包声明应用反射，不注册任何模型接口。

#### KV Cache 影响

无直接影响。

## 已知限制与延期工作

- 装饰器标记仅包含方法名，以及直接调用或 Context 调用模式。参数、结果、查找和 schema 反射需要 TypeRT 构建流水线。
- Remote 装饰器只接受具有字符串名称的公开、非静态实例方法。SRC 执行无法表示重载签名，以及包含解构参数、默认参数或剩余参数的方法签名。
