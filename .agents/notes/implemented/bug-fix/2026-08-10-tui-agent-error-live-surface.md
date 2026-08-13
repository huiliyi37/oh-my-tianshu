# Agent Note: Surface agent errors in the TUI live region

Status: implemented

English | [中文](2026-08-10-tui-agent-error-live-surface.zh.md)

## Problem

A failing turn produced no visible output in the TUI. The agent loop reports LLM failures (an invalid API key, network errors) through `agent/error` and closes the turn with an error `turn/end` reason; `trackAgent` already folded the event into `live.state.lastError`, but no render path consumed it, and the transcript fold intentionally ignores non-message events. The user saw the submitted message, a brief status change, and then the idle prompt — a silently dead conversation.

## Decision

`renderLive` draws the last surfaced agent error as a `✗ <message>` row (ASCII `x` under degraded glyphs) in the theme's error color, truncated to the terminal width at the first newline. The projection clears `lastError` when the agent next enters `running`, so a retry that starts cleanly does not leave a stale failure on screen, while an error persists across the idle status that follows its failed turn.

## Alternatives considered

**Commit errors to the scrollback as transcript rows.** Rejected: `turn/end` error reasons are not message rows, and manufacturing a new transcript row kind widens the projection vocabulary for a status-class fact; the live region is where ephemeral status already lives (the `✗ 已停止` agent-gone row is the adjacent precedent).

**Never clear the error until session switch.** Rejected: the failure would outstay a successful retry, and clearing on idle instead would hide the error immediately, since a failed turn ends running → error → idle.

## Consequences

Misconfiguration now fails loud in the TUI — the invalid-key case shows `✗ AUTH: Authentication Fails…` at the next frame instead of dying silently. The workflow status line still displays the last phase after an errored turn, because a non-`completed` `turn/end` leaves the phase view unchanged; that is a separate cosmetic gap deliberately not folded into this fix.
