#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-4 tasks smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Rust tasks suites" cargo test --manifest-path src-tauri/Cargo.toml --test task_commands_tests --test task_commands_smoke --test task_export_tests --test task_transition_tests
run_step "Vitest tasks suites" npx vitest run src/features/tasks/__tests__/KanbanBoard.test.tsx src/features/tasks/__tests__/TasksTab.test.tsx src/features/tasks/__tests__/TaskDetailDrawer.test.tsx src/features/tasks/store/tasksSlice.test.ts
run_step "Frontend build" npm run build

echo "phase-4 tasks smoke passed"
