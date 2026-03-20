# DISPATCH-009 Review

Verdict: PASS

## Acceptance Criteria

- AC1: Met. `src-tauri/src/services/project_registry.rs:19-66` canonicalizes and stores the project root before insert, rejects blank names, and deduplicates on the canonical `root_path`. `src-tauri/tests/projects_db_tests.rs:16-117` verifies canonical storage, duplicate rejection, and reload-after-reopen behavior.
- AC2: Met. `src-tauri/src/services/path_guard.rs:32-196` rejects `..` traversal, absolute inputs, live symlink escapes, broken symlink escapes, and registered-root symlink pivots before returning a resolved path. `src-tauri/tests/path_guard_tests.rs:13-194` covers each case on this host.
- AC3: Met. `src-tauri/src/commands/projects.rs:11-109` exposes only project-scoped command payloads (`rootRelativePath = "."`) and sanitizes command errors so absolute host paths do not cross the IPC boundary. `src-tauri/tests/projects_commands_smoke.rs:42-145` verifies the actual Tauri command surface for create/list/get/delete and confirms that `rootPath` is not exposed over IPC.

## Fixes Applied

- Fixed the 7 Rust/Tauri compile blockers: added `tauri::Manager` in `src-tauri/src/lib.rs`, made `health` generic over `Runtime` in `src-tauri/src/commands/health.rs`, fixed the panic-hook thread lifetime in `src-tauri/src/error.rs`, annotated ambiguous DB test closures in `src-tauri/tests/db_schema_smoke.rs`, and added a valid RGBA `src-tauri/icons/icon.png` so `tauri::generate_context!()` can compile.
- Hardened `src-tauri/src/services/path_guard.rs` so a previously registered root cannot be swapped to a symlink and silently pivot outside the project boundary.
- Changed `src-tauri/src/commands/projects.rs` to return a project-scoped root marker instead of an absolute root path, and sanitized project command errors so duplicate/invalid-root failures no longer leak absolute filesystem paths.
- Added `src-tauri/tests/projects_commands_smoke.rs` to verify the Tauri IPC contract directly, and expanded `src-tauri/tests/projects_db_tests.rs` / `src-tauri/tests/path_guard_tests.rs` to cover DB reopen persistence and registered-root symlink pivots.

## Checks

- `export PATH="$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml 2>&1`: PASS
- `npm run build`: PASS

## Notes

- `ROADMAP-v2.md` and `docs/adr/0001-runtime-boundaries.md` are now aligned with the implementation: Rust remains the owner of stored roots and filesystem validation, and the frontend command boundary stays on `project_id` plus project-scoped paths.
- The symlink-escape regressions are still `#[cfg_attr(windows, ignore = "requires symlink privileges")]` on Windows. That is a coverage limitation, not a failing host result here.
