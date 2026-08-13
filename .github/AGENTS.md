# AGENTS.md — GitHub Actions

Run jobs on Windows runners (`windows-*` labels) under native `pwsh`. The pull-request `windows` job is not one of them: it runs Windows Node under Wine on hosted Linux, so its steps are bash — see the [Wine lane Agent Note](../.agents/notes/implemented/process/2026-07-27-wine-windows-gates-experiment.md).
