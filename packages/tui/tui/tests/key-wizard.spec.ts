/**
 * key-wizard.spec.ts — /key 供应商选择步骤纯函数层的单测：引用派生规则
 * （与 web 模型页 store.ts 的 deriveKeyRef 同规则钉死）、profile 声明优先的
 * 解析次序、picker 条目构建（默认置首 + 已配置 ✓ 后缀）。
 */
import { describe, expect, it } from 'vitest'
import { buildProviderItems, deriveKeyRef, resolveKeyRef, type WizardProviderEntry } from '../src/ui/key-wizard.js'

describe('deriveKeyRef', () => {
  // 与 packages/client/ui-models tests/components.spec.tsx 的钉死用例同形：
  // 两侧规则漂移会在各自套件同时红。
  it('大写并把非字母数字连串折叠为单个下划线', () => {
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
    expect(deriveKeyRef('openrouter')).toBe('OPENROUTER_API_KEY')
    expect(deriveKeyRef('a--b..c')).toBe('A_B_C_API_KEY')
  })
})

describe('resolveKeyRef', () => {
  it('profile 显式声明的 apiKeyEnv 优先于派生', () => {
    expect(resolveKeyRef('openrouter', 'OPENROUTER_API_KEY')).toBe('OPENROUTER_API_KEY')
    expect(resolveKeyRef('acme-gateway', 'ACME_CUSTOM_REF')).toBe('ACME_CUSTOM_REF')
  })

  it('未声明或空串时落派生规则', () => {
    expect(resolveKeyRef('openrouter', undefined)).toBe('OPENROUTER_API_KEY')
    expect(resolveKeyRef('minimax-cn', '')).toBe('MINIMAX_CN_API_KEY')
  })
})

describe('buildProviderItems', () => {
  const directory: WizardProviderEntry[] = [
    { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
    { provider: 'openrouter', displayName: 'openrouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter'] },
    { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'] },
  ]

  it('默认供应商置首带 current，已配置条目带 ✓ 后缀，其余保持目录序', () => {
    const items = buildProviderItems(directory, new Map([['anthropic', true], ['openrouter', false]]), 'openrouter')
    expect(items).toEqual([
      { label: 'openrouter', value: 'openrouter', current: true },
      { label: 'DeepSeek', value: 'deepseek-official' },
      { label: 'anthropic ✓', value: 'anthropic' },
    ])
  })

  it('无默认供应商时不置首；目录为空返回空数组', () => {
    expect(buildProviderItems(directory, new Map(), undefined)[0])
      .toEqual({ label: 'DeepSeek', value: 'deepseek-official' })
    expect(buildProviderItems([], new Map(), 'openrouter')).toEqual([])
  })

  it('默认供应商不在目录中时不追加（目录是唯一事实源）', () => {
    const items = buildProviderItems(directory, new Map(), 'gone-provider')
    expect(items.map(item => item.value)).toEqual(['deepseek-official', 'openrouter', 'anthropic'])
    expect(items.every(item => item.current !== true)).toBe(true)
  })
})
