import { describe, expect, it } from 'vitest'
import { computeFingerprint, detectDrift } from '../src/fingerprint.ts'

const SYSTEM = 'You are a helpful assistant.'
const TOOLS = [
  { name: 'bash', description: 'Run a shell command' },
  { name: 'read', description: 'Read a file' },
  { name: 'grep', description: 'Search text' },
]
const CONFIG = '{"provider":"mock","model":"m"}'

describe('computeFingerprint', () => {
  it('is idempotent for identical inputs', () => {
    const a = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    const b = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    expect(a).toEqual(b)
    expect(a.combinedSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the system hash only when the system text changes', () => {
    const base = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    const changed = computeFingerprint(`${SYSTEM} Extra guidance.`, TOOLS, CONFIG)
    expect(changed.systemSha256).not.toBe(base.systemSha256)
    expect(changed.toolsSha256).toBe(base.toolsSha256)
    expect(changed.configSha256).toBe(base.configSha256)
    expect(changed.combinedSha256).not.toBe(base.combinedSha256)
  })

  it('changes the tools hash only when the tool definitions change', () => {
    const base = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    const changed = computeFingerprint(SYSTEM, [...TOOLS, { name: 'write', description: 'Write a file' }], CONFIG)
    expect(changed.toolsSha256).not.toBe(base.toolsSha256)
    expect(changed.systemSha256).toBe(base.systemSha256)
    expect(changed.configSha256).toBe(base.configSha256)
  })

  it('is order-independent for tool definitions (sorted before hashing)', () => {
    const a = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    const shuffled = computeFingerprint(SYSTEM, [TOOLS[2]!, TOOLS[0]!, TOOLS[1]!], CONFIG)
    expect(a.toolsSha256).toBe(shuffled.toolsSha256)
  })

  it('changes the config hash only when the config text changes', () => {
    const base = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    const changed = computeFingerprint(SYSTEM, TOOLS, '{"provider":"mock","model":"m2"}')
    expect(changed.configSha256).not.toBe(base.configSha256)
    expect(changed.systemSha256).toBe(base.systemSha256)
    expect(changed.toolsSha256).toBe(base.toolsSha256)
  })

  it('treats an empty tool list deterministically', () => {
    const a = computeFingerprint(SYSTEM, [], CONFIG)
    const b = computeFingerprint(SYSTEM, undefined, CONFIG)
    expect(a).toEqual(b)
  })
})

describe('detectDrift', () => {
  const base = computeFingerprint(SYSTEM, TOOLS, CONFIG)

  it('returns null when nothing changed', () => {
    expect(detectDrift(base, computeFingerprint(SYSTEM, TOOLS, CONFIG))).toBeNull()
  })

  it('attributes a system change', () => {
    const drift = detectDrift(base, computeFingerprint('Different system', TOOLS, CONFIG))!
    expect(drift.systemChanged).toBe(true)
    expect(drift.toolsChanged).toBe(false)
    expect(drift.configChanged).toBe(false)
    expect(drift.message).toContain('system prompt')
  })

  it('attributes a tools change', () => {
    const drift = detectDrift(base, computeFingerprint(SYSTEM, [TOOLS[0]!], CONFIG))!
    expect(drift.toolsChanged).toBe(true)
    expect(drift.systemChanged).toBe(false)
    expect(drift.message).toContain('tool definitions')
  })

  it('attributes a config change', () => {
    const drift = detectDrift(base, computeFingerprint(SYSTEM, TOOLS, '{"provider":"other"}'))!
    expect(drift.configChanged).toBe(true)
    expect(drift.systemChanged).toBe(false)
    expect(drift.message).toContain('config')
  })

  it('attributes multiple sources at once', () => {
    const drift = detectDrift(base, computeFingerprint('New system', [], '{"provider":"other"}'))!
    expect(drift.systemChanged).toBe(true)
    expect(drift.toolsChanged).toBe(true)
    expect(drift.configChanged).toBe(true)
  })

  it('combined hash equality is the no-drift gate', () => {
    const same = computeFingerprint(SYSTEM, TOOLS, CONFIG)
    expect(same.combinedSha256).toBe(base.combinedSha256)
  })
})
