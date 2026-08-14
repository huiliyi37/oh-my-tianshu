/**
 * 结构化提问面板（user-interaction 数据面移植，纯函数层）。
 *
 * projectQuestionPanel 把 AskUserQuestionRequest 形状的提问投影为面板行：
 * 标题行 + 每个 question 一块。两种渲染形态：
 * - 通用选项面板：header 分隔行（可选）+ ❓ 问题行（multiSelect 尾缀
 *   「（多选）」）+ detail 缩进行（可选）+ 编号选项行（「n. label」，
 *   option.description 二级缩进）；
 * - plan-review 决策卡：🧭 问题行 + detail 缩进行（计划正文）+ 选项行按
 *   intent.approve 分类——命中的 label 标 ✓ 且 BOLD 高亮（批准项），其余
 *   标 ✗（否决项）；approve 不命中任何选项时全部按否决渲染（不吞异常、
 *   不伪造批准）；multiSelect 在决策卡形态不追加多选标记（裁决为单选）。
 * 数据面形状结构兼容 @huiliyi37/dsh-user-interaction 的
 * AskUserQuestionRequest/AskUserQuestionItem（intent 唯一 kind
 * 'plan-review' 带 approve: string），纯函数层不跨包依赖、无 I/O。
 * 空 questions 返回仅标题行；每行按显示宽度截断（仅截断时补 …，
 * 极端窄宽退化为 … 不抛错）。TuiApp 消费 user-interaction 提供方的
 * request 快照（接线由其他维度独占）。
 *
 * @module @huiliyi37/dsh-tianshu-tui/question-panel
 */

import { displayWidth } from './width.js'

/** 单个可选项（结构兼容 user-interaction 的 AskUserQuestionOption）。 */
export interface QuestionOptionInput {
  /** 用户可见标签。 */
  label: string
  /** 可选附加说明（capable UI 渲染为二级缩进行）。 */
  description?: string
}

/** 呈现意图（结构兼容 user-interaction 的 AskUserQuestionIntent）。 */
export type QuestionIntentInput = {
  /** 计划评审：approve 命中的选项为批准项，其余为否决项。 */
  kind: 'plan-review'
  /** 批准选项的 label；未命中任何选项时全部按否决渲染。 */
  approve: string
}

/** 单个问题（结构兼容 user-interaction 的 AskUserQuestionItem）。 */
export interface QuestionItemInput {
  /** 稳定问题 id（面板不渲染，answers 定位用）。 */
  id: string
  /** 要展示的问题。 */
  question: string
  /** 可选附加说明（plan-review 卡中为计划正文）。 */
  detail?: string
  /** 可选短标题/分组标签。 */
  header?: string
  /** 可选选项列表；缺失则不渲染选项行。 */
  options?: QuestionOptionInput[]
  /** 是否可多选；缺省单选。plan-review 决策卡恒按单选裁决渲染。 */
  multiSelect?: boolean
  /** 可选呈现意图；缺失渲染通用选项面板。 */
  intent?: QuestionIntentInput
}

/** 提问请求（结构兼容 user-interaction 的 AskUserQuestionRequest，只消费 questions）。 */
export interface QuestionRequestInput {
  /** 要展示的问题数组。 */
  questions: QuestionItemInput[]
}

/** 面板选项。 */
export interface QuestionPanelOptions {
  /** 终端列数（行截断预算，含标题行）。 */
  width: number
}

/** 面板标题行。 */
const TITLE = '❓ 提问'

/** 多选标记（尾缀在通用问题行）。 */
const MULTI_MARK = '（多选）'

/** 粗体（与 engine/ansi.ts 的 ANSI.BOLD 一致；纯函数层不跨模块依赖）。 */
const BOLD = '\x1B[1m'

/** SGR 重置转义序列。 */
const RESET = '\x1B[0m'

/** plan-review 批准项标记。 */
const APPROVE_MARK = '✓'

/** plan-review 否决项标记。 */
const REJECT_MARK = '✗'

/**
 * 投影提问请求为面板行（标题 + 每个 question 一块，按输入顺序）。
 * @param request - 提问请求（只消费 questions 字段）。
 * @param opts - 面板选项（行宽预算）。
 * @returns 面板行数组（空 questions → 仅标题行）。
 */
export function projectQuestionPanel(request: QuestionRequestInput, opts: QuestionPanelOptions): string[] {
  const rows = [TITLE]
  for (const item of request.questions) {
    rows.push(...projectQuestion(item, opts.width))
  }
  return rows
}

/** 渲染单个 question 块（header + 问题行 + detail + 选项行；形态由 intent 决定）。 */
function projectQuestion(item: QuestionItemInput, width: number): string[] {
  const rows: string[] = []
  if (item.header !== undefined) {
    rows.push(truncateByWidth(`── ${item.header} ──`, width))
  }
  const intent = item.intent
  if (intent?.kind === 'plan-review') {
    rows.push(truncateByWidth(`🧭 ${item.question}`, width))
    if (item.detail !== undefined) {
      rows.push(...projectDetail(item.detail, width))
    }
    rows.push(...projectPlanOptions(item.options, intent.approve, width))
    rows.push(...projectPlanKeyHints(item, width))
    return rows
  }
  const multiMark = item.multiSelect === true ? MULTI_MARK : ''
  rows.push(truncateByWidth(`❓ ${item.question}${multiMark}`, width))
  if (item.detail !== undefined) {
    rows.push(...projectDetail(item.detail, width))
  }
  rows.push(...projectOptionList(item.options, width))
  return rows
}

/** detail 按行拆分，每行渲染为一级缩进行（plan-review 卡中为计划正文）。 */
function projectDetail(detail: string, width: number): string[] {
  return detail.split(/\r?\n/).map(line => truncateByWidth(`  ${line}`, width))
}

/** plan-review 卡选项行：approve 命中 ✓ + BOLD 高亮，其余 ✗。 */
function projectPlanOptions(options: QuestionOptionInput[] | undefined, approve: string, width: number): string[] {
  if (options === undefined) return []
  const rows: string[] = []
  options.forEach((opt, i) => {
    const isApprove = opt.label === approve
    const mark = isApprove ? APPROVE_MARK : REJECT_MARK
    const row = `  ${mark} ${i + 1}. ${opt.label}`
    const cut = truncateByWidth(row, width)
    rows.push(isApprove ? `${BOLD}${cut}${RESET}` : cut)
  })
  return rows
}

/** plan-review 卡 key hints：数字键选选项（编号 1-based），f 反馈，Esc/Ctrl+C 取消。 */
function projectPlanKeyHints(item: QuestionItemInput, width: number): string[] {
  const approve = item.intent?.approve
  const approveIdx = item.options?.findIndex(o => o.label === approve)
  const keepIdx = item.options?.findIndex((o, i) => i !== approveIdx && o.label !== approve)
  const hints: string[] = []
  if (approveIdx !== undefined && approveIdx >= 0) {
    hints.push(`[${approveIdx + 1}] ${item.options?.[approveIdx]?.label ?? ''}`)
  }
  if (keepIdx !== undefined && keepIdx >= 0) {
    hints.push(`[${keepIdx + 1}] ${item.options?.[keepIdx]?.label ?? ''}`)
  }
  hints.push('[f] 反馈修改', '[Esc]/[Ctrl+C] 取消')
  return [truncateByWidth(`  ${hints.join('  ')}`, width)]
}

/** 通用选项行：编号 + label，description 二级缩进。 */
function projectOptionList(options: QuestionOptionInput[] | undefined, width: number): string[] {
  if (options === undefined) return []
  const rows: string[] = []
  options.forEach((opt, i) => {
    rows.push(truncateByWidth(`  ${i + 1}. ${opt.label}`, width))
    if (opt.description !== undefined) {
      rows.push(truncateByWidth(`    ${opt.description}`, width))
    }
  })
  /* jscpd:ignore-start */
  return rows
}

/** 按显示宽度截断字符串（仅发生截断时尾部补 …；极端窄宽退化为 …）。 */
function truncateByWidth(text: string, max: number): string {
  if (max <= 1) return '…'
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = displayWidth(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return w < displayWidth(text) ? `${out}…` : out
}
/* jscpd:ignore-end */
