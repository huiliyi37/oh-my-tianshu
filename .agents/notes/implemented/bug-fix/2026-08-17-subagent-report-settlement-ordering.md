# Agent Note: Subagent reports enter the parent's next step

Status: implemented

English | [中文](2026-08-17-subagent-report-settlement-ordering.zh.md)

## Problem

A subagent report used `Agent.followup()`, which appends to the parent's next-turn queue. A turn's first step claims the complete next-step batch before it claims one next-turn entry, so any later next-step input could overtake an earlier report. Each report also owned an entire parent turn: the parent could not act on two reports together, and a report submitted while the parent was running waited for a separate later turn.

The report tool exists so a child can surface a finding that changes the parent's next action. Deferring that finding to a later turn contradicts its scheduling meaning.

## Decision

`SubagentReportDelivery` is `'quiet' | 'next-step'` with default `next-step`. Next-step delivery calls `parent.steer()`: a running parent reads the report at its nearest safe step boundary, and an idle parent starts a turn for it. Quiet delivery keeps calling `parent.inject()`, which enters the same queue without waking the parent. The continuation manager retains its waking-send admission accounting for next-step reports to retained continuable parents.

### Ordering across parent states

A running parent receives reports in the same next-step FIFO that carries every other next-step input. Reports waiting together enter the same claimed batch. The existing `Agent.send()` redirect still applies: a waking input submitted after cancellation moves to the next-turn queue, so a report whose parent turn was cancelled arrives as a later turn instead of interrupting mid-step.

### Verification

The report package holds a parent inside an active model request, submits a report, settles the child, and pins that the report stays in the parent's next-step batch with no queued turn. Separate tests pin FIFO batching for repeated reports, idle wakeup, and admission accounting for retained parents. The subagent runtime covers an idle parent woken by a next-step report.

The assembled ACP scenario uses the shipped default. Its scheduling fence holds the child until the parent's delegation turn ends; the report then wakes the parked parent into one deterministic turn, and a later prompt still reads the report from the durable log.

## Alternatives considered

**Keep the `wakeup` name while changing the implementation to `steer()`.** The old name described the turn wakeup the delivery caused, not the queue the report entered. A configuration value that cannot say which behavior it selects fails the deployment that needs the quiet form; pre-release naming names the queue.

**Expose `quiet | next-step | next-turn`.** A next-turn report still loses to every next-step input, so the option needs a cross-queue ordering barrier before it means anything. No deployment asked for deferred reports.

**Keep quiet delivery as the default.** A parked parent has no other reason to inspect its inbox, so an accepted report would sit unread until an unrelated wakeup. The validation default must not require configuration to deliver.

## Consequences

The implementation pins these behaviors:

- A report can extend an already open parent turn, but it never interrupts an active model request: admission happens at step boundaries only.
- Reports accepted together share one next-step batch and read in FIFO order, reducing the amplification from one parent turn per report.
- The `wakeup` configuration value is rejected rather than kept as an alias; the repository makes no external compatibility promise for pre-release Cordis configuration.
- `quiet` remains the fallback for deployments that must not wake a parked parent, with the accepted risk that the report stays unread until another waking input arrives.
