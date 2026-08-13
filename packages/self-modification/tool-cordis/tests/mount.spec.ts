import { afterEach, describe, expect, it, vi } from 'vitest'
import { isJsonValue } from '@deepseek-ai/dsh-session'
import { sandboxDefineTool } from '../src/guard.ts'
import { syntaxErrorContext } from '../src/sandbox.ts'
import { call, CONTENT_OUTPUT_CODE, dummyTool, LISTENER_CODE, REVERSE_TOOL_CODE, setup, text } from './helpers.ts'

/**
 * The `cordis_mount` success/failure family: real plugins land on a genuine
 * cordis fiber tree, their registrations are observable through the real
 * registry/event bus, and every rejection path teaches the fix.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cordis_mount', () => {
  it.each([
    [42, 'options must be an object'],
    [{ parameters: {} }, 'output must declare { schema, render, presentationMeta? }'],
    [{ parameters: {}, output: { schema: { type: 'json' } }, execute: async (): Promise<null> => null }, 'output.render must be a function'],
    [{ parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: true }, 'execute must be a function'],
    [{
      parameters: {},
      output: { schema: { type: 'json' }, render: () => [], presentationMeta: true },
      execute: async (): Promise<null> => null,
    }, 'output.presentationMeta must be a function'],
  ])('rejects an invalid dynamic tool declaration before registration: %j', (definition, message) => {
    expect(() => sandboxDefineTool(definition)).toThrow(message)
  })

  it('bounds the preview of an invalid dynamic renderer return', () => {
    const definition = sandboxDefineTool({
      name: 'invalid-renderer',
      description: 'invalid renderer',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => ['x'.repeat(500)],
      },
      execute: async () => 'ok',
    })
    expect(() => definition.output.render({}, 'ok')).toThrow(/output\.render returned \["x+…/)
  })

  it('mounts a listener plugin that observes real events, tagged-logging through to the host console', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await call(ctx, 'cordis_mount', { code: LISTENER_CODE })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected cordis_mount success')
    expect(result.value).toEqual({
      id: 'dyn-1',
      pluginName: 'change-logger',
      state: 'active',
      provides: [],
      waitingFor: [],
    })
    expect(text(result)).toBe('Temporary Plugin dyn-1 is running (plugin "change-logger"; available until unmounted or DSH restarts).')

    // Fire a REAL tools/change by registering a tool; the mounted listener logs.
    ctx.tools.register(dummyTool('trigger_a'))
    expect(log).toHaveBeenCalledWith('[cordis:dyn-1]', 'tools changed')
  })

  it('mounts a bare-function plugin as <anonymous>, and a named function under its name', async () => {
    const ctx = await setup()
    const anonymous = await call(ctx, 'cordis_mount', { code: 'return (ctx) => { ctx.on(\'tools/change\', () => {}) }' })
    expect(anonymous.isError).toBe(false)
    expect(text(anonymous)).toContain('plugin "<anonymous>"')
    const named = await call(ctx, 'cordis_mount', { code: 'return function watcher(ctx) {}' })
    expect(text(named)).toContain('plugin "watcher"')
  })

  it('lets the agent give ITSELF a new tool, immediately callable through the registry', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: REVERSE_TOOL_CODE })
    expect(result.isError).toBe(false)

    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('reverse_text')
    const reversed = await call(ctx, 'reverse_text', { text: 'harness' })
    expect(reversed.isError).toBe(false)
    if (reversed.isError) { throw new Error('expected dynamic tool success') }
    expect(reversed.value).toBe('ssenrah')
    expect(text(reversed)).toBe('ssenrah')
  })

  it('normalizes a self-made tool\'s result into the host realm, so the session log accepts it', async () => {
    // VM-realm objects fail the session prototype-identity check; normalize them into host JSON.
    const ctx = await setup()
    await call(ctx, 'cordis_mount', { code: REVERSE_TOOL_CODE })
    const reversed = await call(ctx, 'reverse_text', { text: 'harness' })
    expect(isJsonValue({ content: reversed.content, isError: reversed.isError })).toBe(true)
  })

  it('projects presentation metadata from a dynamic canonical value', async () => {
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'meta-return',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'meta_tool',
              description: 'attaches a private presentation payload',
              parameters: {},
              output: {
                schema: { type: 'string' },
                render(_args, value) { return [{ type: 'text', text: value }] },
                presentationMeta() { return { kind: 'demo' } },
              },
              async execute() {
                return 'ok'
              },
            }))
          },
        }
      `,
    })
    const result = await call(ctx, 'meta_tool', {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected dynamic tool success')
    expect(result.value).toBe('ok')
    expect(text(result)).toBe('ok')
    expect(result.meta).toEqual({ kind: 'demo' })
  })

  it.each([
    ['a bare string', 'return \'ok\'', 'returned invalid output: "value" must be an array'],
    ['an object whose content is a string', 'return { content: \'ok\' }', 'returned invalid output: "value" must be an array'],
    ['an array of non-objects', 'return [\'ok\']', 'output.render returned ["ok"]'],
    ['blocks missing the type tag', 'return [{ text: \'hi\' }]', 'output.render returned [{"text":"hi"}]'],
    ['object-form blocks missing the type tag', 'return { content: [{ text: \'hi\' }] }', 'returned invalid output: "value" must be an array'],
    ['undefined — a forgotten return', 'return undefined', 'execute result must be lossless JSON data'],
  ])('rejects an execute return of %s against its declared output', async (_label, returnStatement, diagnostic) => {
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'bad-return',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'bad_return_tool',
              description: 'returns a wrong shape',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() { ${returnStatement} },
            }))
          },
        }
      `,
    })
    const result = await call(ctx, 'bad_return_tool', {})
    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
    expect(text(result)).toContain(diagnostic)
  })

  it('does not echo a huge schema-invalid canonical value in the diagnostic', async () => {
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'huge-return',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'huge_return_tool',
              description: 'returns a huge wrong shape',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() { return 'x'.repeat(500) },
            }))
          },
        }
      `,
    })
    const result = await call(ctx, 'huge_return_tool', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('returned invalid output')
    expect(text(result)).not.toContain('x'.repeat(200))
  })

  it('accepts a JSON-Schema-style parameters wrapper and normalizes it to the DSL', async () => {
    // These common JSON-Schema spellings each have one DSL meaning, so normalize rather than
    // consume another model turn with a rejection.
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'json-schema-tool',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'json_schema_tool',
              description: 'written in the JSON-Schema dialect',
              parameters: {
                type: 'object',
                title: 'Raw parameters',
                default: { text: 'default' },
                examples: [{ text: 'example' }],
                properties: {
                  text: { type: 'string', description: 'the text' },
                  count: { type: 'integer', default: 1 },
                  mode: { type: 'string', enum: ['fast', 'slow'] },
                  extra: { type: 'string' },
                },
                required: ['text'],
              },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) { return [{ type: 'text', text: args.text + ':' + (args.count ?? 0) }] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)

    // The registered schema is canonical JSON Schema derived from the DSL:
    // the required array survived, integer stayed integer, extra is optional.
    const schema = ctx.tools.schemas().find(s => s.name === 'json_schema_tool')!
    const parameters = schema.parameters as {
      properties: Record<string, { type: string; enum?: string[]; default?: unknown }>
      required?: string[]
    }
    expect(parameters.required).toEqual(['text'])
    expect(parameters).toMatchObject({
      title: 'Raw parameters',
      default: { text: 'default' },
      examples: [{ text: 'example' }],
    })
    expect(parameters.properties.count!.type).toBe('integer')
    expect(parameters.properties.count!.default).toBe(1)
    expect(parameters.properties.mode!.enum).toEqual(['fast', 'slow'])
    // Arg validation enforces the normalized spec: text required, extra not.
    expect((await call(ctx, 'json_schema_tool', { count: 2 })).isError).toBe(true)
    expect(text(await call(ctx, 'json_schema_tool', { text: 'ok', count: 2 }))).toBe('ok:2')
  })

  it('normalizes a nested object property carrying a JSON-Schema required array', async () => {
    // On an object PROPERTY, a JSON-Schema-style `required` array names the
    // required children — the nested unwrap converts it just like the top level.
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'nested-json-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'nested_json_schema_tool',
              description: 'nested dialect',
              parameters: {
                type: 'object',
                properties: {
                  cfg: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
                },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) { return [{ type: 'text', text: args.cfg.label }] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    const schema = ctx.tools.schemas().find(s => s.name === 'nested_json_schema_tool')!
    const cfg = (schema.parameters as { properties: { cfg: { required?: string[] } } }).properties.cfg
    expect(cfg.required).toEqual(['label'])
    expect(text(await call(ctx, 'nested_json_schema_tool', { cfg: { label: 'hi' } }))).toBe('hi')
  })

  it('normalizes every unified DSL node and lossless annotation shape across the sandbox realm', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'unified-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'unified_schema_tool',
              description: 'all unified nodes',
              parameters: {
                any: {
                  type: 'json',
                  title: 'Any JSON',
                  default: { nested: [1, 'x', null] },
                  examples: [{ ok: true }],
                },
                choice: {
                  oneOf: [{ type: 'string', const: 'x' }, { type: 'null' }],
                  required: true,
                },
                flags: { type: 'array' },
                closed: { type: 'object', additionalProperties: false },
                count: { type: 'number', enum: [1, 2], const: 1 },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) { return [{ type: 'text', text: String(args.choice) }] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    const schema = ctx.tools.schemas().find(s => s.name === 'unified_schema_tool')!
    expect(schema.parameters).toMatchObject({
      properties: {
        any: { title: 'Any JSON', default: { nested: [1, 'x', null] }, examples: [{ ok: true }] },
        choice: { oneOf: [{ type: 'string', const: 'x' }, { type: 'null' }] },
        flags: { type: 'array' },
        closed: { type: 'object', additionalProperties: false },
        count: { type: 'number', enum: [1, 2], const: 1 },
      },
      required: ['choice'],
    })
  })

  it('normalizes and snapshots deeply nested sandbox schemas and annotations stack-safely', async () => {
    const ctx = await setup()
    const depth = 5_000
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'deep-unified-schema',
          inject: ['tools'],
          apply(ctx) {
            let choice = { type: 'string' }
            let example = 'leaf'
            for (let index = 0; index < ${depth}; index++) {
              choice = { oneOf: [choice, { type: 'null' }] }
              example = [example]
            }
            harness.registerTool(ctx, harness.defineTool({
              name: 'deep_unified_schema_tool',
              description: 'deep unified nodes',
              parameters: {
                choice: { ...choice, required: true },
                any: { type: 'json', default: example },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)

    const parameters = ctx.tools.schemas().find(s => s.name === 'deep_unified_schema_tool')!.parameters as {
      properties: Record<string, Record<string, unknown>>
    }
    let choice = parameters.properties.choice!
    let choiceDepth = 0
    while (Array.isArray(choice.oneOf)) {
      choice = choice.oneOf[0] as Record<string, unknown>
      choiceDepth++
    }
    let example: unknown = parameters.properties.any!.default
    let exampleDepth = 0
    while (Array.isArray(example)) {
      example = example[0]
      exampleDepth++
    }
    expect({ choiceDepth, choice, exampleDepth, example }).toEqual({
      choiceDepth: depth,
      choice: { type: 'string' },
      exampleDepth: depth,
      example: 'leaf',
    })
  })

  it('normalizes unconstrained and closed nested nodes from a raw JSON Schema wrapper', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'raw-unified-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'raw_unified_schema_tool',
              description: 'raw unified nodes',
              parameters: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  any: { description: 'unconstrained' },
                  cfg: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { label: { type: 'string' } },
                    required: ['label'],
                  },
                  choice: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
                },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    expect(ctx.tools.schemas().find(s => s.name === 'raw_unified_schema_tool')!.parameters).toMatchObject({
      properties: {
        any: {},
        cfg: { additionalProperties: false, required: ['label'] },
        choice: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
      },
    })
  })

  it.each([
    ['parameters: 42', 'must be a ParameterSchemaSpec object'],
    ['parameters: Object.defineProperty({}, \'text\', { value: { type: \'string\' } })', 'parameters must contain only own enumerable string keys'],
    ['parameters: { text: 42 }', 'parameters.text must be a ParameterSchemaSpec property object'],
    ['parameters: { text: Object.defineProperty({ type: \'string\' }, \'minimum\', { value: 1 }) }', 'parameters.text must contain only own enumerable string keys'],
    ['parameters: { text: { type: \'string\', [Symbol(\'hidden\')]: true } }', 'parameters.text must contain only own enumerable string keys'],
    ['parameters: { text: { type: \'str\' } }', 'parameters.text must declare a valid type: \'string\' | \'number\' | \'integer\' | \'boolean\' | \'null\' | \'object\' | \'array\' | \'json\' (got "str")'],
    ['parameters: { text: { type: \'string\', required: \'yes\' } }', 'parameters.text.required must be true when present'],
    ['parameters: { text: { type: \'string\', properties: {} } }', 'parameters.text.properties is not supported by the unified schema DSL'],
    ['parameters: { text: { type: \'string\', items: { type: \'string\' } } }', 'parameters.text.items is not supported by the unified schema DSL'],
    ['parameters: { text: { type: \'object\', properties: {} } }', 'parameters.text.additionalProperties must be explicitly true or false'],
    ['parameters: { text: { type: \'object\', additionalProperties: \'no\' } }', 'parameters.text.additionalProperties must be explicitly true or false'],
    ['parameters: { type: \'object\' }', 'parameters.properties must be an object of schemas'],
    ['parameters: { type: \'object\', properties: {}, additionalProperties: false }', 'parameters.additionalProperties must be true or omitted'],
    ['parameters: { type: \'object\', properties: {}, required: \'text\' }', 'parameters.required must be an array of declared property names'],
    ['parameters: { type: \'object\', properties: {}, required: undefined }', 'parameters.required must be an array of declared property names'],
    ['parameters: { type: \'object\', properties: {}, required: [42] }', 'parameters.required must be an array of declared property names'],
    ['parameters: (() => { const required = []; required.length = 1; return { type: \'object\', properties: {}, required } })()', 'parameters.required must be an array of declared property names'],
    ['parameters: (() => { const required = []; required.length = 1; required.extra = true; return { type: \'object\', properties: {}, required } })()', 'parameters.required must be an array of declared property names'],
    ['parameters: (() => { class Names extends Array { *[Symbol.iterator]() {} }; const required = new Names(); required[0] = \'text\'; required.length = 1; return { type: \'object\', properties: { text: { type: \'string\' } }, required } })()', 'parameters.required must be an array of declared property names'],
    ['parameters: { type: \'object\', properties: {}, required: [\'text\'] }', 'parameters.required names undeclared property "text"'],
    ['parameters: { type: \'object\', properties: { text: { type: \'string\', required: true } } }', 'parameters.text.required belongs to the containing raw object schema'],
    ['parameters: { type: \'object\', properties: { text: { oneOf: \'bad\' } } }', 'parameters.text.oneOf must contain at least two schemas'],
    ['parameters: { type: \'object\', properties: { text: { type: \'json\' } } }', 'parameters.text must declare a valid type'],
    ['parameters: { type: \'object\', properties: { cfg: { type: \'object\', additionalProperties: \'no\' } } }', 'parameters.cfg.additionalProperties must be a boolean'],
    ['parameters: { type: \'object\', properties: { cfg: { type: \'object\', properties: 42 } } }', 'parameters.cfg.properties must be an object of schemas'],
    ['parameters: { type: \'object\', properties: { cfg: { type: \'object\', required: [\'label\'] } } }', 'parameters.cfg.required names undeclared property "label"'],
    ['parameters: { type: \'object\', properties: { cfg: { type: \'object\', required: undefined } } }', 'parameters.cfg.required must be an array of declared property names'],
    ['parameters: { value: { oneOf: \'bad\' } }', 'parameters.value.oneOf must contain at least two schemas'],
    ['parameters: { value: { oneOf: new (class Branches extends Array {})({ type: \'string\' }, { type: \'null\' }) } }', 'parameters.value.oneOf must contain at least two schemas'],
    ['parameters: { value: { oneOf: Object.assign([{ type: \'string\' }, { type: \'null\' }], { extra: true }) } }', 'parameters.value.oneOf must contain at least two schemas'],
    ['parameters: { value: { type: \'string\', enum: \'bad\' } }', 'enum must be a non-empty array'],
    ['parameters: { value: { type: \'string\', enum: new (class Values extends Array {})(\'a\', \'b\') } }', 'parameters.value.enum must be a non-empty array'],
    ['parameters: { value: { type: \'json\', default: -0 } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: Infinity } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: () => 1 } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: (() => { const v = {}; v.self = v; return v })() } }', 'parameters.value.default.self must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: Array(2) } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: Object.assign([1], { extra: true }) } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: (() => { const v = Array(1); v.extra = true; return v })() } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: Object.defineProperty({}, \'hidden\', { value: true }) } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: { [Symbol(\'hidden\')]: true } } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: new (class DefaultValue { constructor() { this.ok = true } })() } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: new (class DefaultList extends Array {})() } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: { value: { type: \'json\', default: new Date(0) } }', 'parameters.value.default must be lossless JSON data'],
    ['parameters: (() => { const p = Object.create(null); const C = function C() {}; Object.defineProperty(C, \'name\', { value: \'Object\' }); C.prototype = p; Object.defineProperty(p, \'constructor\', { value: C }); return Object.create(p) })()', 'must be a ParameterSchemaSpec object'],
    ['parameters: (() => { const p = Object.create(null); const C = function C() {}; Object.defineProperty(C, \'name\', { value: \'Object\' }); C.prototype = p; const r = Proxy.revocable(C, {}); Object.defineProperty(p, \'constructor\', { value: r.proxy }); r.revoke(); return Object.create(p) })()', 'must be a ParameterSchemaSpec object'],
    ['parameters: Object.create(Object.create(null))', 'must be a ParameterSchemaSpec object'],
  ])('rejects a malformed ParameterSchemaSpec (%s) with a teaching error', async (parameters, message) => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'bad-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'bad_schema_tool',
              description: 'bad',
              ${parameters},
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(message)
  })

  it.each([
    [
      `
        const parameters = {}
        const item = { type: 'array' }
        item.items = item
        parameters.item = item
      `,
      'parameters.item.items is circular',
    ],
    [
      `
        const parameters = {}
        const item = { type: 'object', additionalProperties: true, properties: parameters }
        parameters.item = item
      `,
      'parameters.item.properties is circular',
    ],
  ])('rejects circular sandbox schemas without exhausting the call stack', async (declaration, message) => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'circular-schema',
          inject: ['tools'],
          apply(ctx) {
            ${declaration}
            harness.registerTool(ctx, harness.defineTool({
              name: 'circular_schema_tool',
              description: 'circular',
              parameters,
              async execute() { return [] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(message)
  })

  it('preserves literal __proto__ keys in sandbox schemas and annotations', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'proto-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'proto_schema_tool',
              description: 'literal JSON keys',
              parameters: {
                ['__proto__']: { type: 'string', required: true },
                value: { type: 'json', default: { ['__proto__']: { safe: true } } },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            }))
          },
        }
      `,
    })

    expect(result.isError).toBe(false)
    const parameters = ctx.tools.schemas().find(schema => schema.name === 'proto_schema_tool')!.parameters as {
      properties: Record<string, { default?: unknown }>
      required?: string[]
    }
    expect(Object.hasOwn(parameters.properties, '__proto__')).toBe(true)
    expect(parameters.required).toContain('__proto__')
    const defaultValue = parameters.properties.value!.default as Record<string, unknown>
    expect(Object.hasOwn(defaultValue, '__proto__')).toBe(true)
    expect(defaultValue.__proto__).toEqual({ safe: true })
  })

  it('accepts a nested object/array ParameterSchemaSpec (the DSL recursion)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'nested-schema',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'nested_schema_tool',
              description: 'nested',
              parameters: {
                item: { type: 'object', additionalProperties: true, required: true, properties: { label: { type: 'string', required: true } } },
                tags: { type: 'array', items: { type: 'string' } },
              },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) { return [{ type: 'text', text: args.item.label }] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    const echoed = await call(ctx, 'nested_schema_tool', { item: { label: 'ok' }, tags: ['a'] })
    expect(text(echoed)).toBe('ok')
  })

  it('rejects raw dynamic ctx.tools.register calls that bypass harness helpers', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'raw-register',
          inject: ['tools'],
          apply(ctx) {
            ctx.tools.register({
              name: 'raw_dynamic_tool',
              description: 'raw',
              parameters: { type: 'object', properties: {} },
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            })
          },
        }
      `,
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('dynamic tool registration must use a tool returned by harness.defineTool')
    expect(ctx.tools.get('raw_dynamic_tool')).toBeUndefined()
  })

  it('guards the registry reached through ctx.get(\'tools\') identically', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'raw-register-get',
          apply(ctx) {
            ctx.get('tools').register({ name: 'raw_via_get', description: 'raw', parameters: {}, async execute() { return [] } })
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('dynamic tool registration must use a tool returned by harness.defineTool')
    expect(ctx.tools.get('raw_via_get')).toBeUndefined()
  })

  it('passes non-register registry members through the guard with correct binding', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'schema-reader',
          inject: ['tools'],
          apply(ctx) {
            console.log('sees', ctx.tools.schemas().length, 'tools; mount is', typeof ctx.tools.get('cordis_mount'))
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    expect(log).toHaveBeenCalledWith('[cordis:dyn-1]', 'sees', 3, 'tools; mount is', 'object')
  })

  it('keeps a plugin with unsatisfied inject mounted as pending and names what it waits for', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'waiter\', inject: [\'no-such-service\'], apply(ctx) {} }',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected pending cordis_mount success')
    expect(result.value).toEqual({
      id: 'dyn-1',
      pluginName: 'waiter',
      state: 'pending',
      provides: [],
      waitingFor: ['no-such-service'],
    })
    expect(text(result)).toBe('Temporary Plugin dyn-1 is pending (plugin "waiter"; missing services: no-such-service; available until unmounted or DSH restarts).')
    // Unmounting a pending mount works like any other.
    const unmounted = await call(ctx, 'cordis_unmount', { id: 'dyn-1' })
    expect(unmounted.isError).toBe(false)
  })

  it('rejects code that throws, leaving nothing mounted', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: 'throw new Error(\'boom in sandbox\')' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('boom in sandbox')
    expect(text(await call(ctx, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })

  it('passes non-Error and null throws through untouched (no SyntaxError misclassification)', async () => {
    const ctx = await setup()
    const primitive = await call(ctx, 'cordis_mount', { code: 'throw \'plain-string-throw\'' })
    expect(primitive.isError).toBe(true)
    expect(text(primitive)).toContain('plain-string-throw')
    const nullish = await call(ctx, 'cordis_mount', { code: 'throw null' })
    expect(nullish.isError).toBe(true)
  })

  it('rejects code that does not return a plugin', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: 'return 42' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must `return` a Plugin')
  })

  it('answers a missing return with the two valid plugin forms', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: 'const plugin = (ctx) => {}' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('did you forget `return`?')
  })

  it('disposes a plugin whose apply throws, and reports the error', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'broken\', apply(ctx) { throw new Error(\'apply exploded\') } }',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('apply exploded')
    expect(text(await call(ctx, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })

  it('rolls back a plugin that collides with an existing tool name, keeping the original tool intact', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'usurper',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'cordis_mount',
              description: 'dup',
              parameters: {},
              ${CONTENT_OUTPUT_CODE}
              async execute() { return [] },
            }))
          },
        }
      `,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('already registered')
    expect(text(result)).toContain('first cordis_unmount')
    // The original cordis_mount still dispatches — the failed fiber is gone.
    const retry = await call(ctx, 'cordis_mount', { code: LISTENER_CODE })
    expect(retry.isError).toBe(false)
  })

  it('isolates sandbox globals: no process/Buffer, and globalThis writes do not leak to the host', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: `
        globalThis.__cordis_tool_leak = 'leaked'
        return { name: 'probe-' + typeof process + '-' + typeof Buffer, apply(ctx) {} }
      `,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('plugin "probe-undefined-undefined"')
    expect((globalThis as Record<string, unknown>).__cordis_tool_leak).toBeUndefined()
  })

  it.each([
    ['require(\'fs\')', 'require is not available in the temporary Plugin sandbox', 'inject: [\'fs\']'],
    ['setTimeout(() => {}, 5)', 'setTimeout is not available in the temporary Plugin sandbox', 'ctx.setTimeout'],
    ['fetch(\'https://example.com\')', 'fetch is not available in the temporary Plugin sandbox', 'ctx.web'],
  ])('traps the Node API call %s with a redirect to the cordis alternative', async (invocation, trapMessage, redirect) => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: `${invocation}\nreturn (ctx) => {}` })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(trapMessage)
    expect(text(result)).toContain(redirect)
    expect(text(await call(ctx, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })

  it('lets a mounted plugin schedule through the cordis timer service (inject: [\'timer\'])', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'ticker',
          inject: ['timer'],
          apply(ctx) {
            ctx.setTimeout(() => console.log('tick'), 10)
          },
        }
      `,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('is running')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(log).toHaveBeenCalledWith('[cordis:dyn-1]', 'tick')
  })

  it('provides btoa/atob and the tagged console variants inside the sandbox', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await call(ctx, 'cordis_mount', {
      code: `
        console.warn('warned')
        console.error('errored')
        const round = atob(btoa('hi'))
        const bytes = new TextEncoder().encode(round)
        return { name: 'codec-' + new TextDecoder().decode(bytes), apply(ctx) { console.log('applied', typeof ctx.on) } }
      `,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('plugin "codec-hi"')
    expect(log).toHaveBeenCalledWith('[cordis:dyn-1]', 'warned')
    expect(log).toHaveBeenCalledWith('[cordis:dyn-1]', 'applied', 'function')
    expect(error).toHaveBeenCalledWith('[cordis:dyn-1]', 'errored')
  })

  it('answers TypeScript syntax in the plain-JS sandbox with the fix', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', {
      code: 'return { name: \'ts\' as const, apply(ctx) {} }',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('plain JavaScript, not TypeScript')
  })

  it('surfaces the offending line + caret and the bracket-balance hint on a syntax error', async () => {
    const ctx = await setup()
    // The canonical model mistake: closing the returned object with `});` as
    // if it were a callback argument. The word "as" in a STRING elsewhere must
    // not trigger the TypeScript hint — the heuristic reads the failing line.
    const result = await call(ctx, 'cordis_mount', {
      code: 'const note = \'treat pattern as regex\'\nreturn {\n  name: \'oops\',\n  apply(ctx) {}\n});',
    })
    expect(result.isError).toBe(true)
    const message = text(result)
    expect(message).toContain('failed to parse')
    expect(message).toContain('});')
    expect(message).toContain('^')
    expect(message).toContain('BODY of an async function')
    expect(message).not.toContain('TypeScript')
  })

  it('syntaxErrorContext falls back to String(error) when the stack has no vm prelude', () => {
    const doctored = new SyntaxError('boom')
    delete (doctored as { stack?: string }).stack
    expect(syntaxErrorContext(doctored)).toBe('SyntaxError: boom')
    const plain = new SyntaxError('bang')
    plain.stack = 'not-a-vm-stack'
    expect(syntaxErrorContext(plain)).toBe('SyntaxError: bang')
  })

  it('handles a runtime-thrown SyntaxError (no source-line prelude) with the generic hint', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'cordis_mount', { code: 'throw new SyntaxError(\'user-crafted\')' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('failed to parse')
    expect(text(result)).toContain('user-crafted')
  })

  it('honors the configured vmTimeoutMs for the synchronous portion', async () => {
    const ctx = await setup({ vmTimeoutMs: 50 })
    const result = await call(ctx, 'cordis_mount', { code: 'while (true) {}' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/timed? ?out/i)
    expect(text(await call(ctx, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })

  it('makes instanceof inside the sandbox see BOTH realms (patched vm constructors, host untouched)', async () => {
    // The args a tool's execute receives are HOST-realm objects; without the dual-realm
    // Symbol.hasInstance prelude, `args.items instanceof Array` in sandbox code is silently
    // false.
    const ctx = await setup()
    await call(ctx, 'cordis_mount', {
      code: `
        return {
          name: 'probe-instanceof',
          inject: ['tools'],
          apply(ctx) {
            harness.registerTool(ctx, harness.defineTool({
              name: 'probe_instanceof',
              description: 'report instanceof checks across realms',
              parameters: { items: { type: 'array', required: true, items: { type: 'string' } } },
              ${CONTENT_OUTPUT_CODE}
              async execute(args) {
                const checks = {
                  hostArray: args.items instanceof Array,
                  hostObject: args instanceof Object,
                  vmArray: [] instanceof Array,
                  vmObject: ({}) instanceof Object,
                }
                return [{ type: 'text', text: JSON.stringify(checks) }]
              },
            }))
          },
        }
      `,
    })
    const probed = await call(ctx, 'probe_instanceof', { items: ['a'] })
    expect(probed.isError).toBe(false)
    expect(JSON.parse(text(probed))).toEqual({ hostArray: true, hostObject: true, vmArray: true, vmObject: true })
    // The host realm's constructors keep their default instanceof: no own
    // Symbol.hasInstance was added to them.
    expect(Object.getOwnPropertySymbols(Object)).not.toContain(Symbol.hasInstance)
    expect(Object.getOwnPropertySymbols(Array)).not.toContain(Symbol.hasInstance)
  })
})
