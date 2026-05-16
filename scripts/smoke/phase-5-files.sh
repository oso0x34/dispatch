#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-5 files smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust files suites" cargo test --manifest-path src-tauri/Cargo.toml --test project_fs_tests --test file_watch_tests
run_step "Vitest files suites" npx vitest run src/features/files/__tests__/FilePreview.test.tsx src/features/files/__tests__/FilesTab.test.tsx
run_step "Frontend build" npm run build

echo "phase-5 files smoke passed"
