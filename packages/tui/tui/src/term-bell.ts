/**
 * term-bell — 完成事件的终端 BEL 通道（纯展示侧，失败静默）。
 *
 * BEL（\x07）写入 pty 后由本地终端模拟器响铃/闪屏，是 SSH 会话下唯一
 * 可达的完成提醒——因此不抑制 SSH_*（与 OS 通知的关键差异；OS 通知
 * 通道本包未移植，见回流上游 dsh-tui 704a833 的语义适配）。
 *
 * @module @huiliyi37/dsh-tui/term-bell
 */

/** 总开关环境变量名（上游与 os-notify 共用；本包无 os-notify，就地声明）。 */
export const SKIP_NOTIFY_ENV = 'DSH_TUI_SKIP_NOTIFY'

/** 终端响铃字符（BEL）。 */
export const BELL = '\x07'

/** 最小可写流（TuiApp 注入的 stdout / 测试替身均可）。 */
export interface BellStream {
  write: (s: string) => unknown
}

/** Bell 用户偏好门（与响铃开关共享形状，便于宿主/测试注入）。 */
export interface BellPrefs {
  /** 响铃开关（prefs bellEnabled；`false` 时静默，缺省视为开）。 */
  bellEnabled?: boolean
}

function flag(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === '1' || env[key] === 'true'
}

/**
 * 是否允许响铃。
 * 关闭条件：用户偏好关、DSH_TUI_SKIP_NOTIFY、VITEST、CI。
 * SSH 不在此列——BEL 穿透 pty 到本地终端，远程会话反而最需要它。
 * @param env - 待检查的进程环境。
 * @param prefs - 可选用户偏好（bellEnabled）。
 * @returns 是否允许响铃。
 */
export function shouldBell(env: NodeJS.ProcessEnv, prefs?: BellPrefs): boolean {
  if (prefs?.bellEnabled === false) return false
  if (flag(env, SKIP_NOTIFY_ENV)) return false
  if (flag(env, 'VITEST')) return false
  if (flag(env, 'CI')) return false
  return true
}

/**
 * 门闸放行时向流写 BEL。写失败静默吞掉，永不抛。
 * @param out - 目标最小可写流。
 * @param env - 进程环境。
 * @param prefs - 可选用户偏好。
 * @returns 是否实际写出。
 */
export function writeBell(out: BellStream, env: NodeJS.ProcessEnv, prefs?: BellPrefs): boolean {
  if (!shouldBell(env, prefs)) return false
  try {
    out.write(BELL)
    return true
  } catch {
    // stdout 已关闭等写失败：响铃是装饰性提醒，静默丢弃
    return false
  }
}
