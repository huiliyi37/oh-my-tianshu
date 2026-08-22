/**
 * ids.ts — agent-router 自有的跨边界 id（品牌化原语，见 dsh-brand 政策）。
 *
 * `RouterDecisionId` 配对 `router/decision` 与其 `router/evaluation` 归账
 * 记录：id 以决策事件落盘时的预测 seq 铸造（`rtdec-<seq>`，seq 即
 * `session.events.length`——append 同步分配该值），同会话内唯一且可从
 * 日志重建。运行时是普通字符串（品牌仅在类型层）。
 *
 * @module @huiliyi37/dsh-agent-router/ids
 */

import type { Branded } from '@huiliyi37/dsh-brand'

/** 品牌化的路由决策 id（`router/decision` ↔ `router/evaluation` 配对引用）。 */
export type RouterDecisionId = Branded<'RouterDecisionId'>

/**
 * 铸造决策 id（plain cast，零运行时成本；调用方以预测 seq 组装字符串）。
 * @param id - 决策 id 原文（`rtdec-<seq>`）。
 * @returns 品牌化后的决策 id。
 */
export function RouterDecisionId(id: string): RouterDecisionId {
  return id as RouterDecisionId
}
