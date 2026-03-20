# Dispatch Verification Strategy

This document locks where verification lives in the repo before the app code lands.

`ROADMAP-v2.md` is the release-scope authority for verification planning and v1 scope. If `PRD.md` conflicts on voice input, Browser scope, or PR creation/review automation, follow `ROADMAP-v2.md` and treat those items as post-v1 until a newer ADR or roadmap revision changes that decision.

## Verification Lanes

| Lane | Exact repo locations | What belongs there | Placement rule |
| --- | --- | --- | --- |
| Rust unit tests | `src-tauri/src/**/*.rs` | Module-local invariants, parsers, validation helpers, state reducers, and service behavior that does not need a cross-module harness | Keep unit tests adjacent to the Rust implementation in `#[cfg(test)]` modules inside the owning file |
| Rust integration tests | `src-tauri/tests/**/*.rs` | App boot, SQLite bootstrap, PTY lifecycle, websocket attach behavior, save-point flows, OpenClaw client behavior, and other cross-service backend contracts | Add one integration file per feature slice or phase-level behavior under `src-tauri/tests/` |
| React component tests | `src/**/__tests__/**/*.test.tsx` | UI rendering, interaction flows, lazy-mount behavior, modal state, kanban moves, tab-level error handling, and typed frontend-to-backend boundary behavior | Keep tests under the feature or shared UI area they validate, using `__tests__` folders beneath `src/` |
| Shell smoke scripts | `scripts/smoke/**/*.sh` | End-to-end local sanity checks that fail loudly on boot, wiring, packaging, or phase-level regressions | Name scripts by phase with the `scripts/smoke/phase-*.sh` convention |

## Location Contract

- Rust unit tests must stay in the owning file under `src-tauri/src/`; do not create a second Rust unit-test tree.
- Rust integration tests must stay under `src-tauri/tests/`; phase-level smoke coverage in Rust belongs there even when the file name includes `smoke`.
- React component tests must stay under `src/**/__tests__/`; do not mix them into `scripts/` or `src-tauri/tests/`.
- Shell smoke scripts must stay under `scripts/smoke/` and remain phase-oriented so release gates can call them directly.

## Phase Verification Matrix

Phase `0A` is document verification only. Every later implementation phase must add at least one executable lane from the table above, and the expected file locations are locked here.

| Phase | Verification lanes | Exact planned locations |
| --- | --- | --- |
| `0A` Architecture Lock | Document review against the ADR set, `docs/checklists/v1-scope.md`, `PRD.md`, and `ROADMAP-v2.md` | `docs/adr/0001-runtime-boundaries.md`, `docs/adr/0002-terminal-lifecycle.md`, `docs/adr/0003-data-model.md`, `docs/adr/0004-history-save-points.md`, `docs/checklists/v1-scope.md`, `docs/test-strategy.md`, `PRD.md`, `ROADMAP-v2.md` |
| `0B` Scaffold + Shell | React component, Rust integration, shell smoke | `src/app/__tests__/TabHost.test.tsx`, `src-tauri/tests/app_boot_smoke.rs`, `scripts/smoke/phase-0b-shell.sh` |
| `1` Projects + Persistence Foundation | React component, Rust integration, shell smoke | `src/features/projects/__tests__/ProjectSwitcher.test.tsx`, `src-tauri/tests/projects_db_tests.rs`, `src-tauri/tests/path_guard_tests.rs`, `scripts/smoke/phase-1-projects.sh` |
| `2` Terminal Core | React component, Rust integration, shell smoke | `src/features/agents/__tests__/TerminalPanel.test.tsx`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_ws_attach_tests.rs`, `scripts/smoke/phase-2-terminal-core.sh` |
| `3` Direct Dispatch | React component, Rust integration, shell smoke | `src/features/agents/__tests__/DispatchModal.test.tsx`, `src-tauri/tests/dispatch_validation_tests.rs`, `src-tauri/tests/task_transition_tests.rs`, `scripts/smoke/phase-3-direct-dispatch.sh` |
| `4` Tasks | React component, Rust integration, shell smoke | `src/features/tasks/__tests__/KanbanBoard.test.tsx`, `src-tauri/tests/task_export_tests.rs`, `scripts/smoke/phase-4-tasks.sh` |
| `5` Files | React component, Rust integration, shell smoke | `src/features/files/__tests__/FilePreview.test.tsx`, `src-tauri/tests/project_fs_tests.rs`, `src-tauri/tests/file_watch_tests.rs`, `scripts/smoke/phase-5-files.sh` |
| `6` History v1 | React component, Rust integration, shell smoke | `src/features/history/__tests__/HistoryTab.test.tsx`, `src-tauri/tests/save_point_tests.rs`, `src-tauri/tests/history_restore_tests.rs`, `scripts/smoke/phase-6-history.sh` |
| `7` OpenClaw Thin Integration | React component, Rust integration, shell smoke | `src/features/agents/__tests__/OpenClawStatus.test.tsx`, `src-tauri/tests/openclaw_client_tests.rs`, `scripts/smoke/phase-7-openclaw.sh` |
| `8` Full Chat + Review Loop | React component, Rust integration, shell smoke | `src/features/chat/__tests__/ChatTab.test.tsx`, `src-tauri/tests/chat_stream_tests.rs`, `src-tauri/tests/review_router_tests.rs`, `scripts/smoke/phase-8-chat-review.sh` |
| `9` System Integration + Polish | React component, Rust integration, shell smoke | `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src-tauri/tests/settings_secret_tests.rs`, `scripts/smoke/phase-9-system.sh` |
| `10` Packaging + Release | Rust integration, shell smoke | `src-tauri/tests/release_smoke.rs`, `scripts/smoke/phase-10-release.sh` |
| `11` Browser Experimental (post-v1 only) | React component, shell smoke | `src/features/browser/__tests__/BrowserTab.test.tsx`, `scripts/smoke/phase-11-browser.sh` |

## Gate Rules

- A phase is not implementation-complete until its planned verification files exist in the locked locations above.
- Architecture-sensitive changes must prove the relevant Rust ownership rules in backend tests before any matching UI affordance is treated as complete.
- Smoke scripts are release gates, not substitutes for unit or component coverage where those lanes are already assigned.
- Browser verification remains isolated to Phase `11` because Browser is explicitly post-v1.
- Voice input and PR creation/review automation have no v1 verification lane because `ROADMAP-v2.md` defers them out of the release path.
