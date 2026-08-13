# dsh-scope

[English](README.md) | 中文

带作用域的注册原语。`createScope(ctx, key)` 创建一个带标签的 Cordis 上下文，其底层 fiber 拥有通过该上下文进行的每项注册。`scopeOf(ctx)` 读取标签；`scopeTarget(base, key)` 将带作用域的事件路由到键相同的监听器，同时让无作用域监听器保持全局可见。agent loop（智能体循环）为每个实时 agent 创建一个作用域，但该机制与键的具体含义无关，因此底层包无需依赖 agent 即可使用。

## 公开 API

- `createScope(ctx: Context, key: ScopeKey): Scope`：在 `ctx` 的 fiber 下创建作用域。可以同步使用（effect 收集受 uid 门禁约束；服务解析会沿创建该作用域的插件依赖范围继续查找）。同进程、带类型的键受信任；处于非活动状态的创建上下文仍会通过 Cordis 失败（`INACTIVE_EFFECT`）。
- `Scope.ctx`：带标签的上下文。通过它进行的注册既具备作用域可见性，也服从作用域生命周期。派生上下文（一次 `extend`、挂载于其下的 fiber）继承标签；嵌套作用域会遮蔽外层标签（最近的标签生效）。
- `Scope.rawDispose`：底层 fiber 的原样 Cordis disposer。组合式（generator）effect 会 yield 此函数，从而把作用域 teardown 嵌套在该 yield 位置（Cordis 按函数标识去重嵌套 effect；yield 一个包装函数会使作用域 teardown 成为并行的同级操作）。
- `Scope.dispose(): Promise<void>`：通过作用域进行的每项注册所共用的幂等完全停稳边界。竞态调用或重复调用会等待同一次 teardown；即使 `rawDispose` 先调用了底层单次 Cordis disposer 也是如此。
- `scopeOf(ctx: Context): ScopeKey | undefined`：上下文或其任意派生上下文携带的标签；`undefined` 表示上下文全局。
- `scopeTarget(base: T, key: ScopeKey | undefined): Scoped<T>`：为按作用域筛选的事件构造不透明分发 `thisArg`。它把 `base` 现有的 `Context.filter` 与作用域谓词组合起来（无标签监听器 ⇒ 放行；有标签监听器 ⇒ 仅当标签 === key 时放行；`key === undefined` ⇒ 仅放行无标签监听器）。载体只包含路由状态；真实主体由事件参数携带。带 `{ global: true }` 的监听器绕过筛选（Cordis 语义）。
- `Scoped<T>`：编译期不透明载体 brand。按作用域筛选的事件要求它作为 `this` 类型，因此使用裸主体分发会产生编译错误。类型参数记录主体类型，但不公开其属性。
- `isScopeCarrier(value)`/`carrierKeyOf(value)`：运行时载体标记，开发不变式使用它们断言每次按作用域筛选的分发都携带载体，而且载体键与参数所指名的主体一致。
- `ScopeLayer`：一个注册表的完整全局贡献或精确作用域贡献的聚合约定；`isEmpty()` 控制带作用域层的回收。
- `ScopedLayers<L>`：拥有一个立即创建的全局层和按需创建的精确作用域层。`peek()` 从不创建；`merge()` 物化按插入顺序排列的具名遮蔽项；`effect()` 从同一上下文推导可见性与所有权，同时返回原样 Cordis disposer。
- `NamedEntries<V>`：按插入顺序排列的具名存储，调用方拥有重复项诊断、查找，以及一个非空表世代内的实时迭代。表清空后，现有迭代器与后续插入项脱离；`insert()` 返回幂等的精确条目撤销函数。
- `AnonymousEntries<V>`：按插入顺序排列的匿名存储；唯一内部键使相同值仍作为独立注册存在。它使用相同的清空世代迭代器边界；`append()` 返回幂等的精确条目撤销函数。

可选配套包 `@deepseek-ai/dsh-scope/invariant` 拥有该运行时断言。它使用生成的 `scoped-events.generated.ts` 解析器映射，要求每个已声明的带作用域事件都携带载体；当 payload 公开路由主体时，还要求路由主体与载体键严格相等。基于 Program 的生成器根据事件声明和真实的 `scopeTarget(base, key)` 调用生成该映射。

## 设计约定

注册上下文同时决定可见性和所有权，防止注册在一个作用域中可见、却随另一个作用域 dispose（资源释放）。作用域用于路由受信任的同进程插件；它们不是沙箱或权限边界。原理与明确排除的安全目标见 [agent 作用域 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals)。

感知作用域的服务会定义具体 `ScopeLayer`，聚合各自不同的表与领域辅助函数。`ScopedLayers.effect()` 接受一个返回同步撤销函数的同步动作，在可选通知前安装该撤销函数，并且只有在完整聚合为空时才回收精确作用域层。`notify` 默认为 `true`；由所提供的回调决定观测方失败是向外抛出还是在内部处理。`EntryValues` 保持内部可见；存储类从包根而非 `/store` 子路径导入；共享存储不定义注册表专属的筛选或迭代策略。详见[共享作用域层存储 Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)。

交出带作用域的上下文，也会交出创建该上下文的插件的服务解析范围（解析会沿创建者 fiber 的依赖链，而非持有者的依赖链行进），因此应由具备这些带作用域注册所需依赖的插件来创建它。

## 已知限制与暂缓事项

- **只有感知作用域的表层才会隔离状态**：注册表必须按 `scopeOf()` 归档，事件必须通过 `scopeTarget()` 分发；仅仅通过带作用域的上下文调用任意 Cordis 服务，并不会改变该服务仍为上下文全局这一事实。
- **一个上下文只携带一个最近的作用域键**：嵌套作用域会遮蔽父作用域的标签，而不会形成层级策略集或多成员策略集。
- **服务可达性来自作用域创建者**：交出 `Scope.ctx` 也会交出创建插件注入的服务表层，因此，若作用域创建者提供的服务范围较宽，持有者之后也无法将其收窄。
