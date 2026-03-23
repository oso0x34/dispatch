#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-3 direct dispatch smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
  exit "$status"
}

trap 'on_error "$?"' ERR

run_step() {
  local label="$1"
  shift

  CURRENT_STEP="$label"
  echo "==> $label"
  "$@"
}

cd "$ROOT_DIR"

run_step "Rust direct-dispatch suites" cargo test --manifest-path src-tauri/Cargo.toml --test dispatch_validation_tests --test task_transition_tests
run_step "Vitest direct-dispatch suites" npx vitest run src/features/agents/__tests__/DispatchModal.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx
run_step "Frontend build" npm run build

echo "phase-3 direct dispatch smoke passed"
