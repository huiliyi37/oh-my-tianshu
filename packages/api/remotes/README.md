# @deepseek-ai/dsh-api-remotes

English | [中文](README.zh.md)

Two-sided BFF for Host Remote capabilities selected by this application. The Host entry owns Agent/Session identity policy; the Client entry imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`, and re-exports their declaration merges. Client business packages depend on this facade rather than the Gateway implementation or individual Remote runtime entries.

`createApiRemoteAgentResolver()` reuses live Agents, resumes ordinary cold sessions, deduplicates concurrent resumes, preserves the subagent ownership fence, and configures the same resolver for TypeRT `agent` and `session` lookups. The standard Web API Proxy supplies its Agent defaults and scope setup, then uses the returned resolver for legacy methods, so migrated and unmigrated methods share one policy implementation.

The current Client assembly mounts only the Goal Remote contribution. Cordis effect ownership withdraws every contribution when this assembly unloads, while `@deepseek-ai/dsh-api-gateway/client` owns descriptor validation, traced namespace Services, direct and scoped methods, invocation, and cancellation. The Client entry consumes the shared `TypeRTClientRemote` interface through Cordis and does not import the concrete Gateway.

This package contains no transport or Host service discovery logic. Its Client face can be reused by Web or a future TUI that provides the same React-free `ctx.remote` contract.

## Build boundary

An ordinary repository package belongs to one TypeScript face: Host packages are registered in the root `tsconfig.host.json`, and Client packages in the root `tsconfig.client.json`. `api-remotes` is the only deliberate exception because its Host entry must participate in the Host TypeRT graph, while `src/client/index.ts` cannot compile until Host tsdown has generated the business packages' `/remote` declarations.

This package's root `tsconfig.json` is only a solution that references `tsconfig.host.json` and `tsconfig.client.json`. The Host aggregate and direct Host consumers reference the former, while the Client aggregate and direct Client consumers reference the latter; the package-root solution must not enter either aggregate's dependency graph. The two projects own disjoint source files and `.tsbuildinfo` files but share the `lib/types` output directory.

The package-local `clientBundle(..., { hostPhase: true })` makes Host tsdown bundle the Host entry and the later Client tsdown bundle only the browser entry. Ordinary Client plugins remain single Client projects and produce both their Node loader entry and browser bundle during Client tsdown; do not copy this package's split merely because a package has both `src/index.ts` and `src/client/index.ts`.

## Model Experience

None, as this BFF selects Remote application methods and identity policy but registers no model surface.

#### KV Cache effect

No direct effect; mounted Host capabilities own any model-visible behavior they trigger.

## Known Limitations and Deferred Work

- The capability set is fixed by explicit build-time value imports; the Client does not discover the Host's active Services or Remote definitions at runtime.
- Additional capabilities require an explicit `/remote` value import and mount in this assembly.
- The standard Web Host supplies resume defaults and Agent-scope setup from the legacy API Proxy until that remaining BFF configuration moves into `api-remotes`.
