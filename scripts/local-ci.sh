#!/usr/bin/env bash
# 本地 CI 闭环（scripts/local-ci.sh）——托管 runner 因账号账单锁定不可用时的
# 严谨提交门。依次跑：仓级 typecheck → 全量单测 → 构建 → hygiene 全门 → lint。
# 与 .github/workflows/verify.yml 同一门禁语义（托管解锁后两边等价）。
# 用法：pnpm run ci:local（推送前跑一次;全绿才推）。
set -euo pipefail

cd "$(dirname "$0")/.."

FAILED=0
STAGE_START=0

banner() {
  STAGE_START=$(date +%s)
  printf '\n\033[1m▶ %s\033[0m\n' "$1"
}

report() {
  local elapsed=$(( $(date +%s) - STAGE_START ))
  printf '\033[90m   %s (%ds)\033[0m\n' "$1" "$elapsed"
}

run_stage() {
  local name="$1"; shift
  banner "$name"
  if "$@"; then
    report "✓ $name"
  else
    local code=$?
    report "✗ $name"
    echo "local-ci: stage failed: $name (exit $code)" >&2
    exit "$code"
  fi
}

run_stage 'typecheck（仓级,含 tests)' pnpm run typecheck
run_stage 'unit tests（全量）' pnpm vitest run
run_stage 'build（lib + web)' pnpm run build
run_stage 'hygiene（knip/publint/constraints/invariants/cordis-config/node-next/runtime-closure/vendored-links)' pnpm run hygiene
run_stage 'lint（oxlint 全量)' pnpm run lint

printf '\n\033[1m✓ local-ci: 全门通过,可以推送\033[0m\n'
