// Framework-level extraction —— 天枢 src/repo/meridian-framework.ts 原样移植。
// 与 tree-sitter 符号通道不同，这些提取器基于去注释源码上的正则。
// 所有产出的边带 `inferred` 置信度：handler/child 目标按名字对照调用方提供的
// 已知符号表解析，绝不连到本仓库不存在的符号（抗过度提取）。

import type { MeridianSymbol, MeridianEdge, MeridianSymbolKind } from './types.ts'

/** Remove line + block comments while preserving string-literal contents. */
/** 去除行/块注释并保留字符串字面量内容；块注释保留换行以对齐行号。
 * @param source - 源码。
 * @returns 去注释源码。 */
export function stripComments(source: string): string {
  let out = ''
  let i = 0
  let inStr: string | null = null
  while (i < source.length) {
    const ch = source[i] ?? ''
    if (inStr) {
      out += ch
      if (ch === '\\' && i + 1 < source.length) {
        out += source[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === inStr) inStr = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      // Block comment: drop the content but keep newlines so downstream
      // line numbers (route line, JSX enclosing order) stay aligned with
      // the original source.
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n'
        i++
      }
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

const ROUTE_HEAD_RE = /\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,/g

/** Tail identifier of an expression: `auth, listUsers` → `listUsers`. */
function tailIdent(expr: string): string | null {
  const cleaned = expr.replace(/\s+/g, '').replace(/\(\)$/, '')
  const m = cleaned.match(/(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$/)
  return m ? (m[1] ?? '') : null
}

/** Express 风格路由提取：route 符号 + route_handles 边（handler 按已知符号名解析）。
 * @param filePath - 文件路径。
 * @param source - 源码。
 * @param knownSymbols - 可解析的符号表。
 * @returns 新符号与边。 */
export function extractExpressRoutes(
  filePath: string,
  source: string,
  knownSymbols: MeridianSymbol[],
): { symbols: MeridianSymbol[]; edges: MeridianEdge[] } {
  const symbols: MeridianSymbol[] = []
  const edges: MeridianEdge[] = []
  const safe = stripComments(source)
  const knownByName = new Map<string, MeridianSymbol[]>()
  for (const s of knownSymbols) {
    const arr = knownByName.get(s.name) ?? []
    arr.push(s)
    knownByName.set(s.name, arr)
  }

  let m: RegExpExecArray | null
  while ((m = ROUTE_HEAD_RE.exec(safe)) !== null) {
    const method = (m[2] ?? '').toUpperCase()
    const routePath = m[3] ?? ''
    if (method === 'USE' && !routePath.startsWith('/')) continue
    const line = safe.slice(0, m.index).split('\n').length
    const name = `${method} ${routePath}`
    const routeId = `${filePath}:${name}:${line}`
    symbols.push({ id: routeId, name, kind: 'route', filePath, line, exported: false, contentHash: '' })

    // Argument list = balanced parens from the call's open paren, so inline
    // arrow handlers with nested braces don't truncate it.
    const openParen = safe.indexOf('(', m.index)
    const closeParen = openParen >= 0 ? matchDelim(safe, openParen, '(', ')') : -1
    const args = closeParen > openParen ? safe.slice(openParen + 1, closeParen) : ''
    if (args.includes('=>')) continue // anonymous arrow — nothing to name-resolve

    const parts = args.split(',').map(s => s.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    const handlerName = last ? tailIdent(last) : null
    if (!handlerName) continue
    const matches = knownByName.get(handlerName)
    const resolved = matches && matches.length === 1 ? matches[0] : null
    if (resolved) {
      edges.push({
        sourceId: routeId,
        targetId: resolved.id,
        kind: 'route_handles',
        weight: 1.0,
        confidence: 'inferred',
      })
    }
  }
  return { symbols, edges }
}

const JSX_TAG_RE = /<([A-Z][A-Za-z0-9_]*)[\s/>]/g

/** PascalCase JSX 标签 → 包围组件到已知子符号的 jsx_children 边。
 * @param _filePath - 文件路径。
 * @param source - 源码。
 * @param fileSymbols - 文件内符号（包围组件候选）。
 * @param knownSymbols - 已知符号表。
 * @returns 边列表。 */
export function extractJsxChildren(
  _filePath: string,
  source: string,
  fileSymbols: MeridianSymbol[],
  knownSymbols: MeridianSymbol[],
): { symbols: MeridianSymbol[]; edges: MeridianEdge[] } {
/* jscpd:ignore-start */
  const edges: MeridianEdge[] = []
  const safe = stripComments(source)
  const knownByName = new Map<string, MeridianSymbol[]>()
  for (const s of knownSymbols) {
    const arr = knownByName.get(s.name) ?? []
    arr.push(s)
    knownByName.set(s.name, arr)
  }
  /* jscpd:ignore-end */
  // Enclosing candidates: file-local symbols ordered by start line.
  const enclosing = [...fileSymbols].sort((a, b) => a.line - b.line)

  let m: RegExpExecArray | null
  while ((m = JSX_TAG_RE.exec(safe)) !== null) {
    const tag = m[1] ?? ''
    const line = safe.slice(0, m.index).split('\n').length
    const matches = knownByName.get(tag)
    const target = matches && matches.length === 1 ? matches[0] : null
    if (!target) continue
    // Nearest symbol starting at or before this tag's line.
    let parent: MeridianSymbol | null = null
    for (const s of enclosing) {
      if (s.line <= line) parent = s
      else break
    }
    if (!parent) continue
    edges.push({
      sourceId: parent.id,
      targetId: target.id,
      kind: 'jsx_children',
      weight: 1.0,
      confidence: 'inferred',
    })
  }
  return { symbols: [], edges }
}

/** Index of the delimiter matching the one at `open`, skipping string literals. */
function matchDelim(s: string, open: number, oc: string, cc: string): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const ch = s[i] ?? ''
    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < s.length && s[i] !== ch) {
        if (s[i] === '\\') i++
        i++
      }
      continue
    }
    if (ch === oc) depth++
    else if (ch === cc) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export type { MeridianSymbolKind }
