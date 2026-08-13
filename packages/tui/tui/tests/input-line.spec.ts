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
