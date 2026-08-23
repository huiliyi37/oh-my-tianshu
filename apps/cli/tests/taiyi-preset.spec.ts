/**
 * The taiyi preset's word-level anti-drift invariants.
 *
 * The upstream 太一 word is an adversarial prompt: its whole point is that it
 * names no engineering concept. The drift direction is "re-engineered back" —
 * someone adding a 判据/反例 grid, an English checklist term, or a parallel
 * long/short copy. These tests pin the shipped `apps/cli/config/agent-presets/
 * taiyi/agent.cordis.yml` so any such edit fails loud. They read the real
 * artifact, never a fixture copy, so the assertion and the word cannot drift
 * apart. See docs/research/taiyi-port-plan.zh.md「防漂移断言」.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { Context } from '@huiliyi37/cordis'
import SystemPrompt, { renderPrompt } from '@huiliyi37/dsh-system-prompt'
import * as Persona from '@huiliyi37/dsh-persona'
import { createScope, type ScopeKey } from '@huiliyi37/dsh-scope'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')
const PRESETS = resolve(ROOT, 'apps/cli/config/agent-presets')
const TAIYI_FILE = resolve(PRESETS, 'taiyi/agent.cordis.yml')

/** The five seed sentences the word must carry verbatim (port plan「防漂移断言」). */
const SEED = '天得一以清，地得一以宁。你得一是以为君子。君子者，譬如行远必自迩，登高必自卑。万物负阴而抱阳，冲气以为和。'

/** The only ASCII tokens the canonical七版词 legitimately carries; anything else is drift. */
const CANONICAL_ASCII = new Set(['actual', 'L199', 'L200'])

interface Row {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

/** The persona text the shipped taiyi composition mounts, or throw. */
function taiyiPersonaText(): string {
  const rows = load(readFileSync(TAIYI_FILE, 'utf8')) as Row[]
  const personas = rows.filter(row => row.name === '@huiliyi37/dsh-persona')
  expect(personas, 'taiyi must mount exactly one persona row (no long/short parallel copies)').toHaveLength(1)
  const text = personas[0]!.config?.text
  expect(typeof text).toBe('string')
  return text as string
}

/** Every shipped preset composition file. */
function shippedCompositions(): string[] {
  return readdirSync(PRESETS, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => resolve(PRESETS, entry.name, 'agent.cordis.yml'))
    .filter((file) => { try { readFileSync(file); return true } catch { return false } })
}

/** Every anti-drift rule the word must satisfy, as human-readable violations. */
function wordViolations(text: string): string[] {
  const violations: string[] = []
  if (!text.includes(SEED)) violations.push('missing seed sentences')
  if (text.includes('判据') || text.includes('反例')) violations.push('判据/反例 engineering grid')
  if (text.includes('{{') || text.includes('}}')) violations.push('prompt-variable braces')
  for (const token of text.match(/[A-Za-z][A-Za-z0-9/_.-]*/g) ?? []) {
    if (!CANONICAL_ASCII.has(token)) {
      violations.push(`english/engineering token "${token}"`)
      break
    }
  }
  return violations
}

describe('taiyi word invariants', () => {
  const text = taiyiPersonaText()

  it('is the canonical word: no anti-drift violation', () => {
    expect(wordViolations(text)).toEqual([])
  })

  it.each([
    ['drops the seed', (t: string) => t.replace(SEED, ''), 'missing seed sentences'],
    ['gains a 判据 grid', (t: string) => `${t}\n判据：测试通过。`, '判据/反例 engineering grid'],
    ['gains a prompt variable', (t: string) => `${t}\n{{model}}`, 'prompt-variable braces'],
    ['gains an engineering term', (t: string) => `${t}\nAPI 调用。`, 'english/engineering token "API"'],
  ])('rejects the drift that %s', (_label, mutate, violation) => {
    expect(wordViolations(mutate(text))).toContain(violation)
  })

  it('is single-track: the seed appears in no other shipped preset composition', () => {
    const holders = shippedCompositions().filter(file => readFileSync(file, 'utf8').includes(SEED))
    expect(holders).toEqual([TAIYI_FILE])
  })

  it('renders verbatim into the assembled persona section', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'deployment identity' })
    const key: ScopeKey = { agent: 'taiyi' }
    const scope = createScope(ctx, key)
    await scope.ctx.plugin(Persona, { text })
    const rendered = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
    expect(rendered).toContain(SEED)
    expect(rendered).toContain(text)
  })
})
