/**
 * restore-session — 可恢复会话投影（纯函数）。
 *
 * 输入 adapter/sessions.ts 的 SessionSummary[] → 可恢复会话视图。
 * 不接管启动流程、不读 ctx——读取由装配层调 listSessions 后喂入。
 */
import type { SessionEvent, SessionId } from '@huiliyi37/dsh-session'
import type { SessionSummary } from './adapter/sessions.js'

/** 可恢复会话视图行（live = 当前进程内仍活跃）。 */
export interface RestorableSession {
  id: SessionId
  createdAt: number
  cwd: string | undefined
  parentSession: SessionId | undefined
  live: boolean
  /** Agent preset id（创建值 + 切换值 fold；未记录时 undefined）。 */
  agentPreset: string | undefined
  /** 展示标题（sessionTitleFor 折叠；未计算时 undefined）。 */
  title: string | undefined
  /** 持久化工件损坏（version -1 占位）：不可恢复，列表标注原因。 */
  corrupt: boolean
}

/** 投影/格式化选项。 */
export interface RestorableOptions {
  /** 当前时间戳（缺省 Date.now()）。 */
  now?: number
  /** 活跃会话 id 集合（live 标注）。 */
  liveIds?: ReadonlySet<SessionId>
  /** 展示行数上限；超出部分折叠为「… 还有 N 个会话」提示行（缺省或 ≤0 不限制）。 */
  maxRows?: number
}

/**
 * SessionSummary → 可恢复会话视图（顺序保持；liveIds 命中者标 live）。
 * @param sessions - 会话摘要列表（adapter/sessions.ts 输出）。
 * @param opts - 投影选项（取 liveIds）。
 * @returns 可恢复会话视图行。
 */
export function projectRestorableSessions(
  sessions: readonly SessionSummary[],
  opts: RestorableOptions = {},
): RestorableSession[] {
  const liveIds = opts.liveIds
  return sessions.map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    cwd: s.cwd,
    parentSession: s.parentSession,
    live: liveIds !== undefined && liveIds.has(s.id),
    agentPreset: s.agentPreset,
    title: undefined,
    corrupt: s.corrupt,
  }))
}

const DAY_MS = 86_400_000

/**
 * 相对时间：<60s 刚刚 / <1h N 分钟前 / <24h N 小时前 / <7d N 天前 / ≥7d 日期。
 * @param createdAt - 会话创建时间戳（毫秒）。
 * @param now - 当前时间戳（毫秒）。
 * @returns 相对时间文本（≥7 天为 `YYYY-MM-DD`）。
 */
export function formatSessionAge(createdAt: number, now: number): string {
  const diff = now - createdAt
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)} 天前`
  const d = new Date(createdAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 会话 id 的 8 位短引用（`#` 前缀），欢迎页行用可读短 id 替代裸 UUID。 */
function shortId(id: SessionId): string {
  return id.slice(0, 8)
}

/** cwd 的目录 basename（无尾斜杠）；空/根路径（无 basename）返回 undefined。 */
function basename(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const base = cwd.split('/').filter(Boolean).pop()
  return base === undefined || base === '' ? undefined : base
}

/**
 * 展示行：live ● / persisted ○ + 标题（已计算时）+ 相对年龄 + cwd basename +
 * 短 id + fork 短父 id；空列表占位提示。maxRows 限高时超出部分折叠为一行
 * 提示（「… 还有 N 个会话」）。
 * @param rows - 可恢复会话视图行。
 * @param opts - 格式化选项（取 now 与 maxRows）。
 * @returns 每会话一行的展示文本。
 */
export function formatRestorableSessions(
  rows: readonly RestorableSession[],
  opts: RestorableOptions = {},
): string[] {
  if (rows.length === 0) return ['（无可恢复会话）']
  const now = opts.now ?? Date.now()
  const maxRows = opts.maxRows !== undefined && opts.maxRows > 0 ? opts.maxRows : undefined
  const shown = maxRows !== undefined ? rows.slice(0, maxRows) : rows
  const out = shown.map((r) => {
    // 损坏会话：头部不可读，年龄/cwd/血缘均未知——只标注原因与短 id。
    if (r.corrupt) return `○ 不可恢复 · #${shortId(r.id)}`
    const title = r.title !== undefined && r.title !== '' ? `${r.title} · ` : ''
    const parts: string[] = [`${r.live ? '●' : '○'} ${title}${formatSessionAge(r.createdAt, now)}`]
    const base = basename(r.cwd)
    if (base !== undefined) parts.push(base)
    parts.push(`#${shortId(r.id)}`)
    if (!r.live && r.parentSession !== undefined) parts.push(`fork #${shortId(r.parentSession)}`)
    // agent preset 标注（恢复语义：preset 决定会话工具面，恢复时需知情）。
    if (r.agentPreset !== undefined && r.agentPreset !== '') parts.push(`preset:${r.agentPreset}`)
    return parts.join(' · ')
  })
  const hidden = rows.length - shown.length
  if (hidden > 0) out.push(`… 还有 ${hidden} 个会话`)
  return out
}

/**
 * 欢迎页可选择列表（c4 概念 C 3.1）：每行 `[N]` 编号 + 展示行，数字键直达。
 * 行序 = 输入序（listSessions 新→旧）；maxRows 限高折叠（缺省不限）。
 * @param rows - 可恢复会话视图行（含 title）。
 * @param opts - 格式化选项（取 now 与 maxRows）。
 * @returns 每会话一行 `[N] …`；空列表返回空数组（调用方决定是否占位）。
 */
export function formatRestorablePickerList(
  rows: readonly RestorableSession[],
  opts: RestorableOptions = {},
): string[] {
  if (rows.length === 0) return []
  const maxRows = opts.maxRows !== undefined && opts.maxRows > 0 ? opts.maxRows : undefined
  const shown = maxRows !== undefined ? rows.slice(0, maxRows) : rows
  const out = shown.map((r, i) => `[${i + 1}] ${formatRestorableSessions([r], opts)[0] ?? ''}`)
  const hidden = rows.length - shown.length
  if (hidden > 0) out.push(`… 还有 ${hidden} 个会话`)
  return out
}

/**
 * 崩溃修复信号：日志中是否存在持久化后端闭合崩溃孤立回合的 `turn/end`
 * `interrupted` 标记。该 reason 只由 repair.ts 的合成闭合事件发出（loop 永不
 * 发出，见 dsh-session types.ts TurnEndReasonMap），因此它的存在即「该会话
 * 上次运行被中断、已自动闭合」的权威事实——无需触碰持久化写路径。
 * @param events - 会话事件日志（seq 序）。
 * @returns true = 该会话曾被崩溃修复（含合成 closers）。
 */
export function wasCrashRepaired(events: readonly SessionEvent[]): boolean {
  return events.some(
    event => event.type === 'turn/end' && event.data.reason.kind === 'interrupted',
  )
}
