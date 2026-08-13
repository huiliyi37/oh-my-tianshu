import { describe, expect, it } from 'vitest'
import Loader from '@cordisjs/plugin-loader'
import * as tool from '../src/index.ts'
import { setup } from './helpers.ts'

/**
 * Export-shape and registration surface: the namespace-plugin contract the
 * real Loader path depends on, the registered tool set, and the Config
 * validator's defaults and rejections.
 */

describe('export shape', () => {
  it('has no default export, and survives the real Loader unwrapExports', () => {
    // A stray `export default` would make `unwrapExports` (`exports.default ??
    // exports`) collapse the module to the bare function and DROP `inject`,
    // crashing at real load (docs/postmortem/0001). Assert directly AND through
    // the real unwrap so adding `export default apply` fails here.
    expect('default' in tool).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-cordis')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(typeof unwrapped.Config).toBe('function')
  })
})

describe('tool registration', () => {
  it('registers the three cordis tools with the documented schemas', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining(['cordis_inspect', 'cordis_mount', 'cordis_unmount']))
    expect(names).not.toEqual(expect.arrayContaining(['cordis_try', 'cordis_stop']))
    const inspect = ctx.tools.schemas().find(schema => schema.name === 'cordis_inspect')!
    const props = (inspect.parameters as { properties: Record<string, { enum?: string[]; type?: string }> }).properties
    expect(props.what?.enum).toEqual(['services', 'plugins', 'tools', 'temporary', 'api', 'events'])
    expect(props.name?.type).toBe('string')
  })
})

describe('Config', () => {
  it('defaults vmTimeoutMs to 5000', () => {
    expect(new tool.Config()).toEqual({ vmTimeoutMs: 5000 })
  })

  it('rejects a non-positive vmTimeoutMs at validation time (misconfiguration fails loud)', () => {
    expect(() => new tool.Config({ vmTimeoutMs: 0 })).toThrow()
    expect(() => new tool.Config({ vmTimeoutMs: -1 })).toThrow()
  })
})
