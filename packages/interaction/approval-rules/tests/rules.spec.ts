import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendRule,
  loadRules,
  matchRule,
  mergeRules,
  parseRules,
  removeRuleAtFile,
  writeRules,
} from '@huiliyi37/dsh-approval-rules'
import type { FileRule } from '@huiliyi37/dsh-approval-rules'

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('parseRules', () => {
  it('parses a valid rule list', () => {
    expect(parseRules('- tool: echo\n  pattern: "*"\n  decision: allow\n', 'user.yaml')).toEqual([
      { tool: 'echo', pattern: '*', decision: 'allow' },
    ])
  })

  it('fails loud on malformed YAML', () => {
    expect(() => parseRules('- tool: echo\n  pattern: \n  decision: allow\n  bad: [\n', 'user.yaml'))
      .toThrow(/malformed YAML in "user\.yaml"/)
  })

  it('fails loud when the top level is not a list', () => {
    expect(() => parseRules('tool: echo\n', 'user.yaml')).toThrow(/must contain a YAML list/)
  })

  it('fails loud on an illegal decision', () => {
    expect(() => parseRules('- tool: echo\n  pattern: "*"\n  decision: maybe\n', 'user.yaml'))
      .toThrow(/illegal decision "maybe"/)
  })

  it('fails loud on an empty tool or pattern', () => {
    expect(() => parseRules('- tool: "  "\n  pattern: "*"\n  decision: allow\n', 'user.yaml'))
      .toThrow(/empty or missing "tool"/)
    expect(() => parseRules('- tool: echo\n  pattern: ""\n  decision: allow\n', 'user.yaml'))
      .toThrow(/empty or missing "pattern"/)
  })
})

describe('loadRules', () => {
  it('returns an empty list for a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    expect(await loadRules(join(dir, 'nope.yaml'))).toEqual([])
  })

  it('round-trips through writeRules', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    const file = join(dir, 'permissions.yaml')
    const rules: FileRule[] = [
      { tool: 'echo', pattern: '*', decision: 'allow' },
      { tool: 'bash', pattern: 'git*', decision: 'deny' },
    ]
    await writeRules(file, rules)
    expect(await loadRules(file)).toEqual(rules)
  })

  it('propagates a load failure from a malformed file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    const file = join(dir, 'permissions.yaml')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '- tool: echo\n  pattern: [\n')
    await expect(loadRules(file)).rejects.toThrow(/malformed YAML/)
  })
})

describe('mergeRules and matchRule', () => {
  it('merges user-first and stamps the owning layer', () => {
    const rules = mergeRules(
      [{ tool: 'echo', pattern: '*', decision: 'allow' }],
      [{ tool: 'bash', pattern: 'git*', decision: 'deny' }],
    )
    expect(rules).toEqual([
      { tool: 'echo', pattern: '*', decision: 'allow', layer: 'user' },
      { tool: 'bash', pattern: 'git*', decision: 'deny', layer: 'project' },
    ])
  })

  it('returns the first hit: an earlier user rule wins over a later project rule', () => {
    const rules = mergeRules(
      [{ tool: 'echo', pattern: '*', decision: 'deny' }],
      [{ tool: 'echo', pattern: '*', decision: 'allow' }],
    )
    expect(matchRule(rules, 'echo', 'anything')?.index).toBe(0)
    expect(matchRule(rules, 'echo', 'anything')?.rule.decision).toBe('deny')
  })

  it('matches only the exact tool', () => {
    const rules = mergeRules([{ tool: 'echo', pattern: '*', decision: 'allow' }], [])
    expect(matchRule(rules, 'echo', 'x')).toBeDefined()
    expect(matchRule(rules, 'bash', 'x')).toBeUndefined()
  })

  it('returns undefined when no rule matches the arguments', () => {
    const rules = mergeRules([{ tool: 'echo', pattern: 'other', decision: 'allow' }], [])
    expect(matchRule(rules, 'echo', 'this')).toBeUndefined()
  })
})

describe('appendRule and removeRuleAtFile', () => {
  it('appends to a non-existent project file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    const file = join(dir, 'project-permissions.yaml')
    await appendRule(file, { tool: 'echo', pattern: '*', decision: 'deny' })
    expect(JSON.parse(JSON.stringify(await loadRules(file)))).toEqual([
      { tool: 'echo', pattern: '*', decision: 'deny' },
    ])
    const source = await readFile(file, 'utf8')
    expect(source).toContain('deny')
    expect(source).toContain('echo')
  })

  it('removes a rule by layer-local index', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    const file = join(dir, 'permissions.yaml')
    await writeRules(file, [
      { tool: 'echo', pattern: '*', decision: 'allow' },
      { tool: 'bash', pattern: 'git*', decision: 'deny' },
    ])
    await removeRuleAtFile(file, 0)
    expect(await loadRules(file)).toEqual([
      { tool: 'bash', pattern: 'git*', decision: 'deny' },
    ])
  })

  it('rejects an out-of-range remove index', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-approval-rules-'))
    const file = join(dir, 'permissions.yaml')
    await writeRules(file, [{ tool: 'echo', pattern: '*', decision: 'allow' }])
    await expect(removeRuleAtFile(file, 1)).rejects.toThrow(/out of range/)
  })
})
