/**
 * TUI output control surface: turns user intent into driver input through the
 * {@link Agent} public interface. A handle-created agent is driven through the
 * handle the TUI itself owns; a switched-to session is driven through the bare
 * agent returned by `ctx.agents.get(id)` and is NEVER disposed here (only the
 * handle holder — the structural owner — may tear an agent down). This module
 * writes no session events directly: `followup`/`steer`/`inject` submit inbox
 * input that the agent loop logs through its own durable channels.
 *
 * @module @huiliyi37/dsh-tui/adapter/send
 */

import type { Context } from '@huiliyi37/cordis'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { Agent, AgentCancelCause, AgentHandle, CancelOptions } from '@huiliyi37/dsh-agent'
import type { SessionId } from '@huiliyi37/dsh-session'

/** Build an identified user message from plain TUI input text + optional image attachments. */
function toUserMessage(text: string, images?: string[]) {
  const content = images !== undefined && images.length > 0
    ? [{ type: 'text' as const, text }, ...images.map(dataUrl => ({ type: 'image' as const, dataUrl }))]
    : [{ type: 'text' as const, text }]
  return createUserMessage({
    content,
    source: { kind: 'user' },
  })
}

/**
 * The driver-control face of one agent. Methods mirror the bare
 * {@link Agent} interface and carry the same semantics; they accept plain
 * text and construct the identified user message at the call site.
 */
export interface AgentControls {
  /**
   * Queue an ordinary follow-up turn and wake the driver.
   * @param text - the prompt text, submitted as a user message.
   * @param images - optional image attachment data URLs, submitted as image blocks.
   */
  followup(text: string, images?: string[]): void
  /**
   * Submit steering for the nearest step.
   * @param text - the steering text, submitted as a user message.
   */
  steer(text: string): void
  /**
   * Queue model-facing context without waking the driver.
   * @param text - the injected context, submitted as a user message.
   */
  inject(text: string): void
  /**
   * Abort the active turn or between-turn task.
   * @param cause - the stable caller intent carried by the cancellation.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void
  /**
   * Resolve after the whole-agent activity reaches quiescence.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>
}

/**
 * Build controls for an agent the caller OWNS through a handle. The handle
 * itself is intentionally not exposed here — disposal stays with the holder
 * (`handle.dispose()`); this surface only drives the agent.
 * @param handle - the owned handle returned by `ctx.agents.create`/`resume`.
 * @returns the drive-only control surface over `handle.agent`.
 */
export function controlsFromHandle(handle: AgentHandle): AgentControls {
  return controlsFromAgent(handle.agent)
}

/**
 * Build controls for a bare agent the caller does NOT own. Never disposes the
 * agent: teardown of a switched-to session belongs to its structural owner.
 * @param agent - a bare agent, e.g. from `ctx.agents.get(id)`.
 * @returns the drive-only control surface over the agent.
 */
export function controlsFromAgent(agent: Agent): AgentControls {
  return {
    followup: (text: string, images?: string[]) =>{  agent.followup(toUserMessage(text, images)) },
    steer: (text: string) =>{  agent.steer(toUserMessage(text)) },
    inject: (text: string) =>{  agent.inject(toUserMessage(text)) },
    cancel: (cause: AgentCancelCause, options?: CancelOptions) => {
      if (options === undefined) agent.cancel(cause)
      else agent.cancel(cause, options)
    },
    whenIdle: () => agent.whenIdle(),
  }
}

/**
 * Resolve controls for a live agent by session id through the registry, for
 * session switching. The returned surface drives the bare agent and never
 * disposes it (non-owner semantics).
 * @param ctx - any context exposing `ctx.agents`.
 * @param id - the shared agent/session id to look up.
 * @returns controls for the live agent, or `undefined` when none is registered.
 */
export function controlsFromRegistry(ctx: Context, id: SessionId): AgentControls | undefined {
  const agent = ctx.agents.get(id)
  return agent === undefined ? undefined : controlsFromAgent(agent)
}
