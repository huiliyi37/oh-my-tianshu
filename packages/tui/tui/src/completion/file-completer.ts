import { execSync } from 'node:child_process'

/**
 * Adapted for the dsh-tui port seam (Apache License 2.0, section 4(b)):
 * upstream source .rivet/tui-source/tui/file-completer.ts, Copyright
 * 2025-2026 Tianshu Contributors, licensed under the Apache License, Version
 * 2.0 (see LICENSE and NOTICE). Modified: relocated src/tui/ → src/completion/;
 * `resolveFileCompletion` (Tab 协调入口) is dsh-owned, added for Phase 6.3.
 */

/**
 * Tab 补全的 `@` 触发后从光标前最近 `@` 起的非空白 token。
 * token 内的 emoji/CJK 不会被切碎——正则用 `[^\s]` 锁住空白边界，
 * 让用户粘贴「@🎯 目标.md」或「@中文 路径.md」类带表情符号/中文的
 * 路径请求走完整个 token，再交由 `getCompletions` 走 git ls-files 过滤。
 * @param text - 输入框当前完整文本。
 * @param cursorPos - 光标位置（token 只在光标前查找）。
 * @returns `@` 后的 token（可为空串）；光标前无 `@` token 时为 null。
 */
export function extractAtToken(text: string, cursorPos: number): string | null {
  const before = text.slice(0, cursorPos)
  const match = before.match(/@([^\s]*)$/)
  return match?.[1] ?? null
}

// 超时降到 500ms：领航星 2026-06-11 实测原 3000ms 让 Tab 补全在大仓库下
// 体验卡顿（用户按 Tab 之后光标停 1-3 秒），而正常 git ls-files 在
// 1k-10k 文件仓库上 < 100ms 完成。500ms 仍是常规仓库 P99.9 的 3-5 倍
// 安全边际，但已经是用户感知「即时」的临界。
const GIT_LS_FILES_TIMEOUT_MS = 500

/**
 * 走 `git ls-files` 拿补全候选（前缀命中优先，其次短路径优先）。
 *
 * 非 git 目录 / 命令失败 / 超时 → 静默返回 []，**不抛错**：
 * @-补全是输入便利功能，不应污染主流程；上层也只把候选列表当作
 * 「建议」，空候选就当普通 @-token 提交给 agent。
 * @param partial - 已输入的路径片段（大小写不敏感子串匹配）。
 * @param cwd - git 仓库工作目录。
 * @param limit - 候选上限。
 * @param timeoutMs - git ls-files 超时毫秒数（缺省 500ms，见上方权衡）。
 * @returns 匹配的仓库相对路径列表；失败/超时静默返回 []。
 */
export function getCompletions(partial: string, cwd: string, limit: number, timeoutMs = GIT_LS_FILES_TIMEOUT_MS): string[] {
  try {
    const output = execSync('git ls-files --cached --others --exclude-standard', {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const lower = partial.toLowerCase()
    return output
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(f => f.toLowerCase().includes(lower))
      .sort((a, b) => {
        const aS = a.toLowerCase().startsWith(lower) ? 0 : 1
        const bS = b.toLowerCase().startsWith(lower) ? 0 : 1
        return aS - bS || a.length - b.length
      })
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * 把选中的候选回填到输入：光标前最近 `@` 起替换为规范形 `@file:` 引用
 * （含空格路径加引号），并附一个尾随空格。
 * @param text - 输入框当前完整文本。
 * @param cursorPos - 光标位置。
 * @param completion - 选中的仓库相对路径。
 * @returns 回填后的文本与新光标位置（落在尾随空格之后）。
 */
export function applyCompletion(text: string, cursorPos: number, completion: string): { text: string; cursor: number } {
  const before = text.slice(0, cursorPos)
  const after = text.slice(cursorPos)
  const atIdx = before.lastIndexOf('@')
  // 规范形 @file:（含空格路径用引用形）——mention-parser 只认该协议；
  // 此前插入裸 @path 提交后不会被解析成引用（静默断链，2026-07-24 修复）。
  const mention = completion.includes(' ') ? `@file:"${completion}" ` : `@file:${completion} `
  const newText = before.slice(0, atIdx) + mention + after
  return { text: newText, cursor: atIdx + mention.length }
}

/**
 * dsh 新增（Phase 6.3）：Tab 补全协调入口。
 *
 * 仅当光标前存在 `@` 路径 token（路径片段，可含 / . emoji/CJK）时才接管
 * Tab：返回 token 与候选；无 token 或无候选返回 null，Tab 保持原行为。
 * 与 slash 轮协调：slash 分支在输入以 `/` 开头时优先，@ token 条件天然
 * 隔离二者，互不重叠。
 * @param input - 输入框当前完整文本。
 * @param cursor - 光标位置。
 * @param cwd - git 仓库工作目录。
 * @param limit - 候选上限（缺省 8）。
 * @param timeoutMs - git ls-files 超时（缺省 500ms，产品即时性权衡）；
 *   测试/慢速环境可显式放宽。
 * @returns token 与候选列表；无 token 或无候选时为 null（Tab 保持原行为）。
 */
export function resolveFileCompletion(
  input: string,
  cursor: number,
  cwd: string,
  limit = 8,
  timeoutMs = GIT_LS_FILES_TIMEOUT_MS,
): { token: string; candidates: string[] } | null {
  const token = extractAtToken(input, cursor)
  if (token === null) return null
  const candidates = getCompletions(token, cwd, limit, timeoutMs)
  if (candidates.length === 0) return null
  return { token, candidates }
}
