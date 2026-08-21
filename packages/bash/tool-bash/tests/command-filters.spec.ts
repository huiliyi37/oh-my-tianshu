/** Per-command output filters: git log / git diff / test-run compaction. */
import { describe, expect, it } from 'vitest'
import { commandFilterDropsLines, filterCommandOutput, type CommandFilterConfig } from '../src/command-filters.ts'

const CONFIG: CommandFilterConfig = {
  enabled: true,
  gitLogMaxCommits: 15,
  gitDiffHunkMaxLines: 60,
  testRunMaxLines: 120,
}

/** 默认格式的 N 个 commit(git log)。 */
function gitLogDefault(commits: number): string {
  const out: string[] = []
  for (let i = 1; i <= commits; i++) {
    out.push(`commit ${String(i).padStart(40, '0')}`)
    out.push(`Merge: aaa${i} bbb${i}`)
    out.push(`Author: Dev ${i} <dev${i}@example.com>`)
    out.push(`Date:   Mon Aug ${i} 10:00:00 2026 +0800`)
    out.push('')
    out.push(`    commit message line 1 for #${i}`)
    out.push(`    commit message line 2 for #${i}`)
    out.push(`    commit message line 3 for #${i}`)
    out.push(`    commit message line 4 for #${i}`)
    out.push('    Co-Authored-By: Other <o@example.com>')
    out.push('')
  }
  return `${out.join('\n')}\n`
}

function gitDiffBody(hunks: number, linesPerHunk: number): string {
  const out: string[] = ['diff --git a/x.ts b/x.ts', 'index 111..222 100644', '--- a/x.ts', '+++ b/x.ts']
  for (let h = 1; h <= hunks; h++) {
    out.push(`@@ -${h * 10},7 +${h * 10},7 @@ function f${h}()`)
    for (let i = 0; i < linesPerHunk; i++) {
      out.push(i % 3 === 0 ? `-old ${h}.${i}` : i % 3 === 1 ? `+new ${h}.${i}` : ` ctx ${h}.${i}`)
    }
  }
  return `${out.join('\n')}\n`
}

function testRunBody(passing: number, failing: number): string {
  const lines = [' RUN  v1.0.0', '']
  for (let i = 1; i <= passing; i++) lines.push(`✓ case ${i} passes`)
  for (let i = 1; i <= failing; i++) {
    lines.push(`FAIL  tests/failing-${i}.spec.ts > suite ${i}`)
    for (let j = 0; j < 12; j++) lines.push(`  stack frame ${j} of failure ${i}`)
    lines.push(`  AssertionError: expected ${i} to be 0`)
    lines.push(`  Expected: 0  Received: ${i}`)
  }
  lines.push('')
  lines.push(`Test Files  ${failing} failed | ${passing} passed`)
  return `${lines.join('\n')}\n`
}

describe('filterCommandOutput — git log', () => {
  it('≤30 行不过滤', () => {
    const body = gitLogDefault(2)
    const out = filterCommandOutput('git log', body, CONFIG)
    expect(out.curated).toBe(false)
    expect(out.text).toBe(body)
  })

  it('保留前 N 个 commit,剥 Author/Merge/trailer,消息 ≤3 行,带省略标记', () => {
    const out = filterCommandOutput('git log -25', gitLogDefault(25), { ...CONFIG, gitLogMaxCommits: 5 })
    expect(out.curated).toBe(true)
    expect(out.text).toContain('[git-log filter: kept 5 of 25 commits — oldest dropped]')
    expect(out.text).toContain('commit message line 3 for #5')
    expect(out.text).not.toContain('commit message line 4 for #1')
    expect(out.text).not.toContain('Author:')
    expect(out.text).not.toContain('Merge:')
    expect(out.text).not.toContain('Co-Authored-By:')
    expect(out.text).toContain('Date:   Mon Aug 5')
    // 新 commit 在前:第 1 个保留、第 6 个丢弃。
    expect(out.text).toContain('commit message line 1 for #1')
    expect(out.text).not.toContain('for #6')
  })

  it('--oneline 形态按行截前 N 条', () => {
    const body = Array.from({ length: 50 }, (_, i) => `abc123${i} subject ${i}`).join('\n') + '\n'
    const out = filterCommandOutput('git log --oneline -50', body, { ...CONFIG, gitLogMaxCommits: 15 })
    expect(out.curated).toBe(true)
    expect(out.text).toContain('subject 14')
    expect(out.text).not.toContain('subject 15\n')
    expect(out.text).toContain('[git-log filter: kept 15 of 50 entries]')
  })

  it('自定义 --format 跳过(用户已声明意图)', () => {
    const body = Array.from({ length: 100 }, (_, i) => `${i}`).join('\n') + '\n'
    const out = filterCommandOutput('git log --format=%H -100', body, CONFIG)
    expect(out.curated).toBe(false)
  })
})

describe('filterCommandOutput — git diff', () => {
  it('≤40 行不过滤', () => {
    const body = gitDiffBody(1, 8)
    const out = filterCommandOutput('git diff', body, CONFIG)
    expect(out.curated).toBe(false)
  })

  it('每 hunk 截到上限并按文件附 +A -R 计数', () => {
    const out = filterCommandOutput('git diff HEAD~3', gitDiffBody(1, 100), { ...CONFIG, gitDiffHunkMaxLines: 20 })
    expect(out.curated).toBe(true)
    expect(out.text).toContain('-old 1.0')
    expect(out.text).toContain('+new 1.19')
    expect(out.text).not.toContain('old 1.20')
    expect(out.text).toMatch(/# \+\d+ -\d+$/m)
  })

  it('总量 300 行封顶,尾部省略标记', () => {
    const out = filterCommandOutput('git diff main', gitDiffBody(20, 40), { ...CONFIG, gitDiffHunkMaxLines: 60 })
    expect(out.curated).toBe(true)
    const lineCount = out.text.split('\n').length
    expect(lineCount).toBeLessThanOrEqual(GIT_DIFF_TOTAL_LINES + 2)
    expect(out.text).toContain('diff lines omitted')
  })
})

describe('filterCommandOutput — test run', () => {
  it('≤15 行不过滤', () => {
    const out = filterCommandOutput('pnpm test', testRunBody(3, 0), CONFIG)
    expect(out.curated).toBe(false)
  })

  it('失败块 + 上下文窗口保留,头尾锚保留,带计数头', () => {
    const out = filterCommandOutput('pnpm vitest run', testRunBody(30, 2), CONFIG)
    expect(out.curated).toBe(true)
    expect(out.text).toContain('[test filter: kept')
    expect(out.text).toContain('AssertionError: expected 1 to be 0')
    expect(out.text).toContain('stack frame 0 of failure 1')
    expect(out.text).toContain('Test Files  2 failed | 30 passed')
    // 通过行只在头尾锚窗口内出现。
    expect(out.text).not.toContain('case 20 passes')
  })

  it('maxLines 封顶(超预算头尾切分)', () => {
    const out = filterCommandOutput('npm test', testRunBody(0, 60), { ...CONFIG, testRunMaxLines: 30 })
    const kept = out.text.split('\n').filter(line => line.includes('stack frame')).length
    expect(kept).toBeLessThanOrEqual(30)
    expect(out.text).toContain('failure 1')
  })

  it('非测试命令不匹配', () => {
    const body = testRunBody(30, 2)
    const out = filterCommandOutput('cat build.log', body, CONFIG)
    expect(out.curated).toBe(false)
  })
})

describe('filterCommandOutput — 总开关', () => {
  it('enabled: false 全部直通', () => {
    const body = gitLogDefault(50)
    const out = filterCommandOutput('git log', body, { ...CONFIG, enabled: false })
    expect(out.curated).toBe(false)
    expect(out.text).toBe(body)
  })
})

describe('commandFilterDropsLines — execute 时落盘谓词', () => {
  it('git log 超阈值 → true;否则 false', () => {
    expect(commandFilterDropsLines('git log', gitLogDefault(25), CONFIG)).toBe(true)
    expect(commandFilterDropsLines('git log', gitLogDefault(2), CONFIG)).toBe(false)
  })

  it('非匹配命令恒 false', () => {
    expect(commandFilterDropsLines('ls -la', 'x\n'.repeat(100), CONFIG)).toBe(false)
  })
})

const GIT_DIFF_TOTAL_LINES = 300
