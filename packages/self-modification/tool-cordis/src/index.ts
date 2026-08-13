/**
 * Self-referential runtime tools: inspect live services/plugins/tools, mount a returned temporary
 * plugin under an owned dynamic fiber, and unmount it to quiescence. Registrations are fiber effects,
 * so plugin disposal removes the entire dynamic subtree. The VM and context façade prevent
 * accidental misuse, not hostile code: an allowed service such as `ctx.bash` reaches the real
 * runtime. Named exports preserve loader injection metadata.
 * @module @huiliyi37/dsh-tool-cordis
 */

import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { defineTool } from '@huiliyi37/dsh-tools'
import { STATE_LABELS } from './fiber-state.ts'
import { isPlugin, pluginName } from './guard.ts'
import { EVENT_API, INHERITED_CTX_API, SERVICE_API, TYPE_API } from './api-catalog.ts'
import { describeApi, describeDynamic, describeEvents, describePlugins, describeServices, describeTools, providedServices } from './inspect.ts'
import { missingServices, mountDynamic, type DynamicMount } from './mount.ts'
import { presentInspectCall, presentMountCall, presentUnmountCall } from './present.ts'
import { createSandbox, evaluateMountCode } from './sandbox.ts'

export const name = 'tool-cordis'
export const inject = ['tools']

/** Config for the tool-cordis plugin: the sandbox evaluation bound. */
export interface Config {
  /**
   * Milliseconds the SYNCHRONOUS portion of mount code may run in the vm
   * before evaluation is aborted (default 5000). An async body escapes this
   * bound — see .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md for the trust stance.
   */
  vmTimeoutMs?: number
}

/** Schemastery validator for {@link Config}: `vmTimeoutMs` must be at least 1 (defaults to 5000). */
export const Config: z<Config> = z.object({
  vmTimeoutMs: z.number().min(1).default(5000),
})

/** {@link Config} with every defaulted field present, as schemastery resolves it at load. */
type ResolvedConfig = Required<Config>

/**
 * Register the three cordis tools and own every temporary plugin under one
 * `cordis-dynamic` group fiber.
 * @param ctx - the plugin context (`tools` injected).
 * @param config - the schemastery-resolved {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const { vmTimeoutMs } = config as ResolvedConfig
  // The one group fiber every dynamic mount hangs under.
  const group = ctx.plugin({ name: 'cordis-dynamic', apply: () => {} })

  const mounts = new Map<string, DynamicMount>()
  let nextId = 1

  ctx.tools.register(defineTool({
    name: 'cordis_inspect',
    description:
      'Inspect the live Cordis runtime in the current DSH process. Read-only. '
      + 'Sections: `services` (every provided ctx service and the plugin fiber that owns it), '
      + '`plugins` (all live plugin fibers with their lifecycle states), '
      + '`tools` (the model-facing tools currently registered, i.e. what you can call), '
      + '`temporary` (only temporary Plugins created by cordis_mount: id, name, state, provided services, awaited services, and lifetime), '
      + '`api` (method signatures AND argument/return type shapes for every LIVE service — read this before writing plugin code that calls a service), '
      + '`events` (every harness event with its dispatch mode and exact signature — pick listener targets here). '
      + 'Temporary Plugins exist only in memory, remain active across later turns, and disappear after cordis_unmount, toolset unload, or DSH restart; they are not restored automatically. '
      + 'The `temporary` section is a subset of `plugins`. Omit `what` to get all six sections. '
      + 'With `what:"api"` or `what:"events"`, pass an exact `name` '
      + 'to narrow to one service/event and include its original source JSDoc.',
    parameters: {
      what: {
        type: 'string',
        enum: ['services', 'plugins', 'tools', 'temporary', 'api', 'events'],
        description: 'Limit the report to one section. Omit for all sections.',
      },
      name: {
        type: 'string',
        description: 'Exact service key or event name whose original JSDoc to include; valid only with what:"api" or what:"events".',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args, exec): Promise<string> {
      if (args.name !== undefined && args.what !== 'api' && args.what !== 'events') {
        throw new Error('name is valid only with what:"api" or what:"events"')
      }
      const sections: [key: string, heading: string, body: () => string[]][] = [
        ['services', 'services', () => describeServices(ctx)],
        ['plugins', 'plugins', () => describePlugins(ctx)],
        // The calling agent's view: scoped/shadowed tools included, restricted
        // globals absent — "what you can call", not the global registry.
        ['tools', 'tools', () => describeTools(ctx, exec.agent)],
        ['temporary', 'Temporary Plugins', () => describeDynamic(ctx, mounts)],
        ['api', 'api', () => { return describeApi(ctx, SERVICE_API, INHERITED_CTX_API, TYPE_API, args.name) }],
        ['events', 'events', () => describeEvents(EVENT_API, args.name)],
      ]
      const selected = sections.filter(([key]) => args.what === undefined || args.what === key)
      const text = selected
        .map(([, heading, body]) => `## ${heading}\n${body().join('\n')}`)
        .join('\n\n')
      return Promise.resolve(text)
    },
    presentCall: presentInspectCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_mount',
    description:
      'Mount a temporary Cordis Plugin in the current DSH process. '
      + 'This creates an in-memory runtime Plugin, not an installed or configured Plugin. '
      + 'It remains active across later turns until cordis_unmount, toolset unload, or DSH restart. '
      + 'It does not create files, install a package, change cordis.yml or personal/project config, survive restart, or automatically become permanent. '
      + 'To keep it, ask the Agent to implement a normal local, project, or repository Plugin through the regular development workflow. '
      + 'It may affect other sessions in the same process; the sandbox is not a security boundary, and injected services reach the real runtime. '
      + '`code` runs now as the body of an async JavaScript function '
      + 'in an isolated sandbox and MUST `return` a plugin. Two forms: '
      + 'FUNCTION form `return (ctx) => { … }` — declares no inject, so it can register '
      + 'tools, listen to events, and provide services, but reaching ANY service (e.g. '
      + 'ctx.bash) throws; use it only when you need no services. '
      + 'OBJECT form `return { name?, inject: [\'bash\', \'llm\', …], apply(ctx) { … } }` '
      + '— declares dependencies, and cordis activates the plugin only after the '
      + 'services exist; PREFER this form. You may reach ONLY the services you list in '
      + 'inject: an undeclared service throws even if it exists, because an undeclared '
      + 'dependency would not be cleaned up if its provider is unmounted. '
      + 'BEFORE calling a service from your code, read cordis_inspect what:"api" — it lists '
      + 'method signatures AND the type shapes of their arguments/returns (do not guess a '
      + 'field\'s type; e.g. a bash run\'s stdout is an object, not a string). '
      + 'Inside `apply`, use the standard cordis API: `ctx.on(event, listener)` to observe '
      + 'events (see cordis_inspect what:"events"), or call '
      + '`harness.registerTool(ctx, harness.defineTool({ name, description, parameters: '
      + '{ text: { type: \'string\', required: true } }, output: { schema: { type: \'string\' }, '
      + 'render(_args, value) { return [{ type: \'text\', text: value }] } }, async execute(args) { return args.text } }))` '
      + 'to give yourself a new tool — it becomes callable on your NEXT step. '
      + 'Tool parameters: each key IS a property — { type: \'string\'|\'number\'|\'integer\'|\'boolean\'|\'null\'|\'object\'|\'array\'|\'json\', '
      + 'required?: true, description?, enum?, const?, items?, properties? }; every direct DSL object declares additionalProperties: true|false, and '
      + 'oneOf: [schema, schema, ...] replaces type for an exact-one union. A raw JSON-Schema { type: \'object\', properties, required?: […] } wrapper is also accepted with open-by-default objects. A '
      + 'tool\'s `execute` MUST return the lossless JSON value declared by `output.schema`; '
      + '`output.render(args, value)` separately returns Native/model content blocks. '
      + 'Temporary Plugins can COMPOSE: one Plugin may `ctx.provide(\'name\', value)` a service and '
      + 'another may declare `inject: [\'name\']` to consume it — the consumer stays pending '
      + 'until the provider exists and returns to pending when the provider is unmounted. '
      + 'Everything registered inside `apply` is cleaned up automatically by cordis_unmount. '
      + 'Sandbox globals: `console` (tagged `[cordis:<id>]`, writes through to the harness '
      + 'terminal), `harness.defineTool`, `harness.registerTool`, '
      + '`btoa`, `atob`, `TextEncoder`, `TextDecoder`. '
      + 'Node APIs are DISABLED — do filesystem/network/timer work through the cordis services, '
      + 'never Node built-ins: `require`, `setTimeout`/`setInterval`, and `fetch` throw redirect '
      + 'errors; `process` and `Buffer` are undefined. Instead use inject: [\'fs\'] + ctx.fs for '
      + 'files, inject: [\'web\'] + ctx.web for HTTP, inject: [\'bash\'] + ctx.bash for processes, '
      + 'and inject: [\'timer\'] + ctx.setTimeout/ctx.setInterval for timing (fiber effects, '
      + 'auto-cleaned when unmounted) — cordis_inspect what:"api" shows what THIS runtime provides. '
      + 'Write PLAIN JavaScript, not TypeScript (no `as`, no type annotations). '
      + 'Cautions: (1) waterfall events (e.g. tools/pre-execute) hand the listener a '
      + 'trailing `next` callback which MUST be called — returning without `next()` '
      + 'SHORT-CIRCUITS the call; prefer plain notification events unless you intend to '
      + 'intercept. (2) Never await something that only resolves after the current '
      + 'turn (your code runs INSIDE a tool call of that turn — it would deadlock). '
      + '(3) Your `ctx` is a restricted façade: you can register tools, observe '
      + 'events, provide/consume services, and use timers, but framework internals '
      + '(ctx.root, ctx.fiber, ctx.extend, ctx.plugin, …) are withheld. It is not a '
      + 'security boundary though — the services you inject (e.g. ctx.bash) reach the '
      + 'real runtime.',
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'JavaScript body returning a temporary Plugin; evaluated now and saved nowhere.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          pluginName: { type: 'string', required: true },
          state: {
            type: 'string',
            required: true,
            enum: ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading'],
          },
          provides: { type: 'array', required: true, items: { type: 'string' } },
          waitingFor: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const status = value.waitingFor.length > 0
          ? `is pending (plugin "${value.pluginName}"; missing services: ${value.waitingFor.join(', ')}`
          : `is running (plugin "${value.pluginName}"`
        return [{
          type: 'text',
          text: `Temporary Plugin ${value.id} ${status}; available until unmounted or DSH restarts).`,
        }]
      },
    },
    async execute(args) {
      const id = `dyn-${nextId++}`
      const sandbox = createSandbox(id)
      const evaluated = await evaluateMountCode(sandbox, args.code, id, vmTimeoutMs)
      if (!isPlugin(evaluated)) {
        if (evaluated === undefined) {
          throw new Error(
            'temporary Plugin code returned `undefined` — did you forget `return`?\n'
            + '  ✓ return (ctx) => { … }\n'
            + '  ✓ return { name: \'…\', inject: […], apply(ctx) { … } }',
          )
        }
        throw new Error(
          'temporary Plugin code must `return` a Plugin: a function, or an object with an `apply(ctx)` method',
        )
      }
      const fiber = await mountDynamic(group, evaluated)
      mounts.set(id, { fiber, pluginName: pluginName(evaluated) })
      // A settled fiber that is not ACTIVE is waiting on unsatisfied inject —
      // legal cordis semantics (it activates when the service appears), so keep
      // it mounted but tell the model what it is waiting for.
      const missing = missingServices(ctx, fiber)
      const state = STATE_LABELS[fiber.state]
      return {
        id,
        pluginName: pluginName(evaluated),
        state,
        provides: providedServices(ctx, fiber),
        waitingFor: missing,
      }
    },
    presentCall: presentMountCall,
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_unmount',
    description:
      'Unmount a current-process temporary Plugin created by cordis_mount. Waits for its tools, listeners, services, timers, and other owned effects to clean up completely. '
      + 'Only dyn-N temporary ids are accepted; this cannot remove Loader, configured, or installed Plugins.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The temporary Plugin id returned by cordis_mount (for example "dyn-1"); valid only in this process and invalid after unmount or restart.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          pluginName: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Temporary Plugin ${value.id} was unmounted and removed.` }],
    },
    async execute(args) {
      const mount = mounts.get(args.id)
      if (!mount) {
        throw new Error(`no temporary Plugin with id "${args.id}" (list them with cordis_inspect what:"temporary")`)
      }
      await mount.fiber.dispose()
      mounts.delete(args.id)
      return { id: args.id, pluginName: mount.pluginName }
    },
    presentCall: presentUnmountCall,
  }))
}
