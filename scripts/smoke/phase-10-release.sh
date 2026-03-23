#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_STEP=""

on_error() {
  local status="$1"

  echo "phase-10 release smoke failed during: ${CURRENT_STEP:-unknown step}" >&2
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

run_step "Release config smoke" cargo test --locked --manifest-path src-tauri/Cargo.toml --test release_smoke
run_step "Clean prior bundle artifacts" rm -rf target/release/bundle
run_step "Bundle Linux release artifacts" npx tauri build --bundles appimage,deb --ci
run_step "Artifact-required release smoke" env DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1 cargo test --locked --manifest-path src-tauri/Cargo.toml --test release_smoke
run_step "List bundled artifacts" find target/release/bundle -maxdepth 3 -type f | sort

echo "phase-10 release smoke passed"
