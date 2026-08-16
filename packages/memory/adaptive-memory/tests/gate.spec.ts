/**
 * adaptive-memory 阶段二b 单测：置信度门、结构化检索选择、兜底提醒启发式。
 *
 * 行为契约：
 * - tierOfScore：恰好等于阈值进入较高层；score 语义由 provider 定义。
 * - selectStructured：high → 候选带 body；medium → 只索引行；low → 不注入；
 *   pinned 约束条目（alwaysIncludeTags）无 score / 低分也至少保留索引行且排最前。
 * - 结构化门控签名：检索命中（含 low 层）覆盖的 topic 版本号变化 ⇒ 签名变化；
 *   无关 topic 的版本变化不进签名；low 层命中仍被跟踪（内容变更可能跨阈值）。
 * - detectReminder：未覆盖的路径/错误码触发；已覆盖（STM 文本子串）不触发；
 *   memory_* 工具不触发；consumeReminderBudget 按轮/按 intent 限量并在
 *   intent 切换时清空挂起文本。
 *
 * @module @huiliyi37/dsh-adaptive-memory/tests/gate
 */

import { describe, expect, it } from 'vitest'
import type { MemorySearchResult } from '@huiliyi37/dsh-memory'
import { tierOfScore } from '../src/gate.ts'
import { selectStructured } from '../src/retrieve.ts'
import type { StructuredMemoryService } from '../src/retrieve.ts'
import { consumeReminderBudget, detectReminder, emptyReminderBudget, renderReminder } from '../src/remind.ts'
import { estimateTokens, renderSTM } from '../src/render.ts'
import type { StmCandidate } from '../src/types.ts'

const THRESHOLDS = { high: 0.82, medium: 0.55 }
const SELECT_OPTS = {
  alwaysIncludeTags: ['safety', 'constraint', 'preference'],
  maxKeywords: 5,
  summaryMaxChars: 120,
  thresholds: THRESHOLDS,
  retrievalLimit: 24,
}

/** 构造结构化检索命中（测试夹具；id 逐一定名以便断言）。 */
function hit(partial: Partial<MemorySearchResult> & { id: string; text: string }): MemorySearchResult {
  return {
    scope: 'global',
    tags: [],
    createdAt: 1,
    source: 'agent',
    ...partial,
  }
}

/** 假结构化 provider：query 非空时按 text 子串匹配；实体过滤按 text 子串合取。 */
function fakeMemory(entries: MemorySearchResult[], versions: Record<string, number>): StructuredMemoryService {
  return {
    search(query, opts = {}) {
      let out = entries.filter(entry => opts.scope === undefined || entry.scope === opts.scope)
      if (query !== '') out = out.filter(entry => entry.text.includes(query))
      for (const entity of opts.entities ?? []) out = out.filter(entry => entry.text.includes(entity))
      return Promise.resolve(opts.limit === undefined ? out : out.slice(0, opts.limit))
    },
    list(opts = {}) {
      const out = entries.filter(entry => opts.scope === undefined || entry.scope === opts.scope)
      return Promise.resolve(opts.limit === undefined ? out : out.slice(0, opts.limit))
    },
    save: () => Promise.reject(new Error('not used')),
    delete: () => Promise.reject(new Error('not used')),
    topicVersions: () => Promise.resolve(versions),
  }
}

describe('tierOfScore', () => {
  it('阈值边界：恰好等于阈值进入较高层', () => {
    expect(tierOfScore(0.82, THRESHOLDS)).toBe('high')
    expect(tierOfScore(0.819, THRESHOLDS)).toBe('medium')
    expect(tierOfScore(0.55, THRESHOLDS)).toBe('medium')
    expect(tierOfScore(0.549, THRESHOLDS)).toBe('low')
    expect(tierOfScore(0, THRESHOLDS)).toBe('low')
    expect(tierOfScore(1, THRESHOLDS)).toBe('high')
  })

  it('自定义阈值生效', () => {
    expect(tierOfScore(0.3, { high: 0.3, medium: 0.1 })).toBe('high')
    expect(tierOfScore(0.05, { high: 0.3, medium: 0.1 })).toBe('low')
  })
})

describe('selectStructured（置信度门与签名）', () => {
  const entries = [
    hit({ id: 'hi-1', text: '登录 高置信条目全文', tags: ['auth'], score: 0.9 }),
    hit({ id: 'mid-2', text: '登录 中置信条目', tags: ['auth'], score: 0.6 }),
    hit({ id: 'low-3', text: '登录 低置信条目', tags: ['auth'], score: 0.2 }),
  ]

  it('三层门：high 带 body，medium 只索引行，low 不注入', async () => {
    const memory = fakeMemory(entries, { auth: 1 })
    const selection = await selectStructured(memory, { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    expect(selection.candidates.map(c => c.id)).toEqual(['hi-1', 'mid-2'])
    expect(selection.candidates[0]?.body).toBe('登录 高置信条目全文')
    expect(selection.candidates[1]?.body).toBeUndefined()
    expect(selection.topicVersions).toEqual({ auth: '1' })
  })

  it('pinned 约束条目：低分/无分也保留索引行且排最前', async () => {
    const memory = fakeMemory([
      ...entries,
      hit({ id: 'pin-4', text: '永远不要提交密钥', tags: ['safety'], score: 0.1 }),
      hit({ id: 'pin-5', text: '偏好中文回复', tags: ['preference'] }),
    ], { auth: 1, safety: 2, preference: 1 })
    const selection = await selectStructured(memory, { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    // pinned 在前（按 id 稳定序），随后按 score 降序；无分非 pinned 条目不注入
    expect(selection.candidates.map(c => c.id)).toEqual(['pin-4', 'pin-5', 'hi-1', 'mid-2'])
    expect(selection.candidates.every(c => c.body === undefined || c.id === 'hi-1')).toBe(true)
  })

  it('签名：命中 topic 的版本 bump ⇒ 变化；无关 topic 的 bump ⇒ 不变', async () => {
    const base = await selectStructured(fakeMemory(entries, { auth: 1, cooking: 1 }),
      { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    expect(base.signature).toBe(base.signature)
    const bumped = await selectStructured(fakeMemory(entries, { auth: 2, cooking: 1 }),
      { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    expect(bumped.signature).not.toBe(base.signature)
    const unrelated = await selectStructured(fakeMemory(entries, { auth: 1, cooking: 9 }),
      { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    expect(unrelated.signature).toBe(base.signature)
  })

  it('low 层命中仍被签名跟踪（内容变更可能让得分跨阈值）', async () => {
    const withLow = await selectStructured(fakeMemory(entries, { auth: 1 }),
      { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    const withoutLow = await selectStructured(fakeMemory(entries.slice(0, 2), { auth: 1 }),
      { query: '登录', entities: [], sessionScope: 'session:s1' }, SELECT_OPTS)
    expect(withLow.signature).not.toBe(withoutLow.signature)
    // 注入面相同（low 不进 STM）——差异只在门控签名
    expect(withLow.candidates.map(c => c.id)).toEqual(withoutLow.candidates.map(c => c.id))
  })

  it('实体过滤检索并入候选（空 query + entities 的通道）', async () => {
    const memory = fakeMemory([
      hit({ id: 'ent-1', text: 'src/auth/login.ts 的 JWT 校验顺序', tags: ['auth'], score: 0.9 }),
    ], { auth: 1 })
    const selection = await selectStructured(memory, {
      query: '不命中任何文本',
      entities: ['src/auth/login.ts'],
      sessionScope: 'session:s1',
    }, SELECT_OPTS)
    expect(selection.candidates.map(c => c.id)).toEqual(['ent-1'])
  })
})

describe('renderSTM 正文块', () => {
  const RENDER_OPTS = { tokenBudget: 600, maxEntries: 12 }

  function bodyCandidate(): StmCandidate {
    return {
      id: 'aaaaaaaa-0000',
      topic: 'auth',
      summary: '摘要',
      keywords: ['jwt'],
      versionStamp: 1,
      body: '第一行正文\n第二行正文',
    }
  }

  it('high 层渲染为正文块（短 id 头行 + 缩进正文），确定性', () => {
    const rendered = renderSTM([bodyCandidate()], RENDER_OPTS)
    expect(rendered).toContain('- aaaaaaaa | auth（全文）\n  第一行正文\n  第二行正文')
    expect(rendered).toBe(renderSTM([bodyCandidate()], RENDER_OPTS))
  })

  it('正文块超预算时降级为索引行', () => {
    const candidate = bodyCandidate()
    const withBody = renderSTM([candidate], RENDER_OPTS)
    const lineCandidate: StmCandidate = {
      id: candidate.id, topic: candidate.topic, summary: candidate.summary,
      keywords: candidate.keywords, versionStamp: candidate.versionStamp,
    }
    const lineOnly = renderSTM([lineCandidate], RENDER_OPTS)
    // 预算卡在正文块与索引行之间 ⇒ 降级为索引行
    const budget = estimateTokens(lineOnly)
    expect(renderSTM([candidate], { tokenBudget: budget, maxEntries: 12 })).toBe(lineOnly)
    expect(estimateTokens(withBody)).toBeGreaterThan(budget)
  })
})

describe('detectReminder', () => {
  it('调用参数里的未覆盖路径触发 unknown-entity；已覆盖不触发', () => {
    const trigger = detectReminder({
      toolName: 'Read',
      argumentsJson: '{"path":"src/secret/vault.ts"}',
      isError: false,
      resultText: '',
    }, '')
    expect(trigger).toEqual({ kind: 'unknown-entity', subject: 'src/secret/vault.ts' })
    expect(detectReminder({
      toolName: 'Read',
      argumentsJson: '{"path":"src/secret/vault.ts"}',
      isError: false,
      resultText: '',
    }, '… src/secret/vault.ts 已在索引里 …')).toBeUndefined()
  })

  it('错误码触发 error-code（结构化 code 与结果文本两路），已覆盖则落到路径', () => {
    expect(detectReminder({
      toolName: 'Bash',
      argumentsJson: '{}',
      isError: true,
      errorCode: 'EACCES',
      resultText: 'permission denied',
    }, '')).toEqual({ kind: 'error-code', subject: 'EACCES' })
    expect(detectReminder({
      toolName: 'Bash',
      argumentsJson: '{}',
      isError: false,
      resultText: 'open failed: ENOENT',
    }, '')).toEqual({ kind: 'error-code', subject: 'ENOENT' })
    expect(detectReminder({
      toolName: 'Bash',
      argumentsJson: '{"cmd":"cat src/a/b.ts"}',
      isError: true,
      errorCode: 'EACCES',
      resultText: '',
    }, 'EACCES 已有记录')).toEqual({ kind: 'unknown-entity', subject: 'src/a/b.ts' })
  })

  it('memory_* 工具不触发', () => {
    expect(detectReminder({
      toolName: 'memory_search',
      argumentsJson: '{"query":"src/x/y.ts"}',
      isError: false,
      resultText: '',
    }, '')).toBeUndefined()
  })

  it('renderReminder 输出确定且含主题', () => {
    expect(renderReminder({ kind: 'unknown-entity', subject: 'src/a/b.ts' })).toContain('src/a/b.ts')
    expect(renderReminder({ kind: 'error-code', subject: 'ENOENT' })).toContain('ENOENT')
  })
})

describe('consumeReminderBudget', () => {
  it('每轮限量：同轮第二次拒绝，下一轮复位', () => {
    const budget = emptyReminderBudget()
    expect(consumeReminderBudget(budget, 1, 'intent-1', 1, 3)).toBe(true)
    expect(consumeReminderBudget(budget, 1, 'intent-1', 1, 3)).toBe(false)
    expect(consumeReminderBudget(budget, 2, 'intent-1', 1, 3)).toBe(true)
  })

  it('每 intent 限量：跨轮累计到顶后拒绝', () => {
    const budget = emptyReminderBudget()
    expect(consumeReminderBudget(budget, 1, 'intent-1', 1, 2)).toBe(true)
    expect(consumeReminderBudget(budget, 2, 'intent-1', 1, 2)).toBe(true)
    expect(consumeReminderBudget(budget, 3, 'intent-1', 1, 2)).toBe(false)
  })

  it('intent 切换：计数复位并清空挂起文本', () => {
    const budget = emptyReminderBudget()
    budget.text = '旧提醒'
    expect(consumeReminderBudget(budget, 1, 'intent-1', 1, 1)).toBe(true)
    expect(consumeReminderBudget(budget, 2, 'intent-1', 1, 1)).toBe(false)
    expect(consumeReminderBudget(budget, 3, 'intent-2', 1, 1)).toBe(true)
    expect(budget.text).toBe('')
  })
})
