import { describe, it, expect } from 'vitest'
import { stripComments, extractExpressRoutes, extractJsxChildren } from '../src/framework.ts'
import type { MeridianSymbol } from '../src/types.ts'

function sym(name: string, line: number, kind: MeridianSymbol['kind'] = 'function'): MeridianSymbol {
  return { id: `src/app.ts:${name}:${line}`, name, kind, filePath: 'src/app.ts', line, exported: true, contentHash: 'h' }
}

describe('stripComments', () => {
  it('剥离行注释与块注释，保留字符串字面量内容', () => {
    const src = `const url = '//not-a-comment'
// line comment
const x = 1 /* block */ + 2
const s = "/* not a comment */"`
    const out = stripComments(src)
    expect(out).not.toContain('line comment')
    expect(out).not.toContain('block')
    expect(out).toContain("'//not-a-comment'")
    expect(out).toContain('"/* not a comment */"')
  })

  it('块注释保留换行（行号对齐）', () => {
    const src = 'a\n/* multi\nline */\nb'
    const out = stripComments(src)
    expect(out.split('\n')).toHaveLength(4) // a, (blank from block), (blank), b
    expect(out).toContain('a\n\n\nb')
  })
})

describe('extractExpressRoutes', () => {
  it('提取路由符号 + 命名 handler 的 route_handles 边', () => {
    const source = `
const app = express()
app.get('/users', listUsers)
app.post('/users', createUser, validate)
`
    const known = [sym('listUsers', 3), sym('createUser', 4)]
    const { symbols, edges } = extractExpressRoutes('src/app.ts', source, known)
    expect(symbols).toHaveLength(2)
    expect(symbols[0]).toMatchObject({ kind: 'route', name: 'GET /users' })
    // listUsers 是最后一个参数且已知 → 边
    expect(edges).toContainEqual(expect.objectContaining({
      sourceId: symbols[0]!.id,
      targetId: known[0]!.id,
      kind: 'route_handles',
      confidence: 'inferred',
    }))
    // createUser 前有 middleware（validate 是 last arg，未知）→ 无 createUser 边
    expect(edges.filter(e => e.targetId === known[1]!.id)).toHaveLength(0)
  })

  it('内联箭头 handler 不产生边（无名可解析）', () => {
    const source = 'app.get(\'/x\', (req, res) => { res.send(\'ok\') })'
    const { symbols, edges } = extractExpressRoutes('src/app.ts', source, [])
    expect(symbols).toHaveLength(1) // 路由符号仍产生
    expect(edges).toHaveLength(0) // 无名 → 无边
  })

  it('未知 handler 不产生边（抗过度提取）', () => {
    const source = 'app.get(\'/x\', notDefinedAnywhere)'
    const { edges } = extractExpressRoutes('src/app.ts', source, [sym('somethingElse', 1)])
    expect(edges).toHaveLength(0)
  })
})

describe('extractJsxChildren', () => {
  it('PascalCase 标签 → 已知子组件 jsx_children 边（enclosing 最近符号）', () => {
    const source = `
export function Page() {
  return <Header />
}
`
    const fileSymbols = [sym('Page', 2)]
    const known = [sym('Page', 2), sym('Header', 10, 'function')]
    const { edges } = extractJsxChildren('src/page.tsx', source, fileSymbols, known)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ sourceId: fileSymbols[0]!.id, targetId: known[1]!.id, kind: 'jsx_children', confidence: 'inferred' })
  })

  it('小写 HTML 标签与未知组件忽略', () => {
    const source = 'export function A() { return <div><UnknownThing /></div> }'
    const { edges } = extractJsxChildren('src/a.tsx', source, [sym('A', 1)], [sym('A', 1)])
    expect(edges).toHaveLength(0)
  })
})
