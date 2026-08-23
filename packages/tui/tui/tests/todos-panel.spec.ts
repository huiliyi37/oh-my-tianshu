import { describe, expect, it } from 'vitest'
import { projectTodosPanel } from '../src/format/todos-panel.js'

/** 宽敞宽度（截断路径单测单独覆盖）。 */
const WIDE = 80

describe('projectTodosPanel 空态与完成态（null 与 [] 语义区分）', () => {
  it('null（会话从未写入）→ 单行空态占位', () => {
    expect(projectTodosPanel(null, { width: WIDE, expanded: false })).toEqual([
      '📋 待办 ·（尚无待办）',
    ])
  })

  it('[]（模型已清空清单）→ 单行完成态，区别于空态', () => {
    expect(projectTodosPanel([], { width: WIDE, expanded: false })).toEqual([
      '📋 待办 · 全部完成 ✓',
    ])
  })
})

describe('projectTodosPanel 摘要态', () => {
  it('摘要行 = 三态计数 + 当前进行项；无进行项省略当前段', () => {
    const todos = [
      { content: 'a', status: 'completed' as const },
      { content: 'b', status: 'in_progress' as const },
      { content: 'c', status: 'pending' as const },
    ]
    expect(projectTodosPanel(todos, { width: WIDE, expanded: false })).toEqual([
      '📋 待办 ✓1 ⏳1 □1 · b',
    ])
    const done = [
      { content: 'a', status: 'completed' as const },
      { content: 'b', status: 'completed' as const },
    ]
    expect(projectTodosPanel(done, { width: WIDE, expanded: false })).toEqual([
      '📋 待办 ✓2 ⏳0 □0',
    ])
  })

  it('超宽摘要行按终端列数截断（… 收尾）', () => {
    const todos = [{ content: '很'.repeat(60), status: 'in_progress' as const }]
    const [line] = projectTodosPanel(todos, { width: 20, expanded: false })
    expect(line!.endsWith('…')).toBe(true)
    expect(line!.length).toBeLessThanOrEqual(20 * 4)
  })
})

describe('projectTodosPanel 明细态', () => {
  it('展开渲染摘要行 + 全部条目明细（未超上限不折叠）', () => {
    const todos = [
      { content: 'a', status: 'completed' as const },
      { content: 'b', status: 'in_progress' as const },
      { content: 'c', status: 'pending' as const },
    ]
    expect(projectTodosPanel(todos, { width: WIDE, expanded: true })).toEqual([
      '📋 待办 ✓1 ⏳1 □1 · b',
      ' [x] a',
      ' ⏳ b',
      ' [ ] c',
    ])
  })

  it('超出 maxRows 封顶：少渲染一行给折叠尾行', () => {
    const todos = [
      { content: 'a', status: 'pending' as const },
      { content: 'b', status: 'pending' as const },
      { content: 'c', status: 'pending' as const },
      { content: 'd', status: 'pending' as const },
      { content: 'e', status: 'pending' as const },
      { content: 'f', status: 'pending' as const },
    ]
    const rows = projectTodosPanel(todos, { width: WIDE, expanded: true, maxRows: 4 })
    expect(rows).toHaveLength(4)
    expect(rows[0]).toBe('📋 待办 ✓0 ⏳0 □6')
    expect(rows[1]).toBe(' [ ] a')
    expect(rows[2]).toBe(' [ ] b')
    expect(rows[3]).toBe('└ …(+4)')
  })

  it('条目数恰好等于容量时全部渲染、无折叠尾行', () => {
    const todos = [
      { content: 'a', status: 'pending' as const },
      { content: 'b', status: 'pending' as const },
      { content: 'c', status: 'pending' as const },
    ]
    const rows = projectTodosPanel(todos, { width: WIDE, expanded: true, maxRows: 4 })
    expect(rows).toHaveLength(4)
    expect(rows.at(-1)).toBe(' [ ] c')
  })

  it('maxRows 缺省 6；过小的 maxRows 收窄到至少折叠尾行的下限', () => {
    const todos = [
      { content: 'a', status: 'pending' as const },
      { content: 'b', status: 'pending' as const },
    ]
    const rows = projectTodosPanel(todos, { width: WIDE, expanded: true, maxRows: 1 })
    expect(rows).toHaveLength(2)
    expect(rows[1]).toBe('└ …(+2)')
  })
})
