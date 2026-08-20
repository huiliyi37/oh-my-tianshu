/**
 * InputLine ghost 预览（阶段 2 slash 菜单补全预览）— 渲染契约测试。
 *
 * - setGhost + displayLines：光标在末尾时 ghost 以 dim 样式显示在 █ 后
 * - 光标不在末尾 / 空值 / 有选区 → 不显示 ghost
 * - wrap 路径（maxWidth）：ghost 插入光标行并按剩余空间截断
 * - setGhost(null) 清除；幂等无副作用
 */

import { describe, expect, it } from 'vitest'
import { InputLine } from '../src/engine/input-line.js'

function plain(line: string): string {
  return line.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('InputLine ghost 预览', () => {
  it('光标在末尾：ghost 以 dim 样式显示在 █ 后', () => {
    const il = new InputLine({ value: '/th' })
    il.setGhost('eme')
    const [line = ''] = il.displayLines()
    expect(line).toContain('\x1B[2meme\x1B[22m') // dim
    expect(plain(line)).toBe('❯ /th█eme')
  })

  it('setGhost(null) 清除 ghost', () => {
    const il = new InputLine({ value: '/th' })
    il.setGhost('eme')
    il.setGhost(null)
    const [line = ''] = il.displayLines()
    expect(line).not.toContain('eme')
    expect(plain(line)).toBe('❯ /th█')
  })

  it('光标不在末尾：不显示 ghost', () => {
    const il = new InputLine({ value: '/theme' })
    il.setValue('/theme', 2) // 光标移到 /t 后
    il.setGhost('eme')
    const [line = ''] = il.displayLines()
    expect(line).not.toContain('\x1B[2m')
  })

  it('空值：不显示 ghost（占位符路径）', () => {
    const il = new InputLine({ placeholder: '询问' })
    il.setGhost('xx')
    const [line = ''] = il.displayLines()
    expect(line).not.toContain('xx')
  })

  it('有选区：不显示 ghost（选区行含 ANSI 高亮，插入会错位）', () => {
    const il = new InputLine({ value: 'abcd' })
    il.setGhost('XX')
    il.handleKey('home', '', false, false, true) // shift+home 全选
    const [line = ''] = il.displayLines()
    expect(line).not.toContain('XX')
  })

  it('wrap 路径（maxWidth）：ghost 插入光标行（wrap 行不含自绘 █）', () => {
    const il = new InputLine({ value: '/th' })
    il.setGhost('eme')
    const lines = il.displayLines({ maxWidth: 20 })
    const line = lines[0] ?? ''
    expect(plain(line)).toBe('❯ /th█eme')
  })

  it('wrap 路径：ghost 超出剩余空间时截断，行宽守恒', () => {
    const il = new InputLine({ value: '/th' })
    il.setGhost('eme-very-long-ghost-text')
    const lines = il.displayLines({ maxWidth: 7 })
    const line = lines[0] ?? ''
    // prefix(2) + /th(3) + █(1) = 6 → 剩余 1 列给 ghost
    expect(plain(line)).toBe('❯ /th█e')
  })

  it('setGhost 不触发 onChange（纯渲染状态）', () => {
    let changes = 0
    const il = new InputLine({ value: 'x', onChange: () => { changes++ } })
    il.setGhost('gh')
    il.setGhost(null)
    expect(changes).toBe(0)
  })
})

describe('多行 ↑↓ 导航 grapheme 列保持（CJK/emoji 不拆簇）', () => {
  // 回归（移植 dsh-tui ba45980）：列号曾以 code-unit 计——跨行移动时落在
  // 代理对/ZWJ 簇中间，光标错乱且后续插入拆碎 emoji（上游 dfe8b6f41 同款）。

  it('Up 保留 grapheme 列：光标落在完整 ZWJ emoji 簇之后', () => {
    const family = '👨‍👩‍👧' // ZWJ 簇：8 code units / 1 grapheme
    const il = new InputLine({ value: `${family}x\nz` })
    il.setValue(il.value, il.value.length) // 光标停在末行行尾（grapheme 列 1）

    il.handleKey('up', '', false, false)

    // 期望光标 = family.length（簇整体之后），而非簇中间的 code-unit 位置
    expect(il.cursor).toBe(family.length)
    il.handleKey('unknown', 'Q', false, false)
    expect(il.value).toBe(`${family}Qx\nz`)
  })

  it('Down 保留 grapheme 列：光标落在完整代理对之后', () => {
    const il = new InputLine({ value: 'z\n😀x' }) // 😀 = 2 code units / 1 grapheme
    il.setValue(il.value, 1) // 首行 grapheme 列 1

    il.handleKey('down', '', false, false)

    // z\n(2) + 😀(2 units) = 4；code-unit 直取会得到 3（代理对中间）
    expect(il.cursor).toBe(4)
    il.handleKey('unknown', 'Q', false, false)
    expect(il.value).toBe('z\n😀Qx')
  })

  it('CJK 混排跨行：列号按 grapheme 计保持到第 N 个字之后', () => {
    const il = new InputLine({ value: '你好世界\nab' })
    il.setValue(il.value, 7) // 末行行尾（grapheme 列 2）

    il.handleKey('up', '', false, false)
    expect(il.cursor).toBe(2) // 第 2 个 CJK 字之后（每字 1 code unit）

    il.handleKey('down', '', false, false)
    expect(il.cursor).toBe(7) // 回到末行同列
  })

  it('col 超出目标行 grapheme 数时贴到行尾（不越界）', () => {
    const il = new InputLine({ value: 'abcdefgh\nx' })
    il.setValue(il.value, 8) // 首行行尾（grapheme 列 8）

    il.handleKey('down', '', false, false)
    expect(il.cursor).toBe(il.value.length) // 末行行尾
  })
})
