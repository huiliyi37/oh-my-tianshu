/**
 * config-panel.spec.ts — /config 设置面板纯函数（T3.2）。
 *
 * 覆盖：标题与三段（设置/权限预设/凭据）顺序、设置行（ns + 值 + secrets
 * 脱敏标记）、值渲染（string/number/boolean/object/空值）、secrets 脱敏
 * 标记三态（无槽 / 空槽 / 已脱敏计数）、权限预设选择器（names 动态取、
 * 仅 custom 保留字补行）、凭据徽章（configured/source/writable，writable
 * 整行 DIM 置灰）、空输入占位、窄宽截断与极端窄宽不抛错。数据面形状以
 * packages/settings/settings、packages/interaction/permission、
 * packages/credentials/credentials 实测为准。
 */
import { describe, expect, it } from 'vitest'
import { projectConfigPanel, type ConfigPanelProjection } from '../src/config-panel.js'
import { displayWidth } from '../src/width.js'

/** DIM 置灰转义序列（与 workflow-panel 同款）。 */
const DIM = '\x1B[2m'
const RESET = '\x1B[0m'

/** 全空投影：无设置、无权限服务（permission null）、无凭据。 */
const emptyProjection: ConfigPanelProjection = {
  settings: [],
  permission: null,
  credentials: [],
}

/** 完整投影：设置（string/number/boolean/object/secret 槽）+ 权限 + 凭据。 */
const fullProjection: ConfigPanelProjection = {
  settings: [
    { ns: 'model', value: 'gpt-4o' },
    { ns: 'max-turns', value: 8 },
    { ns: 'strict', value: true },
    { ns: 'theme', value: { accent: 'blue' } },
    {
      ns: 'api-key',
      value: undefined,
      secrets: [{ path: ['apiKey'], set: true }],
    },
    {
      ns: 'token',
      value: undefined,
      secrets: [{ path: ['token'], set: false }],
    },
    {
      ns: 'provider',
      value: { url: 'https://api.example.com', key: 'sk-abc' },
      secrets: [
        { path: ['key'], set: true },
        { path: ['backup'], set: true },
      ],
    },
  ],
  permission: {
    options: [
      { value: 'preset-a', name: '预设 A' },
      { value: 'preset-b', name: '预设 B' },
    ],
    currentValue: 'preset-a',
  },
  credentials: [
    { ref: 'DEEPSEEK_API_KEY', configured: true, source: 'env', writable: true },
    { ref: 'GH_TOKEN', configured: false, writable: false },
    { ref: 'KEY2', configured: true, writable: true },
  ],
}

describe('projectConfigPanel 标题与段顺序', () => {
  it('首行为标题行', () => {
    const rows = projectConfigPanel(emptyProjection, { width: 80 })
    expect(rows[0]).toBe('⚙ 配置')
  })

  it('完整投影按 设置/权限预设/凭据 顺序渲染三段', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    const settingsIdx = rows.indexOf('◆ 设置')
    const permissionIdx = rows.indexOf('◆ 权限预设')
    const credentialsIdx = rows.indexOf('◆ 凭据')
    expect(settingsIdx).toBeGreaterThan(0)
    expect(permissionIdx).toBeGreaterThan(settingsIdx)
    expect(credentialsIdx).toBeGreaterThan(permissionIdx)
  })
})

describe('projectConfigPanel 空态', () => {
  it('设置为空渲染占位（无设置项）', () => {
    const rows = projectConfigPanel(emptyProjection, { width: 80 })
    expect(rows).toContain('  （无设置项）')
  })

  it('凭据为空渲染占位（无凭据）', () => {
    const rows = projectConfigPanel(emptyProjection, { width: 80 })
    expect(rows).toContain('  （无凭据）')
  })

  it('permission 为 null 时不渲染权限预设段', () => {
    const rows = projectConfigPanel(emptyProjection, { width: 80 })
    expect(rows.some(r => r.includes('权限预设'))).toBe(false)
  })
})

describe('设置段 值渲染', () => {
  it('string 值原样渲染', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  model · gpt-4o')
  })

  it('number 值渲染为十进制', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  max-turns · 8')
  })

  it('boolean 值渲染为 true/false', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  strict · true')
  })

  it('object 值紧凑 JSON 渲染', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  theme · {"accent":"blue"}')
  })

  it('null/undefined 值渲染占位 —', () => {
    const rows = projectConfigPanel(
      {
        settings: [{ ns: 'legacy', value: null }, { ns: 'unset', value: undefined }],
        permission: null,
        credentials: [],
      },
      { width: 80 },
    )
    expect(rows).toContain('  legacy · —')
    expect(rows).toContain('  unset · —')
  })

  it('非 JSON 值（函数）不抛错且回退 String 渲染', () => {
    const rows = projectConfigPanel(
      { settings: [{ ns: 'fn', value: () => undefined }], permission: null, credentials: [] },
      { width: 80 },
    )
    expect(rows.some(r => r.startsWith('  fn · '))).toBe(true)
  })

  it('symbol 顶层值回退类型名', () => {
    const rows = projectConfigPanel(
      { settings: [{ ns: 'sym', value: Symbol('x') }], permission: null, credentials: [] },
      { width: 80 },
    )
    expect(rows).toContain('  sym · symbol')
  })

  it('bigint 顶层值回退类型名', () => {
    const rows = projectConfigPanel(
      { settings: [{ ns: 'big', value: 9007199254740993n }], permission: null, credentials: [] },
      { width: 80 },
    )
    expect(rows).toContain('  big · bigint')
  })
})

describe('设置段 secrets 脱敏标记', () => {
  it('无 secrets 字段不渲染标记', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  model · gpt-4o')
    expect(rows.some(r => r.startsWith('  model') && r.includes('🔒'))).toBe(false)
  })

  it('secrets 空数组不渲染标记', () => {
    const rows = projectConfigPanel(
      { settings: [{ ns: 'plain', value: 'x', secrets: [] }], permission: null, credentials: [] },
      { width: 80 },
    )
    expect(rows).toContain('  plain · x')
    expect(rows.some(r => r.startsWith('  plain') && r.includes('🔒'))).toBe(false)
  })

  it('有已脱敏密钥渲染计数标记', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows.some(r => r.includes('api-key') && r.includes('🔒 1 密钥已脱敏'))).toBe(true)
    expect(rows.some(r => r.includes('provider') && r.includes('🔒 2 密钥已脱敏'))).toBe(true)
  })

  it('secret 槽存在但未设置渲染空槽标记', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows.some(r => r.includes('token') && r.includes('🔒 密钥槽'))).toBe(true)
  })
})

describe('权限预设选择器（names 动态）', () => {
  it('动态渲染 options 的 name，当前值打勾 ✓、非当前 ○', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  ✓ 预设 A')
    expect(rows).toContain('  ○ 预设 B')
  })

  it('仅 currentValue 匹配的选项打勾', () => {
    const rows = projectConfigPanel(
      {
        settings: [],
        permission: {
          options: [
            { value: 'preset-a', name: 'A' },
            { value: 'preset-b', name: 'B' },
          ],
          currentValue: 'preset-b',
        },
        credentials: [],
      },
      { width: 80 },
    )
    expect(rows).toContain('  ○ A')
    expect(rows).toContain('  ✓ B')
  })

  it('currentValue 为 custom 且 options 无 custom 时补保留字行', () => {
    const rows = projectConfigPanel(
      {
        settings: [],
        permission: { options: [{ value: 'preset-a', name: 'A' }], currentValue: 'custom' },
        credentials: [],
      },
      { width: 80 },
    )
    expect(rows).toContain('  ✓ custom')
    expect(rows).toContain('  ○ A')
  })

  it('custom 已在 options 时不重复补行', () => {
    const rows = projectConfigPanel(
      {
        settings: [],
        permission: {
          options: [
            { value: 'preset-a', name: 'A' },
            { value: 'custom', name: '自定义' },
          ],
          currentValue: 'custom',
        },
        credentials: [],
      },
      { width: 80 },
    )
    expect(rows).toContain('  ✓ 自定义')
    expect(rows.some(r => r.includes('  ✓ custom'))).toBe(false)
  })
})

describe('凭据徽章（configured/source/writable）', () => {
  it('已配置 + source + 可写 → 徽章齐全且不置灰', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  DEEPSEEK_API_KEY ● 已配置 · env · 可写')
    const line = rows.find(r => r.includes('DEEPSEEK_API_KEY'))
    expect(line).not.toContain(DIM)
  })

  it('未配置 + 无 source + 只读 → ○ 徽章且整行 DIM 置灰', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    const line = rows.find(r => r.includes('GH_TOKEN'))
    expect(line).toBe(`${DIM}  GH_TOKEN ○ 未配置 · 只读${RESET}`)
  })

  it('已配置但无 source → 不渲染 source 段', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  KEY2 ● 已配置 · 可写')
  })

  it('可写徽章不置灰（无 DIM 包裹）', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    const line = rows.find(r => r.includes('KEY2'))
    expect(line).not.toContain(DIM)
  })
})

describe('窄宽截断', () => {
  it('长值在窄宽下截断补 …，且所有行不超 width', () => {
    const longValue = '这是一个非常非常长的模型标识符用于验证窄宽截断降级逻辑是否正常工作且不应溢出'
    const rows = projectConfigPanel(
      { settings: [{ ns: 'model', value: longValue }], permission: null, credentials: [] },
      { width: 20 },
    )
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(20)
    }
    expect(rows.some(r => r.includes('…'))).toBe(true)
  })

  it('窄宽下含 DIM 置灰行不超 width', () => {
    const rows = projectConfigPanel(
      {
        settings: [],
        permission: null,
        credentials: [
          { ref: 'VERY_LONG_CREDENTIAL_REFERENCE_NAME', configured: false, writable: false },
        ],
      },
      { width: 20 },
    )
    for (const row of rows) {
      expect(displayWidth(row)).toBeLessThanOrEqual(20)
    }
  })

  it('极端窄宽（width ≤ 1）不抛错', () => {
    expect(() => projectConfigPanel(fullProjection, { width: 1 })).not.toThrow()
  })

  it('宽幅下不截断', () => {
    const rows = projectConfigPanel(fullProjection, { width: 80 })
    expect(rows).toContain('  model · gpt-4o')
    expect(rows).toContain('  ✓ 预设 A')
  })
})
