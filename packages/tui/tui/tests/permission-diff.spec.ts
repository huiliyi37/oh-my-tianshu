/**
 * 项 1（C2）：审批 diff 预览 — RED 基线。
 *
 * 覆盖：
 * - str_replace_editor str_replace → 路径统计头 + renderFileDiff 行
 *   （与结算工具卡共用渲染：`+ `/`- ` 前缀双通道，所批即所见）
 * - str_replace_editor create → 前 4 行预览
 * - view/insert/非编辑工具/参数解析失败 → null
 * - 大 diff 截断到 12 行内容上限
 */

import { describe, expect, it } from 'vitest'
import { formatPermissionDiff } from '../src/format/permission-diff.js'
import { getTheme } from '../src/theme.js'

const lightTheme = getTheme(0)

function args(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('formatPermissionDiff — 审批 diff 预览（C2 项 1）', () => {
  it('str_replace 命令 → 路径统计头 + 红绿 diff 行（+/- 前缀双通道）', () => {
    const lines = formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({
        command: 'str_replace',
        path: '/repo/src/a.ts',
        old_str: 'const x = 1\n',
        new_str: 'const x = 2\n',
      }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    const text = lines!.join('\n')
    expect(text).toContain('- const x = 1')
    expect(text).toContain('+ const x = 2')
    expect(text).toContain('/repo/src/a.ts (+1 −1)')
  })

  it('old 与 new 相同 → null（无改动不渲染 diff）', () => {
    const lines = formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({
        command: 'str_replace',
        path: '/repo/src/a.ts',
        old_str: 'same',
        new_str: 'same',
      }),
    }, lightTheme)
    expect(lines).toBeNull()
  })

  it('create 命令 → 前 4 行内容预览（无 diff，新文件无 old）', () => {
    const content = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n')
    const lines = formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'create', path: '/repo/new.ts', file_text: content }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    const text = lines!.join('\n')
    expect(text).toContain('/repo/new.ts')
    expect(text).toContain('line 1')
    expect(text).toContain('line 4')
    expect(text).not.toContain('line 5') // 只前 4 行
  })

  it('view / insert 命令 → null（无替换语义）', () => {
    for (const command of ['view', 'insert']) {
      expect(formatPermissionDiff({
        toolName: 'str_replace_editor',
        arguments: args({ command, path: '/repo/a.ts' }),
      }, lightTheme)).toBeNull()
    }
  })

  it('非编辑工具 → null', () => {
    expect(formatPermissionDiff({
      toolName: 'bash',
      arguments: args({ command: 'ls' }),
    }, lightTheme)).toBeNull()
  })

  it('参数 JSON 解析失败 → null', () => {
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: '{not-json',
    }, lightTheme)).toBeNull()
  })

  it('合法 JSON 但非对象（数字/字符串/数组）→ null', () => {
    for (const raw of ['"42"', '42', '[1,2]', 'true']) {
      expect(formatPermissionDiff({
        toolName: 'str_replace_editor',
        arguments: raw,
      }, lightTheme)).toBeNull()
    }
  })

  it('大 diff 截断：内容行数有界（header + 折叠 ≤ 15 行）', () => {
    const oldStr = Array.from({ length: 60 }, (_, i) => `old line ${i}`).join('\n')
    const newStr = Array.from({ length: 60 }, (_, i) => `new line ${i}`).join('\n')
    const lines = formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({
        command: 'str_replace',
        path: '/repo/big.ts',
        old_str: oldStr,
        new_str: newStr,
      }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    expect(lines!.length).toBeLessThanOrEqual(15)
  })

  it('str_replace 缺参数（path/old_str/new_str 任一缺失）→ null', () => {
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'str_replace', old_str: 'a', new_str: 'b' }), // 缺 path
    }, lightTheme)).toBeNull()
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'str_replace', path: '/repo/a.ts', new_str: 'b' }), // 缺 old_str
    }, lightTheme)).toBeNull()
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'str_replace', path: '/repo/a.ts', old_str: 'a' }), // 缺 new_str
    }, lightTheme)).toBeNull()
  })

  it('str_replace 参数非字符串（asString null 路径）→ null', () => {
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'str_replace', path: 42, old_str: 'a', new_str: 'b' }),
    }, lightTheme)).toBeNull()
  })

  it('create 缺 file_text → null', () => {
    expect(formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'create', path: '/repo/new.ts' }),
    }, lightTheme)).toBeNull()
  })

  it('write_file + content → 前 4 行预览', () => {
    const content = Array.from({ length: 6 }, (_, i) => `w line ${i + 1}`).join('\n')
    const lines = formatPermissionDiff({
      toolName: 'write_file',
      arguments: args({ path: '/repo/w.ts', content }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    const text = lines!.join('\n')
    expect(text).toContain('/repo/w.ts')
    expect(text).toContain('w line 1')
    expect(text).not.toContain('w line 5') // 只前 4 行
  })

  it('write_file + file_text（fallback 字段）→ 预览', () => {
    const lines = formatPermissionDiff({
      toolName: 'write_file',
      arguments: args({ path: '/repo/w2.ts', file_text: 'hello' }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    expect(lines!.join('\n')).toContain('hello')
  })

  it('write_file 缺 content/path → null', () => {
    expect(formatPermissionDiff({
      toolName: 'write_file',
      arguments: args({ path: '/repo/w.ts' }), // 缺 content
    }, lightTheme)).toBeNull()
    expect(formatPermissionDiff({
      toolName: 'write_file',
      arguments: args({ content: 'x' }), // 缺 path
    }, lightTheme)).toBeNull()
  })

  it('edit_file + old_string/new_string → 生成 diff', () => {
    const lines = formatPermissionDiff({
      toolName: 'edit_file',
      arguments: args({
        path: '/repo/e.ts',
        old_string: 'const a = 1',
        new_string: 'const a = 2',
      }),
    }, lightTheme)
    expect(lines).not.toBeNull()
    const text = lines!.join('\n')
    expect(text).toContain('- const a = 1')
    expect(text).toContain('+ const a = 2')
  })

  it('edit_file 同串 → null；缺参 → null', () => {
    expect(formatPermissionDiff({
      toolName: 'edit_file',
      arguments: args({ path: '/repo/e.ts', old_string: 'same', new_string: 'same' }),
    }, lightTheme)).toBeNull()
    expect(formatPermissionDiff({
      toolName: 'edit_file',
      arguments: args({ path: '/repo/e.ts', new_string: 'b' }), // 缺 old_string
    }, lightTheme)).toBeNull()
  })

  it('未知工具名 → null', () => {
    expect(formatPermissionDiff({
      toolName: 'some_unknown_tool',
      arguments: args({ path: '/repo/x' }),
    }, lightTheme)).toBeNull()
  })

  it('create 预览超 4 行且 theme.muted 缺失 → 省略号分支', () => {
    const content = Array.from({ length: 6 }, (_, i) => `m line ${i + 1}`).join('\n')
    const themeNoMuted = { ...lightTheme, muted: undefined } as unknown as typeof lightTheme
    const lines = formatPermissionDiff({
      toolName: 'str_replace_editor',
      arguments: args({ command: 'create', path: '/repo/m.ts', file_text: content }),
    }, themeNoMuted)
    expect(lines).not.toBeNull()
    const text = lines!.join('\n')
    expect(text).toContain('…')
    expect(text).not.toContain('共 6 行') // muted 缺失时无行数说明
  })
})
