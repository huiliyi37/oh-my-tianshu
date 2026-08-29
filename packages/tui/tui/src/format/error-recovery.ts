/**
 * error-recovery — 错误终态的可行动恢复指引（回流自 opencode-tui 807686a02
 * 的 errorRecoveryGuidance，分类面适配本仓 LlmFailure 结构化事实）。
 *
 * 与重试过程文案的分工：重试中由各消费者自行提示；本函数是重试耗尽、
 * 回合以 error 终态收尾后的「下一步」——一行、可行动、按事实分流。
 *
 * @module @huiliyi37/dsh-tui/error-recovery
 */

/** 分类输入：LlmFailure 的最小投影（message/code/status）。 */
export interface RecoveryFailure {
  readonly message: string
  readonly code: string
  readonly status?: number
}

/**
 * 给一条错误终态的「下一步」指引。
 * @param failure - turn/end error 变体携带的结构化失败。
 * @returns 单行中文可行动指引（已含建议命令）。
 */
export function errorRecoveryGuidance(failure: RecoveryFailure): string {
  const status = failure.status
  const text = `${failure.code} ${failure.message}`
  if (status === 401 || status === 403 || failure.code === 'AUTH') {
    return '认证失败：/key 检查该供应商的 API Key（探测不过可换 key 或供应商）'
  }
  if (status === 402 || status === 429) {
    return '限流/额度不足：稍等片刻再发，或 /model 切轻量档；持续 429 先查账户余额'
  }
  if (status !== undefined && status >= 500) {
    return '服务商暂时性故障：稍后重发，或 /model 切换供应商'
  }
  if (failure.code === 'CONTEXT_WINDOW_EXCEEDED' || /context (window|length)|maximum context/i.test(failure.message)) {
    return '上下文超限：/compact 压缩历史，或开新会话续写'
  }
  if (status === 400 || status === 404 || failure.code === 'INVALID_REQUEST' || failure.code === 'NO_ADAPTER' || failure.code === 'INVALID_ADAPTER') {
    return '请求被拒（模型 id 或路由错）：/model 确认模型与供应商；自定义端点检查 baseUrl'
  }
  if (failure.code === 'TIMEOUT' || /timeout|etimedout|econnreset|econnrefused|fetch failed|network/i.test(text)) {
    return '网络超时/断连：检查网络与代理后重发；反复出现用 /doctor 体检'
  }
  if (failure.code === 'STREAM_CLOSED' || failure.code === 'MALFORMED_RESPONSE' || failure.code === 'EMPTY_RESPONSE') {
    return '流式响应异常：重发一次；持续出现换供应商或提 issue'
  }
  return '重发一次；持续失败用 /doctor 体检、/key 复查凭据'
}

/**
 * 错误终态回填提示行（上一条用户消息已回填输入框时的告知）。
 * @returns 提示文本。
 */
export function errorRefillNotice(): string {
  return '↩ 上一条可能未被完整处理——已回填输入框，编辑后回车重发'
}
