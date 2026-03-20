#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-0b shell smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "React lazy tab smoke" npm test -- src/app/__tests__/TabHost.test.tsx
run_step "Rust app boot smoke" cargo test --manifest-path src-tauri/Cargo.toml --test app_boot_smoke

echo "phase-0b shell smoke passed"
