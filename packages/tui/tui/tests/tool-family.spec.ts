/**
 * format/tool-family.ts — 工具家族着色分类契约测试。
 *
 * 五色家族映射（文件蓝/shell 黄/搜索绿/编辑紫/网络青）+ 未知名工具落 other(dim)。
 * toolShell 缺失时 network 回退 primary。
 */

import { describe, expect, it } from 'vitest'
import {
  getToolColorFamily,
  toolFamilyColor,
} from '../src/format/tool-family.js'

function familyTheme(over: Partial<{ toolShell: string }> = {}): {
  primary: string
  secondary: string
  success: string
  warning: string
  dim: string
  toolShell?: string
} {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', dim: '#666666',
    ...over,
  }
}

describe('getToolColorFamily', () => {
  it('文件操作系 → file', () => {
    for (const name of ['read_file', 'write_file', 'edit_file', 'glob', 'repo_map', 'ls']) {
      expect(getToolColorFamily(name)).toBe('file')
    }
  })

  it('bash → shell；检索系 → search', () => {
    expect(getToolColorFamily('bash')).toBe('shell')
    // PTC/Code Mode 单一执行工具与 bash 同族（执行型，wire 上模型直呼 run_code）。
    expect(getToolColorFamily('run_code')).toBe('shell')
    for (const name of ['grep', 'ast_grep', 'semantic_search', 'related_tests']) {
      expect(getToolColorFamily(name)).toBe('search')
    }
  })

  it('补丁编辑系 → edit；网络系 → network', () => {
    for (const name of ['apply_patch', 'hash_edit', 'str_replace', 'str_replace_editor']) {
      expect(getToolColorFamily(name)).toBe('edit')
    }
    for (const name of ['web_fetch', 'web_search']) {
      expect(getToolColorFamily(name)).toBe('network')
    }
  })

  it('未知名工具 → other', () => {
    expect(getToolColorFamily('unknown_tool')).toBe('other')
  })
})

describe('toolFamilyColor', () => {
  it('各家族映射到语义 token', () => {
    const theme = familyTheme({ toolShell: '#131313' })
    expect(toolFamilyColor('read_file', theme)).toBe('#111111')   // file → primary
    expect(toolFamilyColor('bash', theme)).toBe('#444444')        // shell → warning
    expect(toolFamilyColor('grep', theme)).toBe('#333333')        // search → success
    expect(toolFamilyColor('apply_patch', theme)).toBe('#222222') // edit → secondary
    expect(toolFamilyColor('web_fetch', theme)).toBe('#131313')   // network → toolShell
    expect(toolFamilyColor('unknown_tool', theme)).toBe('#666666') // other → dim
  })

  it('toolShell 缺失时 network 回退 primary', () => {
    const theme = familyTheme()
    expect(toolFamilyColor('web_fetch', theme)).toBe('#111111')
  })
})
