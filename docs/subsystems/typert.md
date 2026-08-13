# TypeRT remote calls

English | [中文](typert.zh.md)

Types shared by generated Remote artifacts, the Host Gateway, and consumer API assemblies. The [TypeRT Gateway Agent Note](../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) owns the architecture and transport decisions; this page records the literal public contracts from [`dsh-type-meta`](../../packages/typert/type-meta/src/types.ts) and [`dsh-api-gateway`](../../packages/api/gateway/src/types.ts).

## Lookup and Context declarations

Business-object packages extend two empty maps through declaration merging. A lookup associates one Host object type with its wire identity; a Context declaration associates one scoped Context kind with its wire identity. Generated descriptors name these keys, while runtime providers supply the live resolution behavior.

```ts type-equiv
/** Merge-extensible Host object lookup declarations. */
interface TypeRTLookupMap {}
```

```ts type-equiv
/** Merge-extensible scoped Context declarations. */
interface TypeRTContextMap {}
```

The registry retains a lookup's wire declaration after its resolver unloads. SRC discovery therefore continues to classify the parameter as a lookup and fails unavailable instead of accepting the wire value as an ordinary business object.

```ts type-equiv
/** Stable wire declaration retained after a lookup provider unloads. */
interface TypeRTLookupDefinition {
  /** Merge-declared lookup key. */
  readonly key: string
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string
}
```

## Invocation descriptors

An `InvocationDescriptor` is local reflection, not a wire message. Host and consumer builds generate corresponding descriptors; the request sends only the endpoint and named `args`. Strict codecs carry generated schemas, while SRC codecs enforce JSON-safe values without structural type recovery. Cancellation is an out-of-band carrier signal injected after business parameters and never enters `args`.

```ts type-equiv
/** Codec attached to one invocation parameter or result. */
type TypeRTCodec =
  | {
    readonly mode: 'strict'
    readonly typeSymbol: string
    readonly schema: TypeRTSchema
  }
  | {
    readonly mode: 'src-json'
  }
```

```ts type-equiv
/** One ordered business parameter in a Remote invocation. */
interface InvocationParameterDescriptor {
  /** Source-level parameter name. */
  readonly name: string
  /** Required key in the wire `args` object. */
  readonly wire: string
  /** Whether the value is JSON or requires a registered Host lookup. */
  readonly source: 'json' | 'lookup'
  /** Lookup key when `source` is `lookup`. */
  readonly lookup?: string
  /** Boundary codec for the wire representation. */
  readonly codec: TypeRTCodec
}
```

```ts type-equiv
/** Carrier-independent description of one exported method invocation. */
interface InvocationDescriptor {
  /** Globally stable generated identity. */
  readonly id: string
  /** Cordis service key owning the method. */
  readonly service: string
  /** Wire namespace, defaulting to the service key. */
  readonly namespace: string
  /** Public instance method name. */
  readonly method: string
  /** Service member invoked when the exported method name is an alias. */
  readonly implementation?: string
  /** Receiver selection mode. */
  readonly invocation:
    | { readonly kind: 'direct' }
    | {
      readonly kind: 'context'
      readonly context: string
      readonly wire: string
      readonly codec: TypeRTCodec
    }
  /** Optional consuming-Context projection for one direct lookup parameter. */
  readonly scope?: {
    /** Context kind whose Client binder supplies the identity. */
    readonly context: string
    /** Lookup parameter wire field replaced by the Context identity. */
    readonly wire: string
  }
  /** Ordered business parameters. */
  readonly parameters: readonly InvocationParameterDescriptor[]
  /** Transport cancellation injected after business parameters instead of entering wire args. */
  readonly cancellation?: {
    /** Reserved final Host method parameter. */
    readonly parameter: 'signal'
  }
  /** Codec for the resolved method result. */
  readonly result: TypeRTCodec
  /** Source declaration used only for diagnostics. */
  readonly sourceLocation?: InvocationSourceLocation
}
```

## TypeRT registry

`ctx.typert` separates current-environment descriptors, explicitly selected Remote contributions, lookup providers, and scoped Context providers. A lookup provider owns the stable wire declaration and default resolver; Host composition can configure an effect-scoped synchronous or asynchronous resolver for the same key, and unloading that configuration restores the default policy. Registrations are Cordis-owned effects and return awaitable disposers.

```ts type-equiv
/** Minimal TypeRT runtime consumed through dependency inversion. */
interface TypeRTService {
  readonly local: TypeRTLocalRegistry
  readonly remotes: TypeRTRemoteRegistry
  readonly lookups: TypeRTLookupRegistry
  readonly contexts: TypeRTContextRegistry
}
```

Generated consumer declarations merge direct namespaces into the map inherited by `TypeRTClientRemote`.

```ts type-equiv
/** Merge-extensible direct namespace surface generated for Client Remote services. */
interface TypeRTRemoteNamespaceMap {}
```

## Host Gateway

Connection decodes its carrier envelope before calling `ctx.typertGateway`. The request carries exact named wire fields and the carrier's cancellation signal separately; infrastructure and boundary failures use the Gateway's in-process error taxonomy, ordinary exceptions are folded by the RPC adapter into the transport's `internal` error code, and existing RPC errors carried by lookup policy through `TypeRTLookupFailure` are returned unchanged.

```ts type-equiv
/** One Remote method request after a carrier has decoded its envelope. */
interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  readonly namespace: string
  /** Exported Service method name. */
  readonly method: string
  /** Named wire values; fields must exactly match the descriptor. */
  readonly args: Readonly<Record<string, unknown>>
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  readonly signal?: AbortSignal
}
```

```ts type-equiv
/** Stable infrastructure and boundary failures emitted before or after business execution. */
type TypertGatewayErrorCode =
  | 'ambiguous-endpoint'
  | 'arguments-invalid'
  | 'binding-invalid'
  | 'context-failed'
  | 'context-not-found'
  | 'context-unavailable'
  | 'definition-unavailable'
  | 'input-invalid'
  | 'invocation-unavailable'
  | 'lookup-failed'
  | 'lookup-not-found'
  | 'lookup-unavailable'
  | 'method-unavailable'
  | 'provider-mismatch'
  | 'result-invalid'
  | 'service-unavailable'
  | 'signature-invalid'
```

```ts type-equiv
/** Host dispatcher consumed by Connection adapters. */
interface TypertGateway {
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the validated business result.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  invoke(request: InvokeRemoteRequest): Promise<unknown>
}
```

## Consumer Remote

`ctx.remote` exposes only namespaces contributed by imported `/remote` artifacts. `$mount()` installs generated descriptors and concrete methods as one fiber-owned operation. Each namespace is a traced `remote.<namespace>` Cordis child Service whose lifetime spans its mounted methods; no JavaScript Proxy or Host business Service type enters the consumer.

```ts type-equiv
/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
interface TypeRTClientRemote extends TypeRTRemoteNamespaceMap {
  /**
   * Mount one generated Host-for-Client contribution in the caller's fiber.
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  $mount(contribution: TypeRTRemoteContribution): Promise<TypeRTDisposer>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis surface

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` surface lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtypert--typertregistry"></a>

### `ctx.typert` — `TypertRegistry`

Registry of generated schemas, package reflection, invocations, and Remote dependency providers.

```ts cordis-catalog
/**
 * Register one generated contribution atomically for the calling fiber.
 * Duplicate package-face identities, schemas, invocation ids, or endpoints
 * reject the whole batch.
 * @param contribution - generated schemas, reflection, and Host invocations.
 * @returns the exact effect disposer that removes this contribution.
 */
register(contribution: TypertContribution): TypeRTDisposer

/**
 * Look up one schema by `<package>#<name>`.
 * @param key - global schema key.
 * @returns the live schema record, or `undefined` when absent.
 */
get(key: string): TypertSchemaRecord | undefined

/**
 * Resolve one required schema.
 * @param key - global schema key.
 * @returns the live schema record.
 * @throws when the key is malformed, the package face is absent, or the schema is not contributed.
 */
resolve(key: string): TypertSchemaRecord

/**
 * Enumerate live schemas in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching schema records.
 */
list(filter: TypertSchemaFilter = {}): TypertSchemaRecord[]

/**
 * Look up generated reflection for one package face.
 * @param packageName - exact npm package name.
 * @param face - face to query; defaults to the host runtime.
 * @returns the live package record, or `undefined` when absent.
 */
getPackage(packageName: string, face: TypertFace = 'host'): TypertPackageRecord | undefined

/**
 * Enumerate generated package reflection in registration order.
 * @param filter - optional package and face restriction.
 * @returns matching package records.
 */
listPackages(filter: TypertPackageFilter = {}): TypertPackageRecord[]

/**
 * Project a live Zod schema to JSON Schema without caching the result.
 * @param key - global schema key.
 * @param params - Zod projection parameters.
 * @returns a fresh JSON Schema document.
 */
toJSONSchema(key: string, params?: z.core.ToJSONSchemaParams): z.core.JSONSchema.BaseSchema
```

Types: [TypertContribution](invariants.md) · [TypertFace](invariants.md) · [TypertPackageFilter](invariants.md) · [TypertPackageRecord](invariants.md) · [TypertSchemaFilter](invariants.md) · [TypertSchemaRecord](invariants.md)

Source: [`packages/typert/registry/src/service.ts:446`](../../packages/typert/registry/src/service.ts)

<a id="ctxtypertgateway--typertgatewayservice"></a>

### `ctx.typertGateway` — `TypertGatewayService`

Resolve strict generated definitions or conservative SRC markers against current Cordis Services and TypeRT providers.

```ts cordis-catalog
/**
 * Invoke one live Remote method through strict generated reflection or SRC markers.
 * @param request - decoded endpoint and exact named wire arguments.
 * @returns the validated business result.
 * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
 */
async invoke(request: InvokeRemoteRequest): Promise<unknown>
```

Source: [`packages/api/gateway/src/index.ts:78`](../../packages/api/gateway/src/index.ts)
<!-- END GENERATED cordis-surface -->
