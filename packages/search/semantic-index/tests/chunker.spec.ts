import { describe, expect, it } from 'vitest'
import { chunkByDefinitions, familyForExt, windowChunks } from '../src/chunker.ts'

describe('familyForExt', () => {
  it('maps known extensions to a definition family', () => {
    expect(familyForExt('.ts')).toBe('ts')
    expect(familyForExt('.py')).toBe('py')
    expect(familyForExt('.go')).toBe('go')
  })

  it('returns null for languages without definition patterns', () => {
    expect(familyForExt('.md')).toBeNull()
    expect(familyForExt('.json')).toBeNull()
  })
})

describe('chunkByDefinitions', () => {
  it('splits a TS file at function/class boundaries', () => {
    const content = [
      'import { x } from "./y"',
      '',
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export class Beta {',
      '  method() {}',
      '}',
    ].join('\n')
    const chunks = chunkByDefinitions(content, '.ts')
    // Preamble (import) folds into the first definition; Beta is its own chunk.
    expect(chunks.length).toBe(2)
    expect(chunks[0]!.text).toContain('alpha')
    expect(chunks[1]!.text).toContain('Beta')
    expect(chunks[1]!.startLine).toBe(7)
    expect(chunks[1]!.endLine).toBe(9)
  })

  it('splits Python files at def/class boundaries', () => {
    const content = [
      'import os',
      '',
      'def helper():',
      '    return 1',
      '',
      'class Handler:',
      '    pass',
    ].join('\n')
    const chunks = chunkByDefinitions(content, '.py')
    expect(chunks[0]!.text).toContain('helper')
    expect(chunks[1]!.text).toContain('Handler')
  })

  it('falls back to line windows for languages without definition patterns', () => {
    const content = Array.from({ length: 50 }, (_, i) => `# heading ${i}`).join('\n')
    const chunks = chunkByDefinitions(content, '.md')
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('sub-windows a definition larger than the soft cap', () => {
    const lines = ['export function big() {', ...Array.from({ length: 150 }, (_, i) => `  const v${i} = ${i}`), '}']
    const chunks = chunkByDefinitions(lines.join('\n'), '.ts')
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(120)
    }
  })

  it('reports 1-based inclusive line ranges', () => {
    const content = [
      'export function alpha() {',
      '  return 1',
      '}',
      '',
      'export function beta() {',
      '  return 2',
      '}',
    ].join('\n')
    const chunks = chunkByDefinitions(content, '.ts')
    expect(chunks[0]!.startLine).toBe(1)
    // The chunk runs to the line before the next definition boundary (includes the closing brace and the blank line).
    expect(chunks[0]!.endLine).toBe(4)
    expect(chunks[1]!.startLine).toBe(5)
    expect(chunks[1]!.endLine).toBe(7)
  })
})

describe('windowChunks', () => {
  it('produces 1-based line ranges with overlap', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
    const chunks = windowChunks(lines.join('\n'), 20, 4)
    expect(chunks[0]!.startLine).toBe(1)
    expect(chunks[0]!.endLine).toBe(20)
    expect(chunks[1]!.startLine).toBe(17) // 20 - 4 + 1
  })

  it('returns no chunks for blank content', () => {
    expect(windowChunks('\n\n\n')).toEqual([])
  })
})
