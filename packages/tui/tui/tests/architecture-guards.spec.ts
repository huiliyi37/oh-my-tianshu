/**
 * architecture-guards.spec.ts — 架构守护：把设计约束变成红绿测试
 * （模式移植自 dsh-tui 9eef2f5，规则面按本仓裁剪）。
 *
 * 1. stdout 单写层：src/ 全域禁止 process.stdout.write——渲染输出只经注入的
 *    WriteStream（engine/），任何旁路直写都会绕过 write-batcher 与 live 区
 *    行数记账，产生不可重放的输出。stderr 允许（诊断直写，不进渲染面）。
 * 2. 子进程必须 windowsHide: true——Windows 上 spawn 不隐藏会在 conhost 弹出
 *    控制台窗口闪屏（git/剪贴板/图片链/LSP 均短命子进程）。
 * 3. format/ + render/ 纯函数无 I/O：禁止 import child_process/fs/net/http——
 *    这两个目录的可测性建立在无副作用之上。
 *
 * 扫描器是纯函数（虚拟语料输入），自检块用植入违规验证扫描器真的在工作。
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ── 语料收集 ─────────────────────────────────────────────────

interface SourceFile {
  path: string // src/ 相对路径
  lines: string[]
}

const SRC_ROOT = join(import.meta.dirname, '..', 'src')

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) collectTsFiles(full, acc)
    else if (name.endsWith('.ts')) acc.push(full)
  }
  return acc
}

function loadCorpus(root: string): SourceFile[] {
  return collectTsFiles(root).map(full => ({
    path: full.slice(root.length + 1),
    lines: readFileSync(full, 'utf-8').split('\n'),
  }))
}

/** 代码行 = 非注释行（//、*、/* 开头视为注释；字符串里的这类前缀误伤可忽略）。 */
function isCodeLine(line: string): boolean {
  const t = line.trimStart()
  return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}

// ── 规则 1：stdout 单写层 ─────────────────────────────────────

function findStdoutWrites(corpus: SourceFile[]): Array<{ path: string; line: number }> {
  const hits: Array<{ path: string; line: number }> = []
  for (const f of corpus) {
    f.lines.forEach((line, i) => {
      if (isCodeLine(line) && line.includes('process.stdout.write')) {
        hits.push({ path: f.path, line: i + 1 })
      }
    })
  }
  return hits
}

// ── 规则 2：子进程 windowsHide ────────────────────────────────

const SPAWN_RE = /\b(spawn|spawnSync|execFile|execFileSync|execFileAsync|execSync)\s*\(/
const SCAN_WINDOW = 8 // 调用行起向后看 N 行，覆盖跨行 options 对象

function findSpawnsWithoutWindowsHide(corpus: SourceFile[]): Array<{ path: string; line: number }> {
  const hits: Array<{ path: string; line: number }> = []
  for (const f of corpus) {
    f.lines.forEach((line, i) => {
      if (!isCodeLine(line) || !SPAWN_RE.test(line)) return
      const window = f.lines.slice(i, i + SCAN_WINDOW)
      if (!window.some(l => l.includes('windowsHide'))) {
        hits.push({ path: f.path, line: i + 1 })
      }
    })
  }
  return hits
}

// ── 规则 3：format/ + render/ 纯函数无 I/O ────────────────────

const IO_IMPORT_RE = /from\s+['"]node:(child_process|fs|fs\/promises|net|http|https|dgram|dns)['"]/

/** 规则 3：只扫指定目录前缀下的文件。 */
function findIoImportsIn(corpus: SourceFile[], prefixes: string[]): Array<{ path: string; line: number }> {
  const hits: Array<{ path: string; line: number }> = []
  for (const f of corpus) {
    if (!prefixes.some(p => f.path.startsWith(p))) continue
    f.lines.forEach((line, i) => {
      if (isCodeLine(line) && line.trimStart().startsWith('import') && IO_IMPORT_RE.test(line)) {
        hits.push({ path: f.path, line: i + 1 })
      }
    })
  }
  return hits
}

// ── 语料与规则执行 ───────────────────────────────────────────

const corpus = loadCorpus(SRC_ROOT)

describe('架构守护 · 规则执行', () => {
  it('src 全域无 process.stdout.write（stdout 单写层经注入 WriteStream）', () => {
    expect(findStdoutWrites(corpus)).toEqual([])
  })

  it('所有子进程调用携带 windowsHide: true（Windows 不弹控制台窗口）', () => {
    expect(findSpawnsWithoutWindowsHide(corpus)).toEqual([])
  })

  it('format/ 与 render/ 无 I/O 型 import（纯函数纪律）', () => {
    expect(findIoImportsIn(corpus, ['format/', 'render/'])).toEqual([])
  })
})

describe('架构守护 · 自检（扫描器必须真的在工作）', () => {
  const fakeCorpus: SourceFile[] = [
    { path: 'engine/fake.ts', lines: ['const x = 1', "process.stdout.write('boom')"] },
    { path: 'engine/fake2.ts', lines: ["// process.stdout.write('commented')", 'spawnSync("git", ["status"])'] },
    { path: 'engine/fake3.ts', lines: ['execSync("git status --short", {', '  stdio: "ignore",', '})'] },
    { path: 'format/fake.ts', lines: ["import { readFileSync } from 'node:fs'"] },
  ]

  it('stdout 扫描器捕获植入违规且跳过注释行', () => {
    const hits = findStdoutWrites(fakeCorpus)
    expect(hits).toEqual([{ path: 'engine/fake.ts', line: 2 }])
  })

  it('windowsHide 扫描器捕获 spawnSync/execSync 违规（注释行不计）', () => {
    const hits = findSpawnsWithoutWindowsHide(fakeCorpus)
    expect(hits).toEqual([
      { path: 'engine/fake2.ts', line: 2 },
      { path: 'engine/fake3.ts', line: 1 },
    ])
  })

  it('I/O import 扫描器只命中 format/ 前缀（engine/ 不受限）', () => {
    const hits = findIoImportsIn(fakeCorpus, ['format/', 'render/'])
    expect(hits).toEqual([{ path: 'format/fake.ts', line: 1 }])
  })
})
