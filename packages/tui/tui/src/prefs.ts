/**
 * 本地偏好持久化层 — ~/.dsh-tui/prefs.json。
 *
 * 与官方宿主插件 dsh-tianshu-tui 共享同一文件（目录约定同 ~/.dsh-tui/themes）：
 * 两边都建模 footerInfo 等同名 key，语义一致即互通。设计约束：
 * - 容错优先：损坏/缺失/未知 key 静默降级为空偏好（缺省 = 现行为），绝不阻塞启动。
 * - 合并写：写盘只覆盖本包建模的 key，文件里本包不认识的 key（对方工具或
 *   未来版本写入）原样保留——整文件覆写会静默清掉共享方设置。
 * - 原子写：tmp + rename；写失败 best-effort 静默。
 * - 测试密封门：VITEST 环境默认不落真实 home；显式传 path（测试 tmp 目录）才启用读写。
 *
 * @module @huiliyi37/dsh-tui/prefs
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 输入区信息密度档位（footerInfo）：full 全部 chrome / compact 仅身份栏 / off 全关。 */
export const FOOTER_INFO_LEVELS = ['full', 'compact', 'off'] as const
/** 输入区信息密度档位字面量联合（full/compact/off）。 */
export type FooterInfoLevel = (typeof FOOTER_INFO_LEVELS)[number]

/** 偏好形状（本包建模的 key；读取时其他 key 由合并写原样保留）。 */
export interface TuiPrefs {
  /** 输入区信息密度（缺省 full）。 */
  footerInfo?: FooterInfoLevel
  /** 完成事件终端 BEL 响铃（/bell 切换；缺省 true，见 term-bell.ts）。 */
  bellEnabled?: boolean
}

/**
 * 缺省偏好文件路径。
 * @returns `~/.dsh-tui/prefs.json`（与官方宿主插件共享的绝对路径）。
 */
export function defaultPrefsPath(): string {
  return join(homedir(), '.dsh-tui', 'prefs.json')
}

/**
 * 解析偏好文本：非法 JSON / 非对象 / 字段形状不对 → 逐项丢弃，永不抛。
 * 只产出本包建模的 key；未知 key 在 writePrefs 的合并路径里保留。
 * @param text - prefs.json 文本。
 * @returns 解析出的偏好（可能为空对象）。
 */
export function parsePrefs(text: string): TuiPrefs {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const obj = raw as Record<string, unknown>
  const prefs: TuiPrefs = {}
  if (typeof obj.footerInfo === 'string' && (FOOTER_INFO_LEVELS as readonly string[]).includes(obj.footerInfo)) {
    prefs.footerInfo = obj.footerInfo as FooterInfoLevel
  }
  if (typeof obj.bellEnabled === 'boolean') prefs.bellEnabled = obj.bellEnabled
  return prefs
}

/**
 * 读偏好；缺失/损坏 → 空偏好。
 * @param path - prefs.json 路径。
 * @returns 已解析偏好。
 */
export function readPrefs(path: string): TuiPrefs {
  try {
    return parsePrefs(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * 合并写偏好（tmp + rename 原子替换）。把 prefs 中已赋值的建模 key 覆盖进现有
 * 文件对象；prefs 中显式为 undefined 的建模 key 从文件删除；其余 key 原样保留。
 * 失败静默——偏好是优化不是正确性依赖（磁盘不可写时保持会话态）。
 * @param path - prefs.json 路径。
 * @param prefs - 要落盘的建模 key（undefined 表示清除该 key）。
 */
export function writePrefs(path: string, prefs: TuiPrefs): void {
  try {
    let base: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      // 缺失/损坏 → 从空对象起步；已知意图是覆盖本包 key，不继承垃圾文本。
    }
    if (prefs.footerInfo === undefined) delete base.footerInfo
    else base.footerInfo = prefs.footerInfo
    if (prefs.bellEnabled === undefined) delete base.bellEnabled
    else base.bellEnabled = prefs.bellEnabled
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(base, null, 2)}\n`)
    renameSync(tmp, path)
  } catch {
    // best-effort：磁盘不可写时保持会话态（不持久化但功能不受影响）
  }
}

/**
 * 测试密封门：VITEST 下默认不读写真实 home——显式 path（测试 tmp）优先，
 * 其次 env 未设 VITEST（生产），否则 null（禁用）。
 * 调用方以归一结果判定持久化是否启用。
 * @param explicitPath - 调用方注入的显式路径（可省略）。
 * @returns 启用时返回可读写路径；禁用返回 null。
 */
export function prefsEnabled(explicitPath: string | null | undefined): string | null {
  if (explicitPath !== undefined) return explicitPath
  const env = process.env
  if (env.VITEST === 'true' || env.VITEST === '1') return null
  return defaultPrefsPath()
}
