/**
 * skill-panel.spec.ts — 技能浏览面板纯函数（T3.3）。
 *
 * 覆盖：标题行、空列表占位、skill 列表行（name + description + 来源标记）、
 * 来源标记已知源映射与未知源回退、选中详情（provider + 调用形态 + whenToUse，
 * 缺省省略）、selected 未命中/缺省不渲染详情、窄宽截断与极端窄宽不抛错。
 * 数据面形状以 packages/skill/skill 的 SkillSummary（name/description/
 * whenToUse/invocation/source/provider）实测为准；skills/change 无 payload
 * 事件，刷新靠重查，面板层只消费 list 快照。
 */
import { describe, expect, it } from 'vitest'
import { projectSkillPanel, type SkillSummaryInput } from '../src/skill-panel.js'
import { displayWidth } from '../src/width.js'

/** 空列表：标题 + 空态占位。 */
const emptySkills: SkillSummaryInput[] = []

/** 完整列表：已知源（project-dsh）、未知源、内置源各一。 */
const fullSkills: SkillSummaryInput[] = [
  {
    name: 'web-search',
    description: '搜索网页获取实时信息',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'project-dsh',
    provider: 'dsh-skill-local',
  },
  {
    name: 'repo-map',
    description: '仓库结构测绘',
    whenToUse: '需要了解代码库布局时',
    invocation: { modelInvocable: true, userInvocable: false },
    source: 'bundled',
    provider: 'dsh-skill-badge',
  },
  {
    name: 'edge-skill',
    description: '外部提供方技能',
    invocation: { modelInvocable: false, userInvocable: true },
    source: 'custom-source',
    provider: 'third-party',
  },
]

describe('projectSkillPanel 标题与空态', () => {
  it('首行为标题行', () => {
    const rows = projectSkillPanel(emptySkills, { width: 80 })
    expect(rows[0]).toBe('🧭 技能')
  })

  it('空列表渲染空态占位', () => {
    const rows = projectSkillPanel(emptySkills, { width: 80 })
    expect(rows).toContain('（暂无技能）')
  })

  it('空列表仅标题 + 占位两行', () => {
    const rows = projectSkillPanel(emptySkills, { width: 80 })
    expect(rows).toHaveLength(2)
  })
})

describe('skill 列表行（name + description + 来源标记）', () => {
  it('已知源渲染映射短标签', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80 })
    expect(rows).toContain('  web-search · 搜索网页获取实时信息 · 项目 .dsh')
    expect(rows).toContain('  repo-map · 仓库结构测绘 · 内置')
  })

  it('未知源回退渲染原值', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80 })
    expect(rows).toContain('  edge-skill · 外部提供方技能 · custom-source')
  })

  it('列表按输入顺序渲染', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80 })
    const first = rows.findIndex(r => r.includes('web-search'))
    const second = rows.findIndex(r => r.includes('repo-map'))
    const third = rows.findIndex(r => r.includes('edge-skill'))
    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('全部已知来源都有映射标签', () => {
    const rows = projectSkillPanel(
      [
        { name: 'a', description: 'a', invocation: { modelInvocable: true, userInvocable: true }, source: 'project-agents', provider: 'p' },
        { name: 'b', description: 'b', invocation: { modelInvocable: true, userInvocable: true }, source: 'runtime', provider: 'p' },
        { name: 'c', description: 'c', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-dsh', provider: 'p' },
        { name: 'd', description: 'd', invocation: { modelInvocable: true, userInvocable: true }, source: 'user-agents', provider: 'p' },
        { name: 'e', description: 'e', invocation: { modelInvocable: true, userInvocable: true }, source: 'custom', provider: 'p' },
      ],
      { width: 80 },
    )
    expect(rows).toContain('  a · a · 项目 AGENTS')
    expect(rows).toContain('  b · b · 运行时')
    expect(rows).toContain('  c · c · 用户 .dsh')
    expect(rows).toContain('  d · d · 用户 AGENTS')
    expect(rows).toContain('  e · e · 自定义')
  })
})

describe('选中详情（provider + 调用形态 + whenToUse）', () => {
  it('selected 命中时在对应列表行后追加详情行', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80, selected: 'repo-map' })
    const listIdx = rows.findIndex(r => r.includes('repo-map'))
    const detailIdx = rows.findIndex(r => r.includes('└'))
    expect(detailIdx).toBeGreaterThan(listIdx)
    expect(rows[detailIdx]).toBe('  └ dsh-skill-badge · 仅模型可调 · 需要了解代码库布局时')
  })

  it('双可调渲染「模型+用户可调」', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80, selected: 'web-search' })
    expect(rows.some(r => r.includes('dsh-skill-local · 模型+用户可调'))).toBe(true)
  })

  it('仅用户可调渲染「仅用户可调」', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80, selected: 'edge-skill' })
    expect(rows.some(r => r.includes('third-party · 仅用户可调'))).toBe(true)
  })

  it('双不可调渲染「不可调」且不抛错', () => {
    const rows = projectSkillPanel(
      [
        { name: 'x', description: 'x', invocation: { modelInvocable: false, userInvocable: false }, source: 'custom', provider: 'p' },
      ],
      { width: 80, selected: 'x' },
    )
    expect(rows.some(r => r.includes('p · 不可调'))).toBe(true)
  })

  it('whenToUse 缺省时详情行省略该段', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80, selected: 'web-search' })
    const detail = rows.find(r => r.includes('dsh-skill-local'))
    expect(detail).toBe('  └ dsh-skill-local · 模型+用户可调')
  })

  it('selected 未命中任何 skill 不渲染详情', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80, selected: 'nope' })
    expect(rows.some(r => r.includes('└'))).toBe(false)
  })

  it('未提供 selected 不渲染详情', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80 })
    expect(rows.some(r => r.includes('└'))).toBe(false)
  })
})

describe('窄宽截断', () => {
  it('长行在窄宽下截断补 …，且所有行不超 width', () => {
    const longDesc = '这是一个非常非常长的技能描述用于验证窄宽截断降级逻辑是否正常工作且不应溢出终端宽度预算'
    const rows = projectSkillPanel(
      [{ name: 'very-long-skill-name', description: longDesc, invocation: { modelInvocable: true, userInvocable: true }, source: 'bundled', provider: 'p' }],
      { width: 20, selected: 'very-long-skill-name' },
    )
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(20)
    }
    expect(rows.some(r => r.includes('…'))).toBe(true)
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() => projectSkillPanel(fullSkills, { width: 1, selected: 'web-search' })).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectSkillPanel(fullSkills, { width: 80 })
    expect(rows).toContain('  web-search · 搜索网页获取实时信息 · 项目 .dsh')
  })
})
