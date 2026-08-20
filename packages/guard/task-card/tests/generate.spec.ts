/**
 * Task-card generator contract: LLM markdown output parsing, the semantic
 * template fallback, final rendering with the verbatim original, and the
 * idempotence marker. All pure functions — no context, no IO.
 */

import { describe, expect, it } from 'vitest'
import { hasTaskCard, parseLlmCard, renderTaskCard, templateCard } from '../src/generate.ts'

const ORIGINAL = '帮我重构 src/auth.ts 的登录逻辑\n让它支持 refresh token'

describe('parseLlmCard', () => {
  it('parses a complete card: title, goal, constraints, acceptance', () => {
    const text = [
      '# 重构登录逻辑支持 refresh token',
      '',
      '## 目标',
      '重写 src/auth.ts 的登录流程，加入 refresh token 轮换。',
      '',
      '## 约束',
      '- 不改变现有 API 签名',
      '- 保持向后兼容',
      '',
      '## 验收',
      '- pnpm test 全绿',
      '- refresh 后旧 token 失效',
    ].join('\n')
    expect(parseLlmCard(text)).toEqual({
      title: '重构登录逻辑支持 refresh token',
      goal: '重写 src/auth.ts 的登录流程，加入 refresh token 轮换。',
      constraints: ['不改变现有 API 签名', '保持向后兼容'],
      acceptance: ['pnpm test 全绿', '- refresh 后旧 token 失效'.replace('- ', '')],
    })
  })

  it('omits constraints and acceptance when absent', () => {
    const text = [
      '# 简单任务',
      '',
      '## 目标',
      '做一件事。',
    ].join('\n')
    expect(parseLlmCard(text)).toEqual({
      title: '简单任务',
      goal: '做一件事。',
      constraints: [],
      acceptance: [],
    })
  })

  it('returns undefined when the title is missing', () => {
    const text = [
      '## 目标',
      '做一件事。',
    ].join('\n')
    expect(parseLlmCard(text)).toBeUndefined()
  })

  it('returns undefined when the goal section is missing or empty', () => {
    const text = [
      '# 只有标题',
      '',
      '## 约束',
      '- 一些约束',
    ].join('\n')
    expect(parseLlmCard(text)).toBeUndefined()
  })

  it('returns undefined on non-markdown noise', () => {
    expect(parseLlmCard('随便说点什么')).toBeUndefined()
    expect(parseLlmCard('')).toBeUndefined()
  })
})

describe('templateCard', () => {
  it('derives a title from the first line, capped at the budget', () => {
    const longFirstLine = '这一行非常长用来验证标题截断逻辑是否正确生效超出四十个字符上限的部分应该被截断并追加省略号'
    const card = templateCard(`${longFirstLine}\n第二行`, 40)
    expect(card.title.length).toBeLessThanOrEqual(43)
    expect(card.title.endsWith('…')).toBe(true)
    expect(card.goal).toBe(`${longFirstLine}\n第二行`)
    expect(card.constraints).toEqual([])
    expect(card.acceptance).toEqual([])
  })

  it('keeps the whole original as the goal', () => {
    const card = templateCard(ORIGINAL)
    expect(card.title).toBe('帮我重构 src/auth.ts 的登录逻辑')
    expect(card.goal).toBe(ORIGINAL)
  })
})

describe('renderTaskCard', () => {
  it('renders title, goal, optional sections, and the verbatim original', () => {
    const card = {
      title: '重构登录逻辑支持 refresh token',
      goal: '重写 src/auth.ts 的登录流程。',
      constraints: ['不改变 API 签名'],
      acceptance: ['pnpm test 全绿'],
    }
    const rendered = renderTaskCard(card, ORIGINAL)
    expect(rendered).toContain('# 重构登录逻辑支持 refresh token')
    expect(rendered).toContain('## 目标')
    expect(rendered).toContain('## 约束\n- 不改变 API 签名')
    expect(rendered).toContain('## 验收\n- pnpm test 全绿')
    expect(rendered).toContain('—— 原始请求 ——')
    expect(rendered).toContain(ORIGINAL)
  })

  it('omits empty sections', () => {
    const card = { title: 'T', goal: 'G', constraints: [], acceptance: [] }
    const rendered = renderTaskCard(card, '原')
    expect(rendered).not.toContain('## 约束')
    expect(rendered).not.toContain('## 验收')
    expect(rendered).toContain('# T\n\n## 目标\nG\n\n—— 原始请求 ——\n原')
  })
})

describe('hasTaskCard', () => {
  it('detects the marker on a rendered card', () => {
    const rendered = renderTaskCard({ title: 'T', goal: 'G', constraints: [], acceptance: [] }, '原')
    expect(hasTaskCard(rendered)).toBe(true)
  })

  it('returns false on plain user text', () => {
    expect(hasTaskCard('帮我看看这个')).toBe(false)
    expect(hasTaskCard('—— 原始请求 ——')).toBe(false)
  })
})
