/**
 * verification.spec.ts — 验证检测（零测试框架耦合，命令文本启发式）。
 *
 * 覆盖：测试命令识别（vitest/pytest/node --test/npm/pnpm test）、
 * 输出状态判定（passed/failed/blocked）、非测试命令忽略。
 */
import { describe, expect, it } from 'vitest'
import { classifyVerification, detectVerification, type VerificationStatus } from '../src/verification.js'

describe('detectVerification — 命令识别', () => {
  it('识别 vitest 命令', () => {
    expect(detectVerification('pnpm vitest run src/foo.spec.ts')).not.toBeNull()
    expect(detectVerification('npx vitest run foo')).not.toBeNull()
  })

  it('识别 pytest / node --test / npm test / pnpm test', () => {
    expect(detectVerification('python -m pytest tests/foo.py')).not.toBeNull()
    expect(detectVerification('node --test tests/foo.test.mjs')).not.toBeNull()
    expect(detectVerification('npm test')).not.toBeNull()
    expect(detectVerification('pnpm test')).not.toBeNull()
    expect(detectVerification('npm run test:unit')).not.toBeNull()
  })

  it('非测试命令不识别', () => {
    expect(detectVerification('ls -la')).toBeNull()
    expect(detectVerification('git status')).toBeNull()
    expect(detectVerification('cat src/foo.ts')).toBeNull()
  })
})

describe('classifyVerification — 输出状态判定', () => {
  const run = (command: string, output: string): VerificationStatus | null => classifyVerification(command, output)

  it('passed：vitest 摘要含全过', () => {
    expect(run('pnpm vitest run foo', 'Test Files  1 passed (1)\nTests  10 passed (10)')).toBe('passed')
  })

  it('failed：输出含失败标记', () => {
    expect(run('pnpm vitest run foo', 'Tests  1 failed | 9 passed')).toBe('failed')
    expect(run('python -m pytest', 'FAILED tests/test_foo.py::test_bar')).toBe('failed')
    expect(run('pnpm vitest run foo', 'AssertionError: expected true to be false')).toBe('failed')
  })

  it('blocked：超时/中断/无输出', () => {
    expect(run('pnpm vitest run foo', 'Error: Command timed out after 120s')).toBe('blocked')
    expect(run('pnpm vitest run foo', 'SIGKILL')).toBe('blocked')
  })

  it('命令未识别时即使输出像测试也返回 null', () => {
    expect(run('ls -la', 'Tests  1 failed')).toBeNull()
  })
})

describe('detectVerification — targetFiles 透传', () => {
  it('带 targetFiles 时元数据包含目标文件列表', () => {
    const meta = detectVerification('pnpm vitest run foo', 'Tests  10 passed (10)', ['src/foo.ts'])
    expect(meta).not.toBeNull()
    expect(meta!.targetFiles).toEqual(['src/foo.ts'])
  })

  it('不带 targetFiles 时元数据不含该字段', () => {
    const meta = detectVerification('pnpm vitest run foo', 'Tests  10 passed (10)')
    expect(meta).not.toBeNull()
    expect('targetFiles' in meta!).toBe(false)
  })
})
