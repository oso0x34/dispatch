#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-1 projects smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Vitest component suite" npx vitest run
run_step "Frontend build" npm run build

echo "phase-1 projects smoke passed"
