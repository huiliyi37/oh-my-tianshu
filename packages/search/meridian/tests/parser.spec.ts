import { describe, it, expect } from 'vitest'
import { detectLang, parseTypeScriptFile, parsePythonFile, parseGoFile } from '../src/parser.ts'

describe('detectLang', () => {
  it('扩展名 → 语言映射', () => {
    expect(detectLang('src/a.ts')).toBe('typescript')
    expect(detectLang('src/a.tsx')).toBe('typescript')
    expect(detectLang('src/a.js')).toBe('typescript')
    expect(detectLang('src/a.jsx')).toBe('typescript')
    expect(detectLang('src/a.py')).toBe('python')
    expect(detectLang('src/a.go')).toBe('go')
    expect(detectLang('src/a.rs')).toBeNull()
  })
})

describe('parseTypeScriptFile', () => {
  it('提取全部符号类型 + exported 标记', async () => {
    const src = `
import { helper } from './helper'
import type { T } from './types'

export function foo(a: number): number { return a }
export class Bar {
  baz(): void {}
}
export interface Qux { x: number }
type Alias = string
export enum Color { Red, Green }
const arrow = () => 1
`
    const result = await parseTypeScriptFile('src/a.ts', src)
    const byName = new Map(result.symbols.map(s => [s.name, s]))
    expect(result.symbols).toHaveLength(7)
    expect(byName.get('foo')!.kind).toBe('function')
    expect(byName.get('foo')!.exported).toBe(true)
    expect(byName.get('Bar')!.kind).toBe('class')
    expect(byName.get('Bar')!.exported).toBe(true)
    expect(byName.get('Qux')!.kind).toBe('interface')
    expect(byName.get('Alias')!.kind).toBe('type')
    expect(byName.get('Alias')!.exported).toBe(false)
    expect(byName.get('Color')!.kind).toBe('enum')
    expect(byName.get('arrow')!.kind).toBe('function') // 箭头函数变量
    // method 嵌套在 class 内
    const bar = byName.get('Bar')!
    const baz = result.symbols.find(s => s.name === 'baz')!
    expect(baz.kind).toBe('method')
    // contains 边：Bar → baz
    expect(result.edges).toContainEqual(expect.objectContaining({ sourceId: bar.id, targetId: baz.id, kind: 'contains' }))
  })

  it('imports 只收集相对路径', async () => {
    const src = `
import { x } from './local'
import { y } from '../up'
import z from 'external-pkg'
import type { T } from '@scope/pkg'
`
    const result = await parseTypeScriptFile('src/a.ts', src)
    expect(result.imports).toEqual(['./local', '../up'])
  })

  it('同文件 call 边 extracted + 未解析 call 进 calls', async () => {
    const src = `
function callee(): void {}
function caller(): void { callee(); unknownFn() }
`
    const result = await parseTypeScriptFile('src/a.ts', src)
    const caller = result.symbols.find(s => s.name === 'caller')!
    expect(result.edges).toContainEqual(expect.objectContaining({ sourceId: caller.id, kind: 'calls', confidence: 'extracted' }))
    // 未解析调用记录进 calls（跨文件匹配用）
    const calls = result.calls.filter(c => c.name === 'unknownFn')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sourceId).toBe(caller.id)
    // 同文件已解析的 callee 不进 calls
    expect(result.calls.filter(c => c.name === 'callee')).toHaveLength(0)
  })

  it('member_expression 调用取 property 名（方法调用）', async () => {
    const src = `
class A { run(): void {} }
function go(): void { const a = new A(); a.run() }
`
    const result = await parseTypeScriptFile('src/a.ts', src)
    // a.run() 的 callee 是 member_expression，property = run —— 本地符号 run（method）命中
    const run = result.symbols.find(s => s.name === 'run')!
    const edges = result.edges.filter(e => e.kind === 'calls' && e.targetId === run.id)
    expect(edges.length).toBeGreaterThan(0)
  })
})

describe('parsePythonFile', () => {
  it('提取 def/class + 顶层 exported + import', async () => {
    const src = `
import os
from .local import thing

def top_level(a):
    return a

class Service:
    def method(self):
        pass
`
    const result = await parsePythonFile('src/a.py', src)
    const byName = new Map(result.symbols.map(s => [s.name, s]))
    expect(byName.get('top_level')!.kind).toBe('function')
    expect(byName.get('top_level')!.exported).toBe(true) // 顶层即 exported
    expect(byName.get('Service')!.kind).toBe('class')
    expect(result.imports).toContain('os')
    expect(result.imports).toContain('.local')
  })
})

describe('parseGoFile', () => {
  it('提取 func/method/type + 大写 exported + import', async () => {
    const src = `
package main

import (
    "fmt"
    "os"
)

type Server struct{}

type Handler interface{ Handle() }

func main() {}

func (s *Server) Serve() {}
`
    const result = await parseGoFile('src/a.go', src)
    const byName = new Map(result.symbols.map(s => [s.name, s]))
    expect(byName.get('main')!.kind).toBe('function')
    expect(byName.get('main')!.exported).toBe(false) // 小写不导出
    expect(byName.get('Server')!.kind).toBe('type')
    expect(byName.get('Handler')!.kind).toBe('interface')
    expect(byName.get('Handler')!.exported).toBe(true)
    expect(byName.get('Serve')!.kind).toBe('method')
    expect(result.imports).toEqual(expect.arrayContaining(['fmt', 'os']))
  })
})
