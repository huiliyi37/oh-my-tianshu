/**
 * mention-parser — @路径展开解析器（RED 基线）。
 *
 * 纯函数：输入文本 + 光标 → 光标处的候选 @token（含 span/value/引号态）。
 * 不读文件——文件内容摘要展开由装配层（后续）接线。
 *
 * 覆盖：
 * - findMentionAt：光标在 token 内/末尾视为编辑中；空白间隙、非 @ 区返回 null
 * - parseMentions：裸 token 与引号形 @"a b.ts" 全量提取
 * - mentionKind：按 token 形状启发式分类（file/folder/symbol/raw）
 */

import { describe, expect, it } from 'vitest'
import { findMentionAt, mentionKind, parseMentions } from '../src/mention-parser.js'

describe('findMentionAt — 光标处候选 @token', () => {
  it('光标在 token 中段 → 该 token', () => {
    const t = findMentionAt('看 @src/foo.ts 这段', 7)
    expect(t).not.toBeNull()
    expect(t?.start).toBe(2)
    expect(t?.end).toBe(13)
    expect(t?.value).toBe('src/foo.ts')
    expect(t?.quoted).toBe(false)
  })

  it('光标在 token 末尾（刚打完最后一个字符）→ 仍视为编辑中', () => {
    const t = findMentionAt('看 @src/foo.ts 这段', 13)
    expect(t?.value).toBe('src/foo.ts')
  })

  it('光标在 @ 符号上 → 空 token 候选（等待输入路径）', () => {
    const t = findMentionAt('看 @src/foo.ts', 2)
    expect(t).not.toBeNull()
    expect(t?.value).toBe('src/foo.ts')
  })

  it('光标在空白间隙 / 普通文本区 → null', () => {
    expect(findMentionAt('看 @src/foo.ts 这段', 14)).toBeNull() // 空格后
    expect(findMentionAt('hello world', 5)).toBeNull() // 无 @
  })

  it('多个 mention：光标落在哪个 token 就返回哪个', () => {
    const input = '@a.ts @b.ts'
    expect(findMentionAt(input, 2)?.value).toBe('a.ts')
    expect(findMentionAt(input, 9)?.value).toBe('b.ts')
  })

  it('引号形 @"a b.ts"：token 跨越空格，quoted=true', () => {
    const input = '见 @"src/my file.ts" 结尾'
    const t = findMentionAt(input, 12)
    expect(t).not.toBeNull()
    expect(t?.quoted).toBe(true)
    expect(t?.value).toBe('src/my file.ts')
    // end 指向闭合引号之后
    expect(input.slice(t!.start, t!.end)).toBe('@"src/my file.ts"')
  })

  it('光标在引号 token 外（闭合后）→ null', () => {
    const input = '见 @"src/my file.ts" 结尾'
    expect(findMentionAt(input, 21)).toBeNull()
  })

  it('光标越界（<0 或 > input.length）→ null', () => {
    expect(findMentionAt('@a.ts', -1)).toBeNull()
    expect(findMentionAt('@a.ts', 6)).toBeNull()
  })
})

describe('parseMentions — 全量提取', () => {
  it('提取全部裸 token', () => {
    const refs = parseMentions('@a.ts 和 @b/c.ts 一起')
    expect(refs.map(r => r.value)).toEqual(['a.ts', 'b/c.ts'])
    expect(refs[0]?.start).toBe(0)
    expect(refs[1]?.start).toBe(8)
  })

  it('无 mention → 空数组', () => {
    expect(parseMentions('没有引用')).toEqual([])
  })

  it('引号 token 保留空格', () => {
    const refs = parseMentions('@"a b.ts"')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.value).toBe('a b.ts')
    expect(refs[0]?.quoted).toBe(true)
  })

  it('孤 @ 或 @+空白不产生 token', () => {
    expect(parseMentions('@ 后面是空白')).toEqual([])
    expect(parseMentions('@')).toEqual([])
  })

  it('引号形内部 @ 不产生额外 token（裸正则跳过已消费区域）', () => {
    const refs = parseMentions('@"a @b.ts"')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.value).toBe('a @b.ts')
    expect(refs[0]?.quoted).toBe(true)
  })
})

describe('mentionKind — token 形状启发式分类', () => {
  it('尾斜杠 → folder', () => {
    expect(mentionKind('src/')).toBe('folder')
    expect(mentionKind('src/lib/')).toBe('folder')
  })

  it('含 # 或 :: → symbol', () => {
    expect(mentionKind('src/app.ts#L42')).toBe('symbol')
    expect(mentionKind('Foo::bar')).toBe('symbol')
  })

  it('其余 → file', () => {
    expect(mentionKind('src/foo.ts')).toBe('file')
    expect(mentionKind('package.json')).toBe('file')
  })

  it('空串 → raw（无法分类）', () => {
    expect(mentionKind('')).toBe('raw')
  })
})
