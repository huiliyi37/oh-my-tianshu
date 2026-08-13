/**
 * mention-expand.spec.ts — Phase 9a @mention 用户侧摘要展开（staged spec 契约）。
 *
 * 覆盖：cwd 内文件展开、越界（../）拒绝、不存在降级、目录/符号降级为
 * 引用名、长文件截断折叠标记、无 mention 原样返回、多 token 混合。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { expandMentions } from '../src/mention-expand.js'

/** 建立带 fixtures 的临时工作区，返回 cwd。 */
function makeWorkspace(): { cwd: string; file: string; nested: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'mention-expand-'))
  const file = join(cwd, 'notes.md')
  writeFileSync(file, '第一行\n第二行\n第三行')
  mkdirSync(join(cwd, 'sub'))
  const nested = join(cwd, 'sub', 'deep.txt')
  writeFileSync(nested, '嵌套文件')
  return { cwd, file, nested }
}

describe('expandMentions', () => {
  it('cwd 内文件 → @path + 摘要', () => {
    const { cwd, file } = makeWorkspace()
    const out = expandMentions('看 @notes.md', cwd)
    expect(out).toContain('@notes.md')
    expect(out).toContain('第一行\n第二行\n第三行')
    expect(file).toBeTruthy()
  })

  it('无 mention → 原样返回', () => {
    const { cwd } = makeWorkspace()
    expect(expandMentions('普通文本', cwd)).toBe('普通文本')
  })

  it('越界（../）→ 降级为引用名，不读工作区外', () => {
    const { cwd } = makeWorkspace()
    const out = expandMentions('看 @../outside.md', cwd)
    expect(out).toBe('看 @../outside.md')
  })

  it('文件不存在 → 降级为引用名', () => {
    const { cwd } = makeWorkspace()
    const out = expandMentions('看 @missing.md', cwd)
    expect(out).toBe('看 @missing.md')
  })

  it('目录 → 降级为引用名（不读目录）', () => {
    const { cwd } = makeWorkspace()
    const out = expandMentions('看 @sub', cwd)
    expect(out).toBe('看 @sub')
  })

  it('长文件截断并带折叠标记', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mention-long-'))
    const lines = Array.from({ length: 50 }, (_, i) => `行 ${i}`)
    writeFileSync(join(cwd, 'big.md'), lines.join('\n'))
    const out = expandMentions('@big.md', cwd)
    expect(out).toContain('… [截断 50 行 /')
    // 只含前 20 行
    expect(out).toContain('行 0')
    expect(out).not.toContain('行 30')
  })

  it('多 token：展开 + 保留并存', () => {
    const { cwd } = makeWorkspace()
    const out = expandMentions('A @notes.md 与 @missing.md', cwd)
    expect(out).toContain('第一行')
    expect(out).toContain('@missing.md')
  })

  it('降级 token 在已展开 token 之前 → 展开与保留并存（keep 间隙分支）', () => {
    const { cwd } = makeWorkspace()
    // 从后往前：@notes.md 先展开（cursor 前移），@missing.md 再降级——
    // 此时 mention.end < cursor 成立，走 keep() 的间隙保留分支
    const out = expandMentions('A @missing.md 与 @notes.md', cwd)
    expect(out).toContain('第一行')
    expect(out).toContain('@missing.md')
    // 间隙文本「 与 」保留在降级 token 与展开块之间
    expect(out).toContain('@missing.md 与 @notes.md')
    expect(out).toContain('第一行')
  })

  it('嵌套目录内文件（cwd 内相对路径）可展开', () => {
    const { cwd, nested } = makeWorkspace()
    const out = expandMentions('@sub/deep.txt', cwd)
    expect(out).toContain('嵌套文件')
    expect(nested).toBeTruthy()
  })

  it('单行超 4KB → 字符截断 + 折叠标记', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mention-huge-'))
    writeFileSync(join(cwd, 'huge.md'), 'x'.repeat(5000))
    const out = expandMentions('@huge.md', cwd)
    expect(out).toContain('… [截断 1 行 / 5000 字符]')
    // 摘要本体只含前 4096 字符
    expect(out).toContain('x'.repeat(4096))
    expect(out).not.toContain('x'.repeat(4097))
  })

  it('folder token（尾斜杠）→ 原样保留，不展开', () => {
    const { cwd } = makeWorkspace()
    expect(expandMentions('看 @sub/', cwd)).toBe('看 @sub/')
  })

  it('symbol token（含 #）→ 原样保留，不展开', () => {
    const { cwd } = makeWorkspace()
    expect(expandMentions('见 @notes.md#L42', cwd)).toBe('见 @notes.md#L42')
  })

  it('raw token（引号空串）→ 原样保留，不展开', () => {
    const { cwd } = makeWorkspace()
    expect(expandMentions('@""', cwd)).toBe('@""')
  })

  it('引号形路径（含空格）→ 展开摘要', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mention-quoted-'))
    writeFileSync(join(cwd, 'my file.md'), '空格路径内容')
    const out = expandMentions('@"my file.md"', cwd)
    expect(out).toContain('空格路径内容')
  })
})
