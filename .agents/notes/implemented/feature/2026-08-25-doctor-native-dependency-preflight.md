# Agent Note: /doctor native-dependency preflight

Status: implemented

English | [中文](2026-08-25-doctor-native-dependency-preflight.zh.md)

Scope: `packages/tui/tui/src/format/doctor-report.ts`, `packages/tui/tui/src/commands/registry.ts` (`/doctor`)

## Problem

An install whose lifecycle scripts were blocked (npm 11+ defaults) loses the native builds — `koffi` (process-table FFI) and `node-pty` (PTY backend) — and the user sees the failure only when the bash executor fails, with no pointer to the fix. The root README documents the exact remediation (`npm i -g --allow-scripts=koffi,node-pty,…`), but nothing surfaces it at the point of diagnosis.

## Design

`collectNativeDependencyChecks(probe?)` joins the `/doctor` report: two rows (koffi / node-pty), `warn` + `fixId 3` when the probe cannot load a module. The default probe resolves each module through `createRequire` from `@huiliyi37/dsh-subprocess-local` (the owning dependency tree under pnpm) and falls back to the bare specifier (the top-level layout of an npm -g install); the require cache keeps repeat probes free. The probe is injectable, keeping doctor-report's pure-function surface; `DOCTOR_FIXES[3]` carries the README's exact `--allow-scripts` reinstall command. The value line names what breaks (`bash 终端执行器` / `Windows 进程表/信号`), so the row reads as a diagnosis, not just a boolean.

## Boundary

The check reports loadability, not health of the build (a broken binary that still loads is out of scope), and the TUI composition itself does not need these modules to boot — this preflight tells the user whether the environment is ready for compositions that do.

## Proof

`doctor-report.spec.ts` pins both-present, each-missing (fixId + guidance text includes the command), and the default probe's ok path on this repo's dev install; the `/doctor` command spec pins that both native rows appear in the echoed report.
