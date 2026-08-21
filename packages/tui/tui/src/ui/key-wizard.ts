/**
 * key-wizard — /key 供应商选择步骤的纯函数层：目录 → 带状态的 picker 条目、
 * 供应商 → 凭据引用的解析次序。I/O（describe/settings/凭据）全部在装配方
 * （app.ts 的 openKeyDialog 流程）里；本模块只做可单测的形状决定。
 *
 * @module @huiliyi37/dsh-tui/key-wizard
 */

import type { PickerItem } from '../picker.js'

/** 可配置供应商目录条目（llm seam 的最小形状；装配方经 reflect.get 现取）。 */
export interface WizardProviderEntry {
  /** 供应商路由 id。 */
  provider: string
  /** 配置界面显示名。 */
  displayName: string
  /** 该 profile 所属的 settings 命名空间（决定引用解析与落盘激活的写入面）。 */
  settingsNs: string
  /** 命名空间段根到 profile 对象的路径（空 = 整段即 profile）。 */
  settingsPath: readonly string[]
}

/**
 * 从供应商路由派生缺省凭据引用：大写、非 `[A-Z0-9]` 连串折叠为单个 `_`、
 * 后缀 `_API_KEY`。与 web 模型页（packages/client/ui-models store.ts 的
 * deriveKeyRef）同一规则的双侧实现——规则由两侧测试钉死，改动必须同步
 * （TUI 不引入 client 包依赖，presentation 层各自持有最小面）。
 * @param provider - 供应商路由 id。
 * @returns POSIX 变量名形状的凭据引用。
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * 供应商 → 本次落盘引用的解析次序：profile 显式声明的 `apiKeyEnv` 优先
 * （组合层下发的 openrouter profile 就带着 OPENROUTER_API_KEY），未声明再
 * 派生。profile 由装配方从 settings.describe 读出传入——纯函数不做 I/O。
 * @param provider - 供应商路由 id。
 * @param profileApiKeyEnv - 已解析 profile 的 apiKeyEnv（无 profile 或未声明为 undefined）。
 * @returns 凭据引用。
 */
export function resolveKeyRef(provider: string, profileApiKeyEnv: string | undefined): string {
  return profileApiKeyEnv !== undefined && profileApiKeyEnv.length > 0
    ? profileApiKeyEnv
    : deriveKeyRef(provider)
}

/**
 * 构建 /key 供应商 picker 条目：默认供应商置首带 ●（current），已配置 key
 * 的条目 label 后缀 ` ✓`（PickerItem 无描述行，状态内联进 label）；其余按
 * 目录声明序。空目录返回空数组（装配方负责降级文案）。
 * @param directory - 可配置供应商目录。
 * @param configured - 各供应商引用的 describe 结果（configured 标志）。
 * @param defaultProvider - 当前默认模型所在的供应商路由；undefined = 无默认不置首。
 * @returns picker 条目（value = 供应商路由 id）。
 */
export function buildProviderItems(
  directory: readonly WizardProviderEntry[],
  configured: ReadonlyMap<string, boolean>,
  defaultProvider: string | undefined,
): PickerItem[] {
  const items: PickerItem[] = []
  const defaultEntry = defaultProvider === undefined
    ? undefined
    : directory.find(entry => entry.provider === defaultProvider)
  const emit = (entry: WizardProviderEntry, current: boolean): void => {
    const suffix = configured.get(entry.provider) === true ? ' ✓' : ''
    items.push({
      label: `${entry.displayName}${suffix}`,
      value: entry.provider,
      ...current ? { current: true } : {},
    })
  }
  if (defaultEntry !== undefined) emit(defaultEntry, true)
  for (const entry of directory) {
    if (entry === defaultEntry) continue
    emit(entry, false)
  }
  return items
}
