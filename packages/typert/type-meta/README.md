# @deepseek-ai/dsh-type-meta

English | [中文](README.zh.md)

Compiler-independent declarations shared by business packages, generated TypeRT artifacts, the Host Gateway, and Client API. This package owns the Remote Service base, decorators, explicit binding fallback, merge-extensible protocol maps, invocation descriptors, codecs, and provider contracts; it does not run TypeScript analysis or register a concrete Cordis service.

## Remote declarations

- `@Remote` marks a public instance method for direct invocation on its registered Cordis Service.
- `@RemoteScope(key)` marks a method whose receiver is selected from a merge-declared scoped Context kind.
- `GatewayService` binds the Cordis key passed to `super(ctx, serviceKey, options?)` to the same default wire namespace.
- `bindTypeRTGateway(this, serviceKey, options?)` provides the same visible, frozen binding for a Service that cannot inherit from `GatewayService`.
- `remoteMethods(service)` returns a detached declaration-order snapshot used by the Gateway's SRC fallback.

A Host method opts into cooperative cancellation by declaring `signal: AbortSignal` as its final parameter. `InvocationDescriptor.cancellation` records that reserved injection point; the signal never becomes a JSON parameter or lookup field. SRC recognizes the final parameter name, while strict generation also verifies the global `AbortSignal` type.

Decorator initializers retain markers in a module-private `WeakMap` keyed by the Service prototype. They do not add constructor symbols, prototype properties, parameter metadata, or runtime reflection fields. A `GatewayService` exposes the same public readonly `typertGateway` binding that the explicit helper returns.

## TypeRT protocol

Business packages extend `TypeRTLookupMap` and `TypeRTContextMap` to associate Host objects or scoped Contexts with their wire identities. Generated artifacts extend `TypeRTRemoteMap`, `TypeRTRemoteScopeMap`, and `TypeRTRemoteNamespaceMap` so Client imports expose only selected Remote methods. `InvocationDescriptor` is the shared runtime form consumed by the registry, Gateway, and Client Remote.

Lookup and Context packages own both sides of their contract: declaration merging supplies the static association, while runtime providers register identity resolution with `ctx.typert`. A lookup or Host Context provider supplies the stable declaration and default resolver, while Host composition may separately configure a synchronous or asynchronous resolver; policy rejections may use `TypeRTLookupFailure` to carry a failure value owned by the boundary adapter. Strict codecs carry generated schemas; `src-json` codecs identify the weaker source-launch path.

## Model Experience

None, as this protocol package declares application reflection and registers no model surface.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- Decorator markers contain only the method name and direct or Context invocation mode. Parameter, result, lookup, and schema reflection require the TypeRT build pipeline.
- Remote decorators accept only public, non-static instance methods with string names. SRC execution cannot represent overloaded, destructured, defaulted, or rest-parameter signatures.
