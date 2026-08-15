import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@huiliyi37/cordis'
import { describe, expect, it } from 'vitest'
import SkillService from '@huiliyi37/dsh-skill'
import * as SkillBadge from '@huiliyi37/dsh-skill-badge'

describe('dsh-skill-badge', () => {
  it('registers and disposes the bundled badge skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillService)
    const fiber = await ctx.plugin(SkillBadge)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'dsh-badge',
      description: 'Add the official “powered by tianshu” badge to documents, pull requests, merge requests, and other content produced with Tianshu Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a tianshu badge, powered-by-tianshu attribution, or a reusable tianshu badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('dsh-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s rendered dimensions and aspect ratio')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships the Shields.io badge with the project link', async () => {
    const content = await readFile(new URL('../assets/dsh-badge.md', import.meta.url), 'utf8')
    expect(content).toContain('https://img.shields.io/badge/powered_by-tianshu-4D6BFE?style=flat-square')
    expect(content).toContain('https://github.com/huiliyi37/oh-my-tianshu')
  })
})
