/**
 * external-editor — 外部编辑器集成（Phase 6.4）。
 *
 * Ctrl+E（可配 editorKey；ctrl+o 已恢复为推理展开）把当前输入行内容写入
 * 临时文件，spawn `$VISUAL || $EDITOR` 打开编辑，保存退出后内容回填输入框。
 * 纯 Node API，零依赖。
 *
 * 移植自 .rivet/tui-source/tui/external-editor.ts（Apache-2.0；SOURCE-MAP.md）。
 * 差异：源引用的 ../platform.js getDefaultEditor 未随移植源落地，此处内联
 * （VISUAL/EDITOR 优先，缺省 vi / notepad@win32）。
 *
 * @module @huiliyi37/dsh-tianshu-tui/external-editor
 */

import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

/**
 * 平台缺省编辑器（VISUAL/EDITOR 均未设置时）。
 * @returns win32 为 notepad，其余平台为 vi。
 */
export function getDefaultEditor(): string {
  return process.platform === 'win32' ? 'notepad' : 'vi'
}

/**
 * 编辑器命令：VISUAL 优先，其次 EDITOR，最后平台缺省。
 * @param env - 环境变量来源（测试可注入；缺省 process.env）。
 * @returns 要 spawn 的编辑器命令。
 */
export function getEditorCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env['VISUAL'] || env['EDITOR'] || getDefaultEditor()
}

/**
 * 把初始内容写入一次性临时文件（目录 mkdtemp，文件 RIVET_INPUT.md）。
 * @param content - 写入的初始内容。
 * @returns 临时文件的绝对路径。
 */
export function createTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rivet-edit-'))
  const path = join(dir, 'RIVET_INPUT.md')
  writeFileSync(path, content)
  return path
}

/**
 * 读取编辑结果并清理临时文件（unlink 失败 best-effort）。
 * @param path - createTempFile 返回的临时文件路径。
 * @returns 文件内容（utf-8）。
 */
export function readAndCleanup(path: string): string {
  const content = readFileSync(path, 'utf-8')
  try { unlinkSync(path) } catch { /* best effort */ }
  return content
}

/**
 * 打开编辑器编辑 initialContent，返回编辑后的内容。
 * 编辑器命令可注入（测试）；缺省走 getEditorCommand()。
 * 编辑器异常终止（status !== 0 且有 error）返回 null；status 非 0 但无
 * error（编辑器被信号终止但文件已保存）仍读回内容。
 * @param initialContent - 预填进编辑器的初始内容。
 * @param editor - 编辑器命令（测试注入）；缺省走 getEditorCommand()。
 * @returns 编辑后的内容；编辑器启动/执行异常时为 null。
 */
export function openInEditor(initialContent: string, editor?: string): string | null {
  const path = createTempFile(initialContent)
  const command = editor ?? getEditorCommand()
  const result = spawnSync(command, [path], { stdio: 'inherit' })
  if (result.status !== 0 && result.error) return null
  // status may be non-zero if editor was terminated but file was saved
  return readAndCleanup(path)
}
