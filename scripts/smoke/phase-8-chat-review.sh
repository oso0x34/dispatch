#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-8 chat/review smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust chat and review suites" cargo test --manifest-path src-tauri/Cargo.toml --test chat_stream_tests --test review_router_tests
run_step "Vitest chat and review suites" npx vitest run src/features/chat/__tests__/ChatTab.test.tsx src/features/agents/__tests__/OrchestratedSessionView.test.tsx src/features/tasks/__tests__/TaskDetailDrawer.test.tsx
run_step "Frontend build" npm run build

echo "phase-8 chat/review smoke passed"
