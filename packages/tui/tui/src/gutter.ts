/**
 * [未接线 / NOT WIRED] 统一 gutter 字典。在 Claude Code 对标方向下，主渲染路径
 * （engine/app.ts）不使用此模块——user/assistant 各自硬编码标记。保留为可选/遗留
 * 视觉资产，最终去留待产品决定；新代码不应在 CC 默认路径引用它。
 */
import type { RivetTheme } from './theme.js'

/** gutter 语义类别（说话人/思考/工具/系统）。 */
export type GutterKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'system'

/** Single-char gutter glyph + the theme color key used to render it. */
export const GUTTER: Record<GutterKind, { glyph: string; colorKey: keyof RivetTheme }> = {
  user: { glyph: '▍', colorKey: 'userColor' },
  assistant: { glyph: '▍', colorKey: 'assistantColor' },
  thinking: { glyph: '┊', colorKey: 'muted' },
  tool: { glyph: '│', colorKey: 'primary' },
  system: { glyph: '·', colorKey: 'systemColor' },
}

/**
 * 某语义类别的 gutter 字形（未知类别回退 system 档）。
 * @param kind - gutter 语义类别。
 * @returns 单字符 gutter 字形。
 */
export function gutterGlyph(kind: GutterKind): string {
  const entry = GUTTER[kind] as { glyph: string; colorKey: keyof RivetTheme } | undefined
  return (entry ?? GUTTER.system).glyph
}
