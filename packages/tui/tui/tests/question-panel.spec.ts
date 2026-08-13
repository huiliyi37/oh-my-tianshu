/**
 * question-panel.spec.ts — 结构化提问面板纯函数（user-interaction 数据面移植，纯函数层）。
 *
 * 覆盖：标题行与空 questions、通用选项面板（编号 + 选项文本、multiSelect 多选
 * 标记、header/detail/description 渲染、options 缺失）、plan-review 决策卡
 * （approve 批准项 BOLD 高亮、其余否决、approve 不命中全部按否决降级）、
 * 多 question 顺序、窄宽截断与极端窄宽不抛错、含 ANSI 行宽度合规。数据面形状
 * 以 packages/interaction/user-interaction/src/types.ts 实测为准（intent 唯一
 * kind 'plan-review' 带 approve: string；multiSelect 缺省单选）。
 */
import { describe, expect, it } from 'vitest'
import { projectQuestionPanel, type QuestionItemInput } from '../src/question-panel.js'
import { displayWidth } from '../src/width.js'

const BOLD = '\x1B[1m'
const RESET = '\x1B[0m'

/** 单选问题：无 header/detail/multiSelect/intent。 */
const plainSingle: QuestionItemInput = {
  id: 'q-1',
  question: '请选择发布策略',
  options: [{ label: '金丝雀发布' }, { label: '全量发布' }, { label: '回滚' }],
}

/** 多选问题：multiSelect + detail + description。 */
const multiWithDetail: QuestionItemInput = {
  id: 'q-2',
  question: '选择要包含的模块',
  detail: '可多选，Enter 确认',
  multiSelect: true,
  options: [
    { label: '会话恢复', description: '恢复上次会话状态' },
    { label: '状态面板' },
  ],
}

/** 带 header 的单选问题（无 options）。 */
const headerOnly: QuestionItemInput = {
  id: 'q-3',
  header: '环境',
  question: '目标环境？',
}

/** plan-review 决策卡：approve 命中其中一个选项。 */
const planReview: QuestionItemInput = {
  id: 'q-4',
  question: '评审以下计划',
  detail: '# 计划\n- 阶段一\n- 阶段二',
  intent: { kind: 'plan-review', approve: '批准' },
  options: [{ label: '批准' }, { label: '修改后重提' }, { label: '拒绝' }],
}

/** plan-review 决策卡：approve 不命中任何选项（数据不一致，全部按否决降级）。 */
const planReviewMismatch: QuestionItemInput = {
  id: 'q-5',
  intent: { kind: 'plan-review', approve: '不存在' },
  question: '评审（approve 未命中）',
  options: [{ label: '甲' }, { label: '乙' }],
}

describe('面板骨架', () => {
  it('渲染标题行', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle] }, { width: 80 })
    expect(rows[0]).toBe('❓ 提问')
  })

  it('questions 为空数组 → 仅标题行', () => {
    expect(projectQuestionPanel({ questions: [] }, { width: 80 })).toEqual(['❓ 提问'])
  })
})

describe('通用选项面板', () => {
  it('问题行渲染 ❓ 字形与问题文本', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle] }, { width: 80 })
    expect(rows).toContain('❓ 请选择发布策略')
  })

  it('选项行按编号 + 选项文本渲染', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle] }, { width: 80 })
    expect(rows).toContain('  1. 金丝雀发布')
    expect(rows).toContain('  2. 全量发布')
    expect(rows).toContain('  3. 回滚')
  })

  it('multiSelect=true → 问题行尾缀（多选）', () => {
    const rows = projectQuestionPanel({ questions: [multiWithDetail] }, { width: 80 })
    expect(rows).toContain('❓ 选择要包含的模块（多选）')
  })

  it('multiSelect 缺省（单选）→ 无多选标记', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle] }, { width: 80 })
    const row = rows.find(r => r.includes('请选择发布策略'))
    expect(row).toBe('❓ 请选择发布策略')
  })

  it('detail 渲染为缩进行', () => {
    const rows = projectQuestionPanel({ questions: [multiWithDetail] }, { width: 80 })
    expect(rows).toContain('  可多选，Enter 确认')
  })

  it('header 渲染为分隔标题行', () => {
    const rows = projectQuestionPanel({ questions: [headerOnly] }, { width: 80 })
    expect(rows).toContain('── 环境 ──')
    expect(rows).toContain('❓ 目标环境？')
  })

  it('option.description 渲染为二级缩进行', () => {
    const rows = projectQuestionPanel({ questions: [multiWithDetail] }, { width: 80 })
    expect(rows).toContain('    恢复上次会话状态')
  })

  it('options 缺失 → 仅问题行，无选项行', () => {
    const rows = projectQuestionPanel({ questions: [headerOnly] }, { width: 80 })
    expect(rows.some(r => r.includes('1. '))).toBe(false)
  })
})

describe('plan-review 决策卡', () => {
  it('问题行渲染 🧭 字形', () => {
    const rows = projectQuestionPanel({ questions: [planReview] }, { width: 80 })
    expect(rows).toContain('🧭 评审以下计划')
  })

  it('detail（计划正文）按行拆分，每行渲染为缩进行', () => {
    const rows = projectQuestionPanel({ questions: [planReview] }, { width: 80 })
    expect(rows).toContain('  # 计划')
    expect(rows).toContain('  - 阶段一')
    expect(rows).toContain('  - 阶段二')
  })

  it('approve 命中的选项标 ✓ 且 BOLD 高亮', () => {
    const rows = projectQuestionPanel({ questions: [planReview] }, { width: 80 })
    expect(rows).toContain(`${BOLD}  ✓ 1. 批准${RESET}`)
  })

  it('其余选项标 ✗ 且不高亮', () => {
    const rows = projectQuestionPanel({ questions: [planReview] }, { width: 80 })
    expect(rows).toContain('  ✗ 2. 修改后重提')
    expect(rows).toContain('  ✗ 3. 拒绝')
    expect(rows).not.toContain(`${BOLD}  ✗ 2. 修改后重提${RESET}`)
  })

  it('multiSelect 在 plan-review 卡不追加多选标记（决策卡为单选裁决）', () => {
    const multiPlan: QuestionItemInput = {
      ...planReview,
      multiSelect: true,
    }
    const rows = projectQuestionPanel({ questions: [multiPlan] }, { width: 80 })
    expect(rows).toContain('🧭 评审以下计划')
    expect(rows.some(r => r.includes('（多选）'))).toBe(false)
  })

  it('plan-review 卡底部渲染 key hints（编号 + f 反馈 + Esc/Ctrl+C 取消）', () => {
    const rows = projectQuestionPanel({ questions: [planReview] }, { width: 80 })
    expect(rows).toContain('  [1] 批准  [2] 修改后重提  [f] 反馈修改  [Esc]/[Ctrl+C] 取消')
  })

  it('approve 不命中任何选项 → 全部按否决渲染（不抛错）', () => {
    const rows = projectQuestionPanel({ questions: [planReviewMismatch] }, { width: 80 })
    expect(rows).toContain('  ✗ 1. 甲')
    expect(rows).toContain('  ✗ 2. 乙')
    expect(rows.some(r => r.includes('✓'))).toBe(false)
  })

  it('plan-review options 缺失 → 仅问题行', () => {
    const noOpts: QuestionItemInput = {
      id: 'q-6',
      question: '评审（无选项）',
      intent: { kind: 'plan-review', approve: '批准' },
    }
    const rows = projectQuestionPanel({ questions: [noOpts] }, { width: 80 })
    expect(rows).toContain('🧭 评审（无选项）')
    expect(rows.some(r => r.includes('✓') || r.includes('✗'))).toBe(false)
  })
})

describe('多 question 顺序', () => {
  it('按输入顺序渲染，各 question 块连续', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle, planReview] }, { width: 80 })
    const q1Idx = rows.findIndex(r => r.includes('请选择发布策略'))
    const q1OptIdx = rows.findIndex(r => r.includes('1. 金丝雀发布'))
    const planIdx = rows.findIndex(r => r.includes('🧭 评审以下计划'))
    const planApproveIdx = rows.findIndex(r => r.includes('✓ 1. 批准'))
    expect(q1Idx).toBeGreaterThanOrEqual(0)
    expect(q1OptIdx).toBe(q1Idx + 1)
    expect(planIdx).toBeGreaterThan(q1OptIdx)
    expect(planApproveIdx).toBeGreaterThan(planIdx)
  })
})

describe('窄宽截断', () => {
  it('窄宽下所有行（含 ANSI 高亮行）不超过 width', () => {
    const rows = projectQuestionPanel({ questions: [multiWithDetail, planReview] }, { width: 14 })
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(14)
    }
  })

  it('长行在窄宽下截断补 …', () => {
    const long: QuestionItemInput = {
      id: 'q-7',
      question: '这是一个非常非常长的提问文本，用来验证窄宽截断降级逻辑是否正常工作',
      options: [{ label: '选项甲' }, { label: '选项乙' }],
    }
    const rows = projectQuestionPanel({ questions: [long] }, { width: 16 })
    const line = rows.find(r => r.includes('…'))
    expect(line).toBeDefined()
    expect(displayWidth(line!)).toBeLessThanOrEqual(16)
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() => projectQuestionPanel({ questions: [plainSingle] }, { width: 1 })).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectQuestionPanel({ questions: [plainSingle] }, { width: 80 })
    expect(rows).toContain('❓ 请选择发布策略')
    expect(rows).toContain('  1. 金丝雀发布')
  })
})
