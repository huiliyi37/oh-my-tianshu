/**
 * Phase 6.3 文件路径自动补全 — RED 基线。
 *
 * 覆盖：
 * - extractAtToken：@ token 提取（emoji/CJK 不切碎）、无 @ 返回 null、@ 后空串
 * - getCompletions：git ls-files 候选（非 git 目录静默 []、prefix 优先排序、超时兜底）
 * - applyCompletion：规范形 @file: mention（含空格引用形）+ 光标位置
 * - resolveFileCompletion：Tab 协调——有 @ 路径 token 且命中候选才接管，否则返回 null
 * - InputController.tabComplete：首次 Tab 补全 + 多候选循环 + 唯一候选不循环 + 无路径保持原行为
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyCompletion,
  extractAtToken,
  getCompletions,
  resolveFileCompletion,
} from '../src/completion/file-completer.js'
import { InputController } from '../src/engine/input-controller.js'

/** 临时目录登记表：afterEach 统一清理（含 PATH stub 目录）。 */
const tmpDirs: string[] = []
function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('extractAtToken', () => {
  it('返回光标前最近 @ 起的非空白 token', () => {
    expect(extractAtToken('hello @src/age', 14)).toBe('src/age')
  })

  it('光标前无 @ 时返回 null', () => {
    expect(extractAtToken('hello world', 11)).toBeNull()
  })

  it('emoji/CJK 不被切碎（完整 token 交给补全）', () => {
    expect(extractAtToken('try @🎯-target.md', 'try @🎯-target.md'.length)).toBe('🎯-target.md')
    expect(extractAtToken('check @中文/file.ts', 'check @中文/file.ts'.length)).toBe('中文/file.ts')
  })

  it('光标恰在 @ 后时返回空串', () => {
    expect(extractAtToken('hello @', 7)).toBe('')
  })
})

describe('applyCompletion', () => {
  it('产出规范形 @file: mention（mention-parser 可解析）并定位光标', () => {
    // 输入 'open @src/ag' 光标在 10（'@src/' 末尾）——applyCompletion 把
    // @-token 整体替换为规范 mention + 空格，光标后的 'ag' 保留在尾部。
    const out = applyCompletion('open @src/ag', 10, 'src/agent.ts')
    expect(out.text).toBe('open @file:src/agent.ts ag')
    // 24 = 'open ' (5) + '@file:src/agent.ts '.length (19)
    expect(out.cursor).toBe(24)
  })

  it('含空格路径用引用形', () => {
    const out = applyCompletion('open @Pro', 9, 'Program Files/a.ts')
    expect(out.text).toBe('open @file:"Program Files/a.ts" ')
  })
})

describe('getCompletions', () => {
  it('非 git 目录静默返回 []，不抛错（@ 补全是建议而非必须）', () => {
    const dir = makeTmpDir('dsh-completer-nogit-')
    expect(getCompletions('any', dir, 8)).toEqual([])
  })

  it('真实 git 仓库中 prefix 优先于 substring、按长度排序', () => {
    const dir = makeTmpDir('dsh-completer-git-')
    writeFileSync(join(dir, 'src.ts'), '// src')
    writeFileSync(join(dir, 'src-test.ts'), '// src test')
    writeFileSync(join(dir, 'other.ts'), '// other')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    const out = getCompletions('src', dir, 8, 10_000)
    expect(out).toContain('src.ts')
    expect(out).toContain('src-test.ts')
    expect(out.indexOf('src.ts')).toBeLessThan(out.indexOf('src-test.ts'))
    expect(out).not.toContain('other.ts')
  })

  it('substring-only 候选排在 prefix 候选之后（startsWith false 分支）', () => {
    const dir = makeTmpDir('dsh-completer-sub-')
    writeFileSync(join(dir, 'src.ts'), '// src')
    writeFileSync(join(dir, 'osrc.ts'), '// osrc')
    writeFileSync(join(dir, 'osrc2.ts'), '// osrc2')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    const out = getCompletions('src', dir, 8, 10_000)
    // osrc.ts/osrc2.ts 含 'src' 但不以 'src' 开头：startsWith false → 排在 prefix 命中之后
    expect(out[0]).toBe('src.ts')
    expect(out.indexOf('src.ts')).toBeLessThan(out.indexOf('osrc.ts'))
    expect(out.indexOf('osrc.ts')).toBeLessThan(out.indexOf('osrc2.ts'))
  })

  it('git 挂起时 500ms 超时兜底返回 []（PATH 注入永远 sleep 的假 git）', () => {
    const dir = makeTmpDir('dsh-completer-timeout-')
    const stubDir = makeTmpDir('dsh-completer-stub-')
    const stubGit = join(stubDir, 'git')
    writeFileSync(stubGit, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
    const savedPath = process.env.PATH
    process.env.PATH = `${stubDir}:${savedPath ?? ''}`
    try {
      const t0 = Date.now()
      const out = getCompletions('x', dir, 8)
      const elapsed = Date.now() - t0
      expect(out).toEqual([])
      // 500ms 超时 + spawn 开销，1.5s 安全边际
      expect(elapsed).toBeLessThan(1500)
    } finally {
      process.env.PATH = savedPath
    }
  })
})

describe('resolveFileCompletion（Tab 协调：有路径提示才接管）', () => {
  it('光标前无 @ token → null（Tab 保持原行为）', () => {
    const dir = makeTmpDir('dsh-completer-coord-')
    expect(resolveFileCompletion('hello world', 11, dir)).toBeNull()
    // 输入以 / 开头的 slash 命令也不接管（slash 语义不归文件补全）
    expect(resolveFileCompletion('/theme', 6, dir)).toBeNull()
  })

  it('@ token 命中候选 → 返回 token 与候选列表', () => {
    const dir = makeTmpDir('dsh-completer-coord-')
    writeFileSync(join(dir, 'src.ts'), '// src')
    writeFileSync(join(dir, 'src-test.ts'), '// src test')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    const resolved = resolveFileCompletion('open @src', 'open @src'.length, dir, 8)
    expect(resolved).not.toBeNull()
    expect(resolved!.token).toBe('src')
    expect(resolved!.candidates).toContain('src.ts')
    expect(resolved!.candidates).toContain('src-test.ts')
  })

  it('@ token 无候选 → null', () => {
    const dir = makeTmpDir('dsh-completer-coord-')
    writeFileSync(join(dir, 'src.ts'), '// src')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    expect(resolveFileCompletion('open @zzz', 'open @zzz'.length, dir, 8)).toBeNull()
  })
})

describe('InputController.tabComplete（Tab 循环状态机）', () => {
  function gitDirWith(files: string[]): string {
    const dir = makeTmpDir('dsh-completer-ctrl-')
    for (const f of files) writeFileSync(join(dir, f), `// ${f}`)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    return dir
  }

  it('首次 Tab 应用首候选并记录补全状态', () => {
    const dir = gitDirWith(['src.ts', 'src-test.ts'])
    const ctrl = new InputController()
    const out = ctrl.tabComplete('open @src', 'open @src'.length, dir)
    expect(out).not.toBeNull()
    expect(out!.text).toBe('open @file:src.ts ')
    expect(out!.cursor).toBe(18) // 'open @file:src.ts '.length
    expect(ctrl.fileCompletion).not.toBeNull()
    expect(ctrl.fileCompletion!.candidates).toHaveLength(2)
    expect(ctrl.fileCompletion!.idx).toBe(0)
  })

  it('多候选时再次 Tab 循环到下一候选', () => {
    const dir = gitDirWith(['src.ts', 'src-test.ts'])
    const ctrl = new InputController()
    ctrl.tabComplete('open @src', 'open @src'.length, dir)
    const out2 = ctrl.tabComplete('open @file:src.ts ', 'open @file:src.ts '.length, dir)
    expect(out2!.text).toBe('open @file:src-test.ts ')
    expect(ctrl.fileCompletion!.idx).toBe(1)
  })

  it('唯一候选不进入循环模式（fileCompletion 置空）', () => {
    const dir = gitDirWith(['only.ts'])
    const ctrl = new InputController()
    const out = ctrl.tabComplete('open @onl', 'open @onl'.length, dir)
    expect(out!.text).toBe('open @file:only.ts ')
    expect(ctrl.fileCompletion).toBeNull()
  })

  it('无 @ 路径提示 → null，不触碰状态（原行为保持）', () => {
    const dir = gitDirWith(['src.ts'])
    const ctrl = new InputController()
    expect(ctrl.tabComplete('hello world', 11, dir)).toBeNull()
    expect(ctrl.tabComplete('/theme', 6, dir)).toBeNull()
    expect(ctrl.fileCompletion).toBeNull()
  })
})
