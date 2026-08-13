/**
 * Compiler-independent TypeRT protocol shared by business packages, generated
 * Remote artifacts, the Host Gateway, and Client API implementations.
 * @module @deepseek-ai/dsh-type-meta/types
 */

import type { Context } from 'cordis'

declare const LOOKUP_HOST: unique symbol
declare const LOOKUP_WIRE: unique symbol
declare const CONTEXT_WIRE: unique symbol

/** Type-level association between a Host object and its wire identity. */
export interface TypeRTLookup<Host, Wire> {
  readonly [LOOKUP_HOST]: Host
  readonly [LOOKUP_WIRE]: Wire
}

/** Extract the Host object associated with one lookup declaration. */
export type TypeRTLookupHost<Lookup> = Lookup extends TypeRTLookup<infer Host, infer _Wire> ? Host : never

/** Extract the wire identity associated with one lookup declaration. */
export type TypeRTLookupWire<Lookup> = Lookup extends TypeRTLookup<infer _Host, infer Wire> ? Wire : never

/** Type-level association between a scoped Context kind and its wire identity. */
export interface TypeRTContext<Wire> {
  readonly [CONTEXT_WIRE]: Wire
}

/** Extract the wire identity associated with one scoped Context declaration. */
export type TypeRTContextWire<ContextType> = ContextType extends TypeRTContext<infer Wire> ? Wire : never

/** Merge-extensible Host object lookup declarations. */
export interface TypeRTLookupMap {}

/** Merge-extensible scoped Context declarations. */
export interface TypeRTContextMap {}

/** Merge-extensible direct Remote method signatures generated for consumers. */
export interface TypeRTRemoteMap {}

/** Merge-extensible scoped Remote method signatures generated for consumers. */
export interface TypeRTRemoteScopeMap {}

/**
 * Resolve one direct Remote namespace from the generated flat endpoint map.
 * @template Namespace - wire namespace before the endpoint slash.
 */
export type TypeRTRemoteNamespace<Namespace extends string> = {
  [Endpoint in keyof TypeRTRemoteMap as Endpoint extends `${Namespace}/${infer Method}`
    ? Method
    : never]: TypeRTRemoteMap[Endpoint]
}

/**
 * Resolve one scoped Remote namespace across every generated Context kind.
 * The calling Cordis Context supplies the concrete identity at runtime.
 * @template Namespace - wire namespace between the Context prefix and method.
 */
export type TypeRTRemoteScopeNamespace<
  Namespace extends string,
  ContextKey extends string = string,
> = {
  [Endpoint in keyof TypeRTRemoteScopeMap as Endpoint extends `${ContextKey}:${Namespace}/${infer Method}`
    ? Method
    : never]: TypeRTRemoteScopeMap[Endpoint]
}

type TypeRTRemoteScopeNamespaceKey<
  ContextKey extends string,
  Endpoint = keyof TypeRTRemoteScopeMap,
> = Endpoint extends `${ContextKey}:${infer Namespace}/${string}` ? Namespace : never

/** Generated scoped Remote namespaces available to one Context kind. */
export type TypeRTRemoteScopeApi<ContextKey extends string> = {
  [Namespace in TypeRTRemoteScopeNamespaceKey<ContextKey>]:
  TypeRTRemoteScopeNamespace<Namespace, ContextKey>
}

/** Merge-extensible direct namespace surface generated for Client Remote services. */
export interface TypeRTRemoteNamespaceMap {}

/** Awaitable disposer returned by Cordis-owned TypeRT registrations. */
export type TypeRTDisposer = () => Promise<void>

type StringKeyOf<Value> = Extract<keyof Value, string>

/** Minimal runtime-schema capability carried by strict generated codecs. */
export interface TypeRTSchema<Output = unknown> {
  /**
   * Parse and validate one boundary value.
   * @param value - untrusted boundary value.
   * @returns the validated value.
   */
  parse(value: unknown): Output
}

/** Codec attached to one invocation parameter or result. */
export type TypeRTCodec =
  | {
    readonly mode: 'strict'
    readonly typeSymbol: string
    readonly schema: TypeRTSchema
  }
  | {
    readonly mode: 'src-json'
  }

/** One ordered business parameter in a Remote invocation. */
export interface InvocationParameterDescriptor {
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

/** Source position retained for diagnostics from generated definitions. */
export interface InvocationSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

/** Carrier-independent description of one exported method invocation. */
export interface InvocationDescriptor {
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

/** Generated Host contract selected explicitly by a Client assembly. */
export interface TypeRTRemoteContribution {
  /** npm package that owns the Remote methods. */
  readonly package: string
  /** Consumer-side invocation descriptors generated from that package. */
  readonly descriptors: readonly InvocationDescriptor[]
}

/** Client Remote capability implemented by the Gateway and consumed by Remote assemblies. */
export interface TypeRTClientRemote extends TypeRTRemoteNamespaceMap {
  /**
   * Mount one generated Host-for-Client contribution in the caller's fiber.
   * @param contribution - explicitly selected Remote package artifact.
   * @returns disposer after namespace services and concrete methods are ready.
   */
  $mount(contribution: TypeRTRemoteContribution): Promise<TypeRTDisposer>
}

/**
 * Resolve one validated wire identity, synchronously or asynchronously.
 * @param id - validated wire identity.
 * @returns the Host object, or `undefined` when unavailable.
 */
export type TypeRTLookupResolver<Host = unknown, Wire = unknown> = (
  id: Wire,
) => Host | undefined | Promise<Host | undefined>

/** Runtime provider for one declared Host object lookup. */
export interface TypeRTLookupProvider<Host = unknown, Wire = unknown> {
  /** Source parameter name recognized by the SRC weak parser. */
  readonly parameter: string
  /** Wire field replacing the Host object parameter. */
  readonly wire: string
  /** Canonical Host type symbol used by strict generation. */
  readonly hostTypeSymbol: string
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string
  /**
   * Resolve a wire identity through the provider's default policy.
   * @param id - validated wire identity.
   * @returns the object, `undefined` when unavailable, or either asynchronously.
   */
  resolve(id: Wire): Host | undefined | Promise<Host | undefined>
}

/** Stable wire declaration retained after a lookup provider unloads. */
export interface TypeRTLookupDefinition {
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

/** Host resolver for one scoped Remote kind. */
export interface TypeRTHostContextProvider<Wire = unknown> {
  /** Wire field carrying the Context identity. */
  readonly wire: string
  /** Canonical wire type symbol used by strict generation. */
  readonly wireTypeSymbol: string
  /**
   * Resolve a wire identity to its live scoped Context.
   * @param id - validated wire identity.
   * @returns the scoped Context, or `undefined` when unavailable.
   */
  resolve(id: Wire): Context | undefined | Promise<Context | undefined>
}

/** Composition-owned resolver replacing one Host Context provider's default lookup policy. */
export type TypeRTHostContextResolver<Wire = unknown> = (
  id: Wire,
) => Context | undefined | Promise<Context | undefined>

/** Client resolver for the identity carried by the calling scoped Context. */
export interface TypeRTClientContextBinder<Wire = unknown> {
  /**
   * Read the Remote identity represented by a calling Context.
   * @param ctx - Context rebound by the Cordis service tracker.
   * @returns the wire identity, or `undefined` when the Context has the wrong scope.
   */
  identity(ctx: Context): Wire | undefined
}

/** Notification emitted after a TypeRT runtime registry changes. */
export interface TypeRTRegistryChange {
  readonly kind: 'local' | 'remote' | 'lookup' | 'host-context' | 'client-context'
  readonly key: string
}

/** Listener for one TypeRT runtime registry. */
export type TypeRTRegistryListener = (change: TypeRTRegistryChange) => void

/** Current-environment invocation definitions. */
export interface TypeRTLocalRegistry {
  /**
   * Look up one invocation by `<namespace>/<method>`.
   * @param endpoint - canonical endpoint.
   * @returns the live descriptor, or `undefined` when absent.
   */
  get(endpoint: string): InvocationDescriptor | undefined
  /**
   * Report whether a strict definition has existed during this TypeRT Service lifetime.
   * @param endpoint - canonical endpoint.
   * @returns `true` after the endpoint has been registered at least once, even if withdrawn.
   */
  hasSeen(endpoint: string): boolean
  /** @returns a registration-order snapshot of local descriptors. */
  list(): readonly InvocationDescriptor[]
  /**
   * Observe later local-definition changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypeRTRegistryListener): TypeRTDisposer
}

/** Consumer-selected Remote contribution registry. */
export interface TypeRTRemoteRegistry {
  /**
   * Register one generated contribution for the calling Cordis fiber.
   * @param contribution - generated Remote descriptors.
   * @returns disposer withdrawing the exact contribution.
   */
  register(contribution: TypeRTRemoteContribution): TypeRTDisposer
  /**
   * Look up one Remote descriptor by endpoint.
   * @param endpoint - canonical endpoint.
   * @returns the descriptor, or `undefined` when unmounted.
   */
  get(endpoint: string): InvocationDescriptor | undefined
  /** @returns a registration-order snapshot of Remote descriptors. */
  list(): readonly InvocationDescriptor[]
  /**
   * Observe later Remote contribution changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypeRTRegistryListener): TypeRTDisposer
}

/** Runtime registry for Host object lookup providers. */
export interface TypeRTLookupRegistry {
  /**
   * Register one provider under its merge-declared key.
   * @param key - lookup key.
   * @param provider - owning package's live resolver.
   * @returns disposer withdrawing the exact provider.
   */
  register<K extends StringKeyOf<TypeRTLookupMap>>(
    key: K,
    provider: TypeRTLookupProvider<
      TypeRTLookupHost<TypeRTLookupMap[K]>,
      TypeRTLookupWire<TypeRTLookupMap[K]>
    >,
  ): TypeRTDisposer
  /**
   * Replace one provider's default resolution policy while this contribution is active.
   * Configuration may precede provider registration; without a live provider, `get()` remains unavailable.
   * @param key - lookup key whose wire declaration remains provider-owned.
   * @param resolver - composition-owned resolver used by every lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  configure<K extends StringKeyOf<TypeRTLookupMap>>(
    key: K,
    resolver: TypeRTLookupResolver<
      TypeRTLookupHost<TypeRTLookupMap[K]>,
      TypeRTLookupWire<TypeRTLookupMap[K]>
    >,
  ): TypeRTDisposer
  /**
   * Look up one provider by runtime key.
   * @param key - descriptor lookup key.
   * @returns the live provider, or `undefined` when absent.
   */
  get(key: string): TypeRTLookupProvider | undefined
  /** @returns lookup declarations observed during this TypeRT Service lifetime. */
  definitions(): readonly TypeRTLookupDefinition[]
  /** @returns a snapshot of registered provider keys. */
  keys(): readonly string[]
  /**
   * Observe later lookup changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypeRTRegistryListener): TypeRTDisposer
}

/** Runtime registry for Host Context resolvers and Client Context binders. */
export interface TypeRTContextRegistry {
  /**
   * Register a Host Context resolver.
   * @param key - merge-declared Context key.
   * @param provider - owning package's Host resolver.
   * @returns disposer withdrawing the exact provider.
   */
  registerHost<K extends StringKeyOf<TypeRTContextMap>>(
    key: K,
    provider: TypeRTHostContextProvider<TypeRTContextWire<TypeRTContextMap[K]>>,
  ): TypeRTDisposer
  /**
   * Override one Host Context key's identity policy for the calling fiber.
   * Configuration may precede provider registration and restores the provider's default resolver on disposal.
   * @param key - merge-declared Context key.
   * @param resolver - composition-owned resolver used by every Host Context lookup of this key.
   * @returns disposer restoring the provider's default resolver.
   */
  configureHost<K extends StringKeyOf<TypeRTContextMap>>(
    key: K,
    resolver: TypeRTHostContextResolver<TypeRTContextWire<TypeRTContextMap[K]>>,
  ): TypeRTDisposer
  /**
   * Register a Client Context identity binder.
   * @param key - merge-declared Context key.
   * @param binder - Client scope identity resolver.
   * @returns disposer withdrawing the exact binder.
   */
  registerClient<K extends StringKeyOf<TypeRTContextMap>>(
    key: K,
    binder: TypeRTClientContextBinder<TypeRTContextWire<TypeRTContextMap[K]>>,
  ): TypeRTDisposer
  /**
   * Look up a Host Context resolver.
   * @param key - descriptor Context key.
   * @returns the provider, or `undefined` when absent.
   */
  getHost(key: string): TypeRTHostContextProvider | undefined
  /**
   * Look up a Client Context binder.
   * @param key - descriptor Context key.
   * @returns the binder, or `undefined` when absent.
   */
  getClient(key: string): TypeRTClientContextBinder | undefined
  /**
   * Observe later Context provider changes.
   * @param listener - synchronous contained observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: TypeRTRegistryListener): TypeRTDisposer
}

/** Minimal TypeRT runtime consumed through dependency inversion. */
export interface TypeRTService {
  readonly local: TypeRTLocalRegistry
  readonly remotes: TypeRTRemoteRegistry
  readonly lookups: TypeRTLookupRegistry
  readonly contexts: TypeRTContextRegistry
}

declare module 'cordis' {
  interface Context {
    typert: TypeRTService
  }
}
