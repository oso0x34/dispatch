#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-6 history smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust history suites" cargo test --manifest-path src-tauri/Cargo.toml --test save_point_tests --test history_restore_tests
run_step "Vitest history suites" npx vitest run src/features/history/__tests__/HistoryTab.test.tsx src/app/__tests__/TabHost.test.tsx
run_step "Frontend build" npm run build

echo "phase-6 history smoke passed"
