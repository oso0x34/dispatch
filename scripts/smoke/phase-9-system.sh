#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-9 system smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust unit suites" cargo test --manifest-path src-tauri/Cargo.toml --lib
run_step "Rust tray and lifecycle suites" cargo test --manifest-path src-tauri/Cargo.toml --test system_tray_smoke --test review_router_tests --test task_transition_tests --test terminal_commands_smoke
run_step "Rust build" cargo build --manifest-path src-tauri/Cargo.toml
run_step "Frontend build" npm run build

echo "phase-9 system smoke passed"
