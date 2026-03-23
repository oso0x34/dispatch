#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-2 terminal core smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust terminal suites" cargo test --manifest-path src-tauri/Cargo.toml --test pty_manager_tests --test terminal_commands_smoke --test terminal_ws_attach_tests
run_step "Vitest terminal suites" npx vitest run src/app/__tests__/TabHost.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx
run_step "Frontend build" npm run build

echo "phase-2 terminal core smoke passed"
