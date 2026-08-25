/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains (apiproxy api → client) can
 * consume them without loading this package's Context augmentation.
 * @module @huiliyi37/dsh-user-approval/types
 */

import type { Branded } from '@huiliyi37/dsh-brand'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, a standing grant (a persistent
 * rule or session-level always-approve matched — the current call is allowed
 * and future matching requests will not re-ask), explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 * Both grants authorize the current call identically; the split is provenance
 * for the audit trail (`approval/decided`), not a wider per-call permission.
 */
export type ApprovalOutcome =
  | 'allowed-once'
  | 'allowed-always'
  | 'rejected'
  | 'cancelled'
  | 'unavailable'
