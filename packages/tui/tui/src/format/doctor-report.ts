/**
 * 终端诊断报告（format/doctor-report.ts）— 纯函数。
 *
 * /doctor 命令的数据聚合层：收集终端环境检测结果，输出可读报告行。
 * 所有检测函数引用既有导出（theme-detect / ansi / term-caps），不新增检测逻辑；
 * 原生依赖检测（koffi/node-pty）经注入的探针函数隔离环境副作用，保持纯函数面。
 */
import { createRequire } from 'node:module'
import { color } from '../engine/ansi.js'
import { detectHyperlinkSupport, detectImageProtocol } from '../engine/ansi.js'
import { isLegacyWindowsConsole } from '../term-caps.js'
import type { RivetTheme } from '../theme.js'

/** 单条诊断检查结果。 */
export interface DoctorCheck {
  name: string
  status: 'ok' | 'warn' | 'info'
  value: string
  fixId?: number
}

/** 可修复项的修复指引。 */
export interface DoctorFix {
  id: number
  title: string
  guidance: string
}

/**
 * 收集终端诊断报告。
 * @param cols 终端列数
 * @param rows 终端行数
 * @param background 终端背景色
 * @param env 环境变量（默认 process.env）
 * @returns 检查结果列表（可修复项带 fixId）。
 */
export function collectDoctorReport(
  cols: number,
  rows: number,
  background: string,
  env: NodeJS.ProcessEnv = process.env,
): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    { name: '终端尺寸', status: 'ok', value: `${cols}×${rows}` },
    { name: '终端背景', status: 'ok', value: background },
  ]

  // 超链接支持
  const hyperlink = detectHyperlinkSupport(env)
  checks.push({ name: '超链接', status: hyperlink ? 'ok' : 'warn', value: hyperlink ? '✓' : '不支持' })

  // 图片协议
  const imageProtocol = detectImageProtocol(env)
  checks.push({ name: '图片协议', status: imageProtocol !== 'none' ? 'ok' : 'info', value: imageProtocol })

  // 遗留终端
  const legacy = isLegacyWindowsConsole(env)
  checks.push({ name: '终端兼容', status: legacy ? 'warn' : 'ok', value: legacy ? '遗留模式（功能受限）' : '现代终端' })

  // True Color（chalk.level: 0=none,1=16,2=256,3=16m）
  const tcLevel = (globalThis as Record<string, unknown>).chalkLevel as number | undefined ?? 3
  checks.push({ name: 'True Color', status: tcLevel >= 3 ? 'ok' : 'warn', value: tcLevel >= 3 ? '✓ 16M 色' : `仅 ${tcLevel === 2 ? '256 色' : '16 色'}` })

  // tmux 剪贴板
  const inTmux = Boolean(env.TMUX)
  checks.push({
    name: '剪贴板', status: inTmux ? 'warn' : 'ok',
    value: inTmux ? 'tmux 内（需 set-clipboard on）' : '直接终端',
    ...(inTmux ? { fixId: 1 } : {}),
  })

  // kitty dcs-passthrough
  const term = (env.TERM ?? '').toLowerCase()
  const isKitty = term.includes('kitty')
  if (isKitty && imageProtocol === 'none') {
    checks.push({
      name: 'kitty 图片', status: 'warn',
      value: 'dcs-passthrough 未开启',
      fixId: 2,
    })
  }

  return checks
}

/** README 记录的原生依赖补救命令（npm 11+ 默认拦截 lifecycle scripts）。 */
export const NATIVE_DEPENDS_FIX_COMMAND =
  'npm i -g --allow-scripts=koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs @huiliyi37/oh-my-tianshu'

/** 可修复项清单（与 DoctorCheck.fixId 对应）。 */
export const DOCTOR_FIXES: DoctorFix[] = [
  {
    id: 1,
    title: 'tmux 剪贴板配置',
    guidance: "echo 'set-option -s set-clipboard on' >> ~/.tmux.conf  # 允许 tmux 使用系统剪贴板",
  },
  {
    id: 2,
    title: 'kitty dcs-passthrough',
    guidance: "echo 'term_features all' >> ~/.config/kitty/kitty.conf  # 启用 DCS 透传（图片协议需要）",
  },
  {
    id: 3,
    title: '原生依赖缺失（koffi / node-pty）',
    guidance: `npm 11+ 默认拦截未允许的 lifecycle scripts，原生依赖需要显式放行后重装：\n  ${NATIVE_DEPENDS_FIX_COMMAND}`,
  },
]

/**
 * 渲染诊断报告为终端行。
 * @param checks - collectDoctorReport 的检查结果。
 * @param theme - 当前主题（状态图标与文字分色）。
 * @returns ANSI 行数组：标题 + 逐项检查 + 可修复项汇总（如有）。
 */
export function renderDoctorReport(checks: DoctorCheck[], theme: RivetTheme): string[] {
  const lines: string[] = []
  lines.push(color('终端诊断报告:', theme.brandColor))

  for (const check of checks) {
    const icon = check.status === 'ok'
      ? color(' ✓ ', theme.primary)
      : check.status === 'warn'
        ? color(' ⚠ ', theme.secondary)
        : color(' ℹ ', theme.muted)
    const fixTag = check.fixId !== undefined ? color(` [修复 ${check.fixId}]`, theme.muted) : ''
    lines.push(`${icon}${check.name}: ${color(check.value, theme.muted)}${fixTag}`)
  }

  // 可修复项汇总
  const fixable = checks.filter(c => c.fixId !== undefined)
  if (fixable.length > 0) {
    lines.push('')
    lines.push(color('可修复项:', theme.brandColor))
    for (const check of fixable) {
      const fix = DOCTOR_FIXES.find(f => f.id === check.fixId)
      if (fix !== undefined) {
        lines.push(`  [${fix.id}] ${fix.title}`)
      }
    }
    lines.push(color('运行 /doctor fix <id> 查看修复指引', theme.muted))
  }

  return lines
}

/** 原生依赖探针结果：模块可加载 / 加载失败。 */
export type NativeProbeResult = 'ok' | 'missing'

/**
 * 探针函数：尝试从 owning 包（缺省 `@huiliyi37/dsh-subprocess-local`，回退
 * 裸 specifier——npm 全局安装的顶层布局）加载一个原生依赖模块。
 * @param specifier - 要探测的模块名（koffi / node-pty）。
 * @returns 模块可加载 'ok'；加载抛错 'missing'。
 */
export type NativeModuleProbe = (specifier: string) => NativeProbeResult

/**
 * 默认探针：经 createRequire 双路径加载——先从属主包解析（pnpm 工作区里
 * koffi/node-pty 只在它的依赖树内），失败再试裸 specifier（npm -g 顶层）。
 * 模块加载成功即有构建产物；require 缓存保证重复探测零开销。
 * @param specifier - 要探测的模块名。
 * @returns 加载结果。
 */
export function defaultNativeModuleProbe(specifier: string): NativeProbeResult {
  const fromHere = createRequire(import.meta.url)
  const bases: string[] = ['@huiliyi37/dsh-subprocess-local']
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1.length > 0) bases.push(argv1)
  bases.push('.')
  for (const base of bases) {
    try {
      createRequire(fromHere.resolve(base))(specifier)
      return 'ok'
    } catch {
      // 该路径下不可解析/不可加载——试下一条路径。
    }
  }
  return 'missing'
}

/**
 * 收集原生依赖检测（P1②）：koffi（进程枚举 FFI）与 node-pty（PTY 后端）。
 * 任一缺失 = bash 执行器在该安装上不可用；修复指引给出 README 的
 * --allow-scripts 重装命令（fixId 与 DOCTOR_FIXES 对应）。
 * @param probe - 模块探针（缺省 defaultNativeModuleProbe）。
 * @returns 检查结果列表（缺失项带 fixId）。
 */
export function collectNativeDependencyChecks(
  probe: NativeModuleProbe = defaultNativeModuleProbe,
): DoctorCheck[] {
  const koffi = probe('koffi')
  const nodePty = probe('node-pty')
  const check = (name: string, result: NativeProbeResult, what: string): DoctorCheck => ({
    name,
    status: result === 'ok' ? 'ok' : 'warn',
    value: result === 'ok' ? '✓ 可加载' : `缺失（${what}不可用）`,
    ...(result === 'ok' ? {} : { fixId: 3 }),
  })
  return [
    check('koffi（进程枚举）', koffi, 'Windows 进程表/信号'),
    check('node-pty（PTY 后端）', nodePty, 'bash 终端执行器'),
  ]
}

/**
 * 获取修复指引文本。
 * @param fixId - 修复项 id（DoctorCheck.fixId）。
 * @returns 标题 + 指引文本；未知 id 返回 null。
 */
export function getDoctorFixGuidance(fixId: number): string | null {
  const fix = DOCTOR_FIXES.find(f => f.id === fixId)
  if (fix === undefined) return null
  return `[${fix.id}] ${fix.title}\n\n${fix.guidance}`
}
