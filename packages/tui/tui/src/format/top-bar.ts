/**
 * 顶部栏（format/top-bar.ts）— 纯渲染（C4 概念稿 A「航图」top bar）。
 *
 * 启动信息行：cwd + git 分支（可选）+ 模型（可选）。快捷键提示不在本行——
 * 概念稿 A 的 shortcuts 行由底部 footer（format/prompt-footer.ts）承担。
 * 段顺序（从前往后）：📁 cwd → model → (branch)；超宽时从后往前丢段
 * （branch → model），最后只剩 cwd 仍超宽则截断加省略号。
 * 分支段 brandColor 强调；📁 图标 ascii 档降级为 `~`（legacy 终端宽度稳定）。
 * 宽度守恒：任何输入下每行显示宽度 ≤ width。
 */
import { color } from '../engine/ansi.js'
import type { RivetTheme } from '../theme.js'
import { displayWidth } from '../width.js'

/** formatTopBar 的渲染输入。 */
export interface FormatTopBarInput {
  width: number
  /** 当前工作目录（显示原文，不折叠）。 */
  cwd: string
  /** git 分支名（可检测时；缺省不渲染分支段）。 */
  branch?: string
  /** 模型显示名（provider/model；缺省不渲染）。 */
  modelName?: string
  /** legacy 终端：📁 降级为 `~`。 */
  ascii?: boolean
}

function truncateTo(text: string, columns: number): string {
  let out = ''
  for (const ch of text) {
    if (displayWidth(out + ch) > columns) break
    out += ch
  }
  return out
}

/**
 * 渲染顶部栏单行：段顺序 cwd → model → branch，超宽丢尾段。
 * @param input - 宽度、cwd、可选分支/模型/ascii。
 * @param theme - 当前主题（cwd secondary、分支 brandColor）。
 * @returns 单行 ANSI；任何宽度下 ≤ width。
 */
export function formatTopBar(input: FormatTopBarInput, theme: RivetTheme): string[] {
  const { width, cwd, branch, modelName, ascii } = input
  const icon = ascii === true ? '~' : '📁'
  const base = `${icon} ${cwd}`
  const tail: string[] = []
  if (modelName !== undefined && modelName !== '') tail.push(modelName)
  if (branch !== undefined && branch !== '') tail.push(`(${branch})`)
  // 从后往前丢段直到放得下（base 恒保留）。
  let segs = tail
  for (;;) {
    const text = [base, ...segs].join(' · ')
    if (displayWidth(text) <= width) {
      const parts = [color(base, theme.secondary)]
      for (const s of segs) {
        parts.push(color(s, s.startsWith('(') ? theme.brandColor : theme.secondary))
      }
      return [parts.join(' · ')]
    }
    if (segs.length === 0) break
    segs = segs.slice(0, -1)
  }
  // 只剩 base 仍超宽：截断 + 省略号（省略号占 1 列，base 截到剩余预算）。
  const ellipsis = '…'
  const budget = Math.max(1, width - displayWidth(ellipsis))
  return [color(`${truncateTo(base, budget)}${ellipsis}`, theme.secondary)]
}
