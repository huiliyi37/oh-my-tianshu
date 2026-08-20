/**
 * adaptive-memory 渲染与候选筛选单测（canonicalization 不变量的硬约束面）。
 *
 * 行为契约：
 * - renderSTM 确定性：相同输入跨调用逐字节一致；易变字段（accessCount、
 *   versionStamp）不同的输入渲染出逐字节相同的结果。
 * - 预算施加在完整结果上：header 超预算 ⇒ ''；单行使总量超预算则跳过该行；
 *   行数封顶 maxEntries；零候选 ⇒ ''。
 * - selectCandidates：相关性 = intent 词/实体子串匹配；约束 tag 条目始终入选
 *   且排序在前；同分按 id 升序（确定性 tiebreak）。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/render
 */

import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '@huiliyi37/dsh-memory'
import type { StmCandidate } from '../src/types.ts'
import { estimateTokens, relevanceSignature, renderSTM, selectCandidates } from '../src/render.ts'

const RENDER_OPTS = { tokenBudget: 600, maxEntries: 12 }
const SELECT_OPTS = { alwaysIncludeTags: ['safety', 'constraint', 'preference'], maxKeywords: 5, summaryMaxChars: 120 }

/** 构造候选条目（测试夹具；id 逐一定名以便断言顺序）。 */
function candidate(partial: Partial<StmCandidate> & { id: string }): StmCandidate {
  return {
    topic: 'tooling',
    summary: '条目摘要',
    keywords: [],
    versionStamp: 1,
    ...partial,
  }
}

/** 构造记忆条目（测试夹具）。 */
function entry(partial: Partial<MemoryEntry> & { id: string; text: string }): MemoryEntry {
  return {
    scope: 'global',
    tags: [],
    createdAt: 1,
    source: 'agent',
    ...partial,
  }
}

describe('renderSTM canonicalization', () => {
  it('确定性：相同输入跨调用逐字节一致', () => {
    const candidates = [
      candidate({ id: 'aaaaaaaa-0000', summary: '项目使用 pnpm workspace', keywords: ['pnpm'] }),
      candidate({ id: 'bbbbbbbb-1111', summary: '测试用 vitest 运行', keywords: ['vitest'] }),
    ]
    const first = renderSTM(candidates, RENDER_OPTS)
    const second = renderSTM(candidates, RENDER_OPTS)
    expect(first).toBe(second)
    expect(first).toContain('aaaaaaaa | tooling | 项目使用 pnpm workspace | pnpm')
    expect(first).toContain('bbbbbbbb | tooling | 测试用 vitest 运行 | vitest')
  })

  it('volatile-field 反例：仅 accessCount / versionStamp 不同的输入渲染逐字节相同', () => {
    const base = candidate({ id: 'aaaaaaaa-0000', summary: '同一条记忆' })
    const rendered = renderSTM([base], RENDER_OPTS)
    const volatile = renderSTM([{ ...base, accessCount: 999, versionStamp: 9_999_999 }], RENDER_OPTS)
    expect(volatile).toBe(rendered)
  })

  it('渲染行不含 id 全段与时间戳：输出只含短 id 前缀', () => {
    const rendered = renderSTM([candidate({ id: '12345678-abcd-efgh', versionStamp: 1_700_000_000_000 })], RENDER_OPTS)
    expect(rendered).toContain('12345678 |')
    expect(rendered).not.toContain('abcd-efgh')
    expect(rendered).not.toContain('1700000000000')
  })

  it('零候选 ⇒ 空串（无贡献）；header 超预算 ⇒ 空串', () => {
    expect(renderSTM([], RENDER_OPTS)).toBe('')
    expect(renderSTM([candidate({ id: 'aaaaaaaa-0000' })], { tokenBudget: 1, maxEntries: 12 })).toBe('')
  })

  it('精确预算：恰好装满的行被保留，超一行预算的行被跳过', () => {
    const oneLine = renderSTM([candidate({ id: 'aaaaaaaa-0000' })], RENDER_OPTS)
    const exactBudget = estimateTokens(oneLine)
    // 恰好等于预算：保留
    expect(renderSTM([candidate({ id: 'aaaaaaaa-0000' })], { tokenBudget: exactBudget, maxEntries: 12 })).toBe(oneLine)
    // 少 1 token：唯一的行被跳过 ⇒ 无任何行 ⇒ 空串（header 不单独贡献）
    expect(renderSTM([candidate({ id: 'aaaaaaaa-0000' })], { tokenBudget: exactBudget - 1, maxEntries: 12 })).toBe('')
  })

  it('超长单行不挤死后续短行（跳过该行继续）', () => {
    const long = candidate({ id: 'aaaaaaaa-0000', summary: '长'.repeat(400) })
    const short = candidate({ id: 'bbbbbbbb-1111', summary: '短' })
    const rendered = renderSTM([long, short], { tokenBudget: 80, maxEntries: 12 })
    expect(rendered).not.toContain('aaaaaaaa')
    expect(rendered).toContain('bbbbbbbb |')
  })

  it('行数封顶 maxEntries', () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate({ id: `id${String(i).padStart(6, '0')}-xx` }))
    const rendered = renderSTM(many, { tokenBudget: 10_000, maxEntries: 3 })
    expect(rendered.match(/^- /gm)).toHaveLength(3)
  })

  it('无汉字文本按 1/4 估算 token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('selectCandidates', () => {
  it('相关性 = intent 词/实体子串匹配；无关条目不入选', () => {
    const entries = [
      entry({ id: 'a-1', text: '登录逻辑在 src/auth/login.ts，JWT 校验', tags: ['auth'] }),
      entry({ id: 'b-2', text: '完全不相关的烹饪笔记' }),
    ]
    const candidates = selectCandidates(entries, {
      intentTokens: ['登录'],
      entities: ['src/auth/login.ts'],
    }, SELECT_OPTS)
    expect(candidates.map(c => c.id)).toEqual(['a-1'])
    expect(candidates[0]?.topic).toBe('auth')
    expect(candidates[0]?.summary).toBe('登录逻辑在 src/auth/login.ts，JWT 校验')
  })

  it('约束 tag 条目始终入选且排在最前（即使零相关）', () => {
    const entries = [
      entry({ id: 'z-9', text: '与普通任务无关', tags: ['safety'] }),
      entry({ id: 'a-1', text: '登录相关', tags: ['auth'] }),
    ]
    const candidates = selectCandidates(entries, { intentTokens: ['登录'], entities: [] }, SELECT_OPTS)
    expect(candidates.map(c => c.id)).toEqual(['z-9', 'a-1'])
  })

  it('排序确定性：得分降序，同分按 id 升序', () => {
    const entries = [
      entry({ id: 'b-2', text: '命中一个词 alpha' }),
      entry({ id: 'a-1', text: '命中一个词 alpha' }),
      entry({ id: 'c-3', text: '命中 alpha 与 beta 两个词' }),
    ]
    const candidates = selectCandidates(entries, { intentTokens: ['alpha', 'beta'], entities: [] }, SELECT_OPTS)
    expect(candidates.map(c => c.id)).toEqual(['c-3', 'a-1', 'b-2'])
  })

  it('摘要截断到 summaryMaxChars（补 …）；关键词封顶 maxKeywords；无 tag ⇒ \'-\'', () => {
    const entries = [
      entry({ id: 'a-1', text: '很'.repeat(200), tags: ['t1', 't2', 't3', 't4', 't5', 't6'] }),
      entry({ id: 'b-2', text: '多行\n第二行不进摘要' }),
    ]
    // 短于 2 字符的信号不参与匹配（与 intentKey 的最短词长对齐）
    const candidates = selectCandidates(entries, { intentTokens: ['很很', '多行'], entities: [] },
      { alwaysIncludeTags: [], maxKeywords: 5, summaryMaxChars: 10 })
    const first = candidates.find(c => c.id === 'a-1')
    expect(first?.summary).toBe(`${'很'.repeat(10)}…`)
    expect(first?.keywords).toEqual(['t1', 't2', 't3', 't4', 't5'])
    const second = candidates.find(c => c.id === 'b-2')
    expect(second?.summary).toBe('多行')
    expect(second?.topic).toBe('-')
  })
})

describe('relevanceSignature 门控签名', () => {
  it('确定性：相同候选跨调用一致；版本戳或 id 集变化 ⇒ 签名变化', () => {
    const candidates = [candidate({ id: 'a-1' }), candidate({ id: 'b-2', topic: 'auth' })]
    expect(relevanceSignature(candidates)).toBe(relevanceSignature(candidates))
    expect(relevanceSignature([{ ...candidates[0]!, versionStamp: 2 }, candidates[1]!]))
      .not.toBe(relevanceSignature(candidates))
    expect(relevanceSignature([candidates[0]!])).not.toBe(relevanceSignature(candidates))
    // accessCount（易变字段）不影响签名
    expect(relevanceSignature([{ ...candidates[0]!, accessCount: 42 }, candidates[1]!]))
      .toBe(relevanceSignature(candidates))
  })
})
