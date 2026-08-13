/**
 * external-editor.spec.ts — Phase 6.4 外部编辑器（staged spec 契约）。
 *
 * 覆盖：编辑器命令解析（VISUAL/EDITOR/缺省）、临时文件往返、编辑内容
 * 回填、编辑器异常终止 → null。编辑路径用真实 spawnSync + 临时脚本，
 * 不 mock child_process——行为契约以真实进程为证。
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createTempFile,
  getDefaultEditor,
  getEditorCommand,
  openInEditor,
  readAndCleanup,
} from '../src/external-editor.js'

const tempDirs: string[] = []
afterAll(() => {
  // 临时目录清理（best-effort；unlink 失败不阻塞测试结果）
  for (const dir of tempDirs) {
    try { writeFileSync(join(dir, 'cleanup.marker'), '') } catch { /* ignore */ }
  }
})

describe('getEditorCommand', () => {
  it('VISUAL 优先于 EDITOR', () => {
    expect(getEditorCommand({ VISUAL: 'vim', EDITOR: 'nano' })).toBe('vim')
  })

  it('无 VISUAL 时用 EDITOR', () => {
    expect(getEditorCommand({ EDITOR: 'nano' })).toBe('nano')
  })

  it('两者皆无回退平台缺省（非空字符串）', () => {
    expect(getEditorCommand({})).toBeTruthy()
  })
})

describe('getDefaultEditor', () => {
  it('win32 平台回退 notepad', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      expect(getDefaultEditor()).toBe('notepad')
    } finally {
      Object.defineProperty(process, 'platform', { ...original })
    }
  })

  it('非 win32（当前平台）回退 vi', () => {
    expect(getDefaultEditor()).toBe('vi')
  })
})

describe('createTempFile / readAndCleanup', () => {
  it('临时文件写入内容并落在独立目录', () => {
    const path = createTempFile('hello 编辑器')
    tempDirs.push(path)
    expect(existsSync(path)).toBe(true)
    expect(path.startsWith(tmpdir())).toBe(true)
    expect(path.endsWith('RIVET_INPUT.md')).toBe(true)
  })

  it('readAndCleanup 读回内容并删除文件', () => {
    const path = createTempFile('原始内容')
    const content = readAndCleanup(path)
    expect(content).toBe('原始内容')
    expect(existsSync(path)).toBe(false)
  })
})

describe('openInEditor', () => {
  /** 生成一个修改文件内容的 shell 脚本（真实编辑器替身）。 */
  function makeEditorScript(replacement: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'rivet-edit-test-'))
    tempDirs.push(dir)
    const script = join(dir, 'editor.sh')
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "${replacement}" > "$1"\n`, { mode: 0o755 })
    return script
  }

  it('编辑器运行后回填修改内容', () => {
    const editor = makeEditorScript('EDITED')
    const result = openInEditor('original', editor)
    expect(result).toBe('EDITED')
  })

  it('编辑器不改文件时读回原内容', () => {
    const editor = makeEditorScript('original')
    const result = openInEditor('original', editor)
    expect(result).toBe('original')
  })

  it('编辑器不存在（异常终止）返回 null', () => {
    const result = openInEditor('x', '/nonexistent/editor-binary-xyz')
    expect(result).toBeNull()
  })

  it('编辑器缺省命令（未注入）：走 getEditorCommand 环境解析', () => {
    const prev = process.env.VISUAL
    try {
      process.env.VISUAL = makeEditorScript('EDITED')
      const result = openInEditor('original')
      expect(result).toBe('EDITED')
    } finally {
      if (prev === undefined) delete process.env.VISUAL
      else process.env.VISUAL = prev
    }
  })

  it('编辑器非零退出但无 error（文件已保存）→ 仍读回内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rivet-edit-test-'))
    tempDirs.push(dir)
    const script = join(dir, 'exit1.sh')
    writeFileSync(script, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const result = openInEditor('original', script)
    expect(result).toBe('original')
  })
})
