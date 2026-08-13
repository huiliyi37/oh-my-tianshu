import { describe, expect, it } from 'vitest'
import { call, CONTENT_OUTPUT_CODE, setup, text } from './helpers.ts'

/**
 * The sandbox context façade is a whitelist, not a pass-through proxy. Mounted code reaches only
 * registration/eventing verbs, timer helpers, guarded tools, and injected services. Framework
 * members that expose an unguarded context are denied because they could bypass marker checks and
 * host-realm normalization; these tests pin that escape class.
 */

/** Mount a plugin whose `apply` touches one framework member, and report the error text. */
async function mountTouching(ctx: Awaited<ReturnType<typeof setup>>, expr: string): Promise<string> {
  const result = await call(ctx, 'cordis_mount', {
    code: `return { name: 'probe', inject: ['tools'], apply(ctx) { ${expr} } }`,
  })
  expect(result.isError).toBe(true)
  return text(result)
}

describe('sandbox context façade — escape surface is closed', () => {
  it.each([
    ['ctx.root', 'const c = ctx.root'],
    ['ctx.parent', 'const c = ctx.parent'],
    ['ctx.scope', 'const c = ctx.scope'],
    ['ctx.fiber', 'const f = ctx.fiber'],
    ['ctx.reflect', 'const r = ctx.reflect'],
    ['ctx.registry', 'const r = ctx.registry'],
    ['ctx.events', 'const e = ctx.events'],
    ['ctx.extend()', 'ctx.extend({})'],
    ['ctx.isolate()', 'ctx.isolate("x")'],
    ['ctx.intercept()', 'ctx.intercept("x", {})'],
    ['ctx.plugin()', 'ctx.plugin({ apply() {} })'],
    ['ctx.set()', 'ctx.set("tools", 1)'],
    ['ctx.mixin()', 'ctx.mixin("x", [])'],
  ])('denies %s with a teaching error', async (_label, expr) => {
    const ctx = await setup()
    const message = await mountTouching(ctx, expr)
    expect(message).toContain('sandbox ctx does not expose')
    expect(message).toContain('withheld by design')
  })

  it('the classic ctx.root.tools.register bypass registers nothing and fails loud', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'root-bypass',
          inject: ['tools'],
          apply(ctx) {
            ctx.root.tools.register({
              name: 'smuggled',
              description: 'raw, unguarded',
              parameters: { type: 'object', properties: {} },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            })
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('sandbox ctx does not expose "root"')
    // The whole point: the bypass never reaches the registry.
    expect(ctx.tools.get('smuggled')).toBeUndefined()
  })

  it('rejects assignment to the façade rather than silently dropping it', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'writer\', apply(ctx) { ctx.stash = 1 } }',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('sandbox ctx is read-only')
  })

  it('denies a service whose method returns a Context (the .ctx escape), registering nothing', async () => {
    // A cordis Service instance carries `.ctx` (a real Context), so
    // `ctx.systemPrompt.ctx.root.tools.register(…)` would escape the façade; service-return
    // guards reject that Context before the registration lands.
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'svc-ctx-escape',
          inject: ['systemPrompt', 'tools'],
          apply(ctx) {
            ctx.systemPrompt.ctx.root.tools.register({
              name: 'smuggled_via_service',
              description: 'raw, unguarded',
              parameters: { type: 'object', properties: {} },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            })
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('returned a cordis Context, which the sandbox does not expose')
    expect(ctx.tools.get('smuggled_via_service')).toBeUndefined()
  })

  it('guards an async injected-service method: a host-realm Promise resolves through the guard', async () => {
    // The return guard's Promise arm only fires for a HOST-realm Promise (a vm-realm one is not
    // `instanceof` the host `Promise`).
    const ctx = await setup()
    ctx.plugin({
      name: 'host-async-svc',
      apply(c) { c.provide('hostAsync', { grab: async () => { return 'host-fetched' } }) },
    })
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'async-consumer',
          inject: ['hostAsync', 'tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'do_fetch',
              description: 'awaits the host async service',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() {
                const value = await ctx.hostAsync.grab()
                return [{ type: 'text', text: value }]
              },
            }))
          },
        }
      `,
    })
    const result = await call(ctx, 'do_fetch', {})
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('host-fetched')
  })

  it('reads a symbol property as undefined and answers the `in` operator without throwing', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'introspector',
          inject: ['tools'],
          apply(ctx) {
            const sym = ctx[Symbol.iterator]
            console.log('probe', sym === undefined, 'tools' in ctx, 'on' in ctx, 'root' in ctx)
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
  })
})

describe('sandbox context façade — inject gate on services', () => {
  it('denies an undeclared live service (property access), naming the inject fix', async () => {
    // `systemPrompt` is a live global service in the setup harness, but this
    // mount does not declare it — reaching it would let the mount depend on a
    // provider cordis does not know about, so it is refused.
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'undeclared\', inject: [\'tools\'], apply(ctx) { const s = ctx.systemPrompt } }',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('service "systemPrompt" is not injected')
    expect(text(result)).toContain('inject: [\'systemPrompt\', …]')
  })

  it('denies an undeclared live service reached through ctx.get too', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'undeclared-get\', inject: [\'tools\'], apply(ctx) { ctx.get(\'systemPrompt\') } }',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('service "systemPrompt" is not injected')
  })

  it('allows a service the mount DID declare in inject', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'declared',
          inject: ['systemPrompt', 'tools'],
          apply(ctx) { console.log('has systemPrompt:', typeof ctx.systemPrompt) }
        }
      `,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('is running')
  })

  it('a cross-mount consumer must declare the provider — the undeclared path is refused, not left as a zombie tool', async () => {
    // Without declared inject, Cordis cannot park the consumer when its provider unmounts. The
    // façade refuses access up front instead of leaving a zombie tool.
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: 'return { name: \'greeter-provider\', apply(ctx) { ctx.provide(\'greeter\', { greet: (n) => \'hi \' + n }) } }',
    })
    const undeclared = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'sloppy-consumer',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'greet_undeclared',
              description: 'uses greeter without declaring it',
              parameters: { n: { type: 'string', required: true } },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) { return [{ type: 'text', text: ctx.greeter.greet(args.n) }] },
            }))
          },
        }
      `,
    })
    // The tool registers (its execute is lazy), but calling it hits the gate:
    // `ctx.greeter` is undeclared, so it fails with the teaching error rather
    // than silently working and later stranding.
    expect(undeclared.isError).toBe(false)
    const called = await call(ctx, 'greet_undeclared', { n: 'x' })
    expect(called.isError).toBe(true)
    expect(text(called)).toContain('service "greeter" is not injected')
  })
})

describe('sandbox tools façade — get is a read-only schema view', () => {
  it('ctx.tools.get returns a schema, not the live ToolDefinition with execute', async () => {
    // The finding: returning the raw ToolDefinition hands mount code the tool's execute
    // function, letting it bypass ToolRegistry.execute (and its pre/post hooks). get now
    // returns the same name/description/parameters view as schemas(), with no execute.
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'reporter',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'report_view',
              description: 'reports the shape of a tool view',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() {
                const view = ctx.tools.get('cordis_mount')
                return [{ type: 'text', text: JSON.stringify({
                  hasExecute: 'execute' in view,
                  hasPresentCall: 'presentCall' in view,
                  name: view.name,
                  keys: Object.keys(view).sort(),
                }) }]
              },
            }))
          },
        }
      `,
    })
    const reported = await call(ctx, 'report_view', {})
    expect(reported.isError).toBe(false)
    const shape = JSON.parse(text(reported)) as { hasExecute: boolean; hasPresentCall: boolean; name: string; keys: string[] }
    expect(shape.hasExecute).toBe(false)
    expect(shape.hasPresentCall).toBe(false)
    expect(shape.name).toBe('cordis_mount')
    expect(shape.keys).toEqual(['description', 'name', 'parameters'])
  })

  it('ctx.tools.get returns undefined for an unknown tool', async () => {
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'unknown-probe',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'probe_unknown',
              description: 'reports whether an unknown tool resolves',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() {
                return [{ type: 'text', text: String(ctx.tools.get('no_such_tool') === undefined) }]
              },
            }))
          },
        }
      `,
    })
    expect(text(await call(ctx, 'probe_unknown', {}))).toBe('true')
  })
})
