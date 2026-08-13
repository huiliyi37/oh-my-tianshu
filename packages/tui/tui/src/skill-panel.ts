/**
 * 技能浏览面板（skill 数据面移植，纯函数层，T3.3）。
 *
 * projectSkillPanel 把 SkillSummary 形状的快照投影为面板行：
 * - 列表行：每个 skill 一行「name · description · 来源标记」——来源标记按
 *   SkillSource 已知值映射短标签（项目 .dsh / 项目 AGENTS / 运行时 / 用户
 *   .dsh / 用户 AGENTS / 自定义 / 内置），未知来源回退渲染原值；
 * - 选中详情：opts.selected 命中的 skill 在其列表行后追加一行
 *   「└ provider · 调用形态 · whenToUse」（whenToUse 缺省时省略该段）——
 *   调用形态由 invocation.modelInvocable/userInvocable 组合推导
 *   （模型+用户可调 / 仅模型可调 / 仅用户可调 / 不可调），selected 未命中
 *   或缺省不渲染详情行。
 * 数据面形状结构兼容 @huiliyi37/dsh-skill 的 SkillSummary（纯函数层只消费
 * name/description/whenToUse/invocation/source/provider；resourceBase 不参与
 * 渲染），skills/change 无 payload 事件、刷新靠重查，面板层只消费 list 快照
 * 投影。空列表渲染标题 + 空态占位；每行按显示宽度截断（仅截断时补 …，
 * 极端窄宽退化为 … 不抛错）。TuiApp 消费技能快照与 /skills 命令切换显隐
 * （接线由其他维度独占）。
 *
 * @module @huiliyi37/dsh-tui/skill-panel
 */

import { displayWidth } from './width.js'

/** 调用控制（结构兼容 dsh-skill 的 SkillInvocationPolicy）。 */
export interface SkillInvocationInput {
  /** 模型面是否可调用。 */
  modelInvocable: boolean
  /** 用户面是否可调用。 */
  userInvocable: boolean
}

/** skill 摘要（结构兼容 dsh-skill 的 SkillSummary，纯函数层只消费路由字段）。 */
export interface SkillSummaryInput {
  /** kebab-case 技能标识。 */
  name: string
  /** 短路由描述。 */
  description: string
  /** 可选额外路由指引（选中详情行消费）。 */
  whenToUse?: string
  /** 模型/用户调用控制。 */
  invocation: SkillInvocationInput
  /** 发现来源（SkillSource）；未知值回退渲染原值。 */
  source: string
  /** 拥有该 skill 的提供方标签。 */
  provider: string
}

/** 面板选项。 */
export interface SkillPanelOptions {
  /** 终端列数（行截断预算，含标题行）。 */
  width: number
  /** 选中的 skill 名称；命中的 skill 追加详情行；缺省/未命中不渲染详情。 */
  selected?: string
}

/** 面板标题行。 */
const TITLE = '🧭 技能'

/** 空态占位行。 */
const EMPTY = '（暂无技能）'

/** 已知 SkillSource → 短标签；未知来源回退渲染原值。 */
const SOURCE_LABELS: Record<string, string> = {
  'project-dsh': '项目 .dsh',
  'project-agents': '项目 AGENTS',
  runtime: '运行时',
  'user-dsh': '用户 .dsh',
  'user-agents': '用户 AGENTS',
  custom: '自定义',
  bundled: '内置',
}

/**
 * 投影技能快照为面板行（标题 + 列表行 + 命中的选中详情行）。
 * @param skills - skill 摘要数组；空数组 → 标题 + 空态占位。
 * @param opts - 面板选项（行宽预算 + 可选选中名）。
 * @returns 面板行数组。
 */
export function projectSkillPanel(skills: SkillSummaryInput[], opts: SkillPanelOptions): string[] {
  const rows = [TITLE]
  if (skills.length === 0) {
    rows.push(EMPTY)
    return rows
  }
  for (const skill of skills) {
    rows.push(truncateByWidth(projectListRow(skill), opts.width))
    if (skill.name === opts.selected) {
      rows.push(truncateByWidth(projectDetailRow(skill), opts.width))
    }
  }
  return rows
}

/** 单个 skill 列表行：name · description · 来源标记。 */
function projectListRow(skill: SkillSummaryInput): string {
  return `  ${skill.name} · ${skill.description} · ${sourceLabel(skill.source)}`
}

/** 来源标记：已知 SkillSource 映射短标签，未知值回退原值。 */
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/** 选中详情行：└ provider · 调用形态 · whenToUse（whenToUse 缺省省略）。 */
function projectDetailRow(skill: SkillSummaryInput): string {
  const whenToUse = skill.whenToUse === undefined ? '' : ` · ${skill.whenToUse}`
  return `  └ ${skill.provider} · ${invocationText(skill.invocation)}${whenToUse}`
}

/** 调用形态文本：由 modelInvocable/userInvocable 组合推导；双不可调也渲染不吞。 */
function invocationText(invocation: SkillInvocationInput): string {
  const { modelInvocable, userInvocable } = invocation
  if (modelInvocable && userInvocable) return '模型+用户可调'
  if (modelInvocable) return '仅模型可调'
  if (userInvocable) return '仅用户可调'
  return '不可调'
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
