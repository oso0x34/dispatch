# Dispatch v1 Scope Checklist

Use this checklist to evaluate new tickets, PRs, and scope-change requests against the Phase 0A architecture lock.

## Scope Authority

- [ ] `ROADMAP-v2.md` plus accepted ADRs are the release-scope authority for v1; the repo copy in `ROADMAP.md` must stay aligned with that roadmap snapshot.
- [ ] `ROADMAP-v2.md` supersedes conflicting `PRD.md` items on voice input, Browser scope, and PR creation/review automation.
- [ ] Conflicting draft PRD items are treated as post-v1 until an ADR or roadmap update moves them back into scope.

## In v1

- [ ] Multi-project desktop shell
- [ ] Project CRUD and persistent data foundation
- [ ] Embedded terminals and direct CLI dispatch
- [ ] Kanban with task/session linkage and markdown export
- [ ] Files tab with safe Rust-owned browsing/search/watch
- [ ] History v1 with Dispatch ref save points and restore
- [ ] Thin OpenClaw integration
- [ ] Full text chat and orchestrated review loop
- [ ] Settings, notifications, shortcuts, packaging

## Post-v1

- [ ] Voice input / Whisper capture
- [ ] Browser preview tab
- [ ] Branch-safe "revert as new branch commit" workflow
- [ ] PR creation/review automation

## Architecture Gates

- [ ] PTY single creation is enforced: `create_terminal_session()` is the only PTY creation path and `GET /ws/terminal/:session_id` only attaches.
- [ ] Structured dispatch is enforced: direct CLI dispatch resolves typed `program`, `args[]`, `env`, and `cwd`, not shell-string templates.
- [ ] Rust is the single database owner for SQLite, migrations, and durable records.
- [ ] Rust is the single filesystem owner for project-scoped read, search, watch, and path enforcement.
- [ ] `agent_sessions` exists in the early foundation schema before terminal attach or dispatch work begins.
- [ ] `chat_messages` is part of the initial Rust-owned schema even though the Chat tab lands later.
- [ ] Secrets never land in SQLite or a frontend JSON settings store.
- [ ] Save points live only under `refs/dispatch/save-points/*`.
- [ ] Every phase is blocked from completion until its verification lanes are defined in `docs/test-strategy.md` and landed in the locked repo locations for that phase.

## Phase Verification Gates

- [ ] Phase `0A` closes architecture and scope contradictions in writing across the ADR set, `PRD.md`, `ROADMAP-v2.md`, `docs/checklists/v1-scope.md`, and `docs/test-strategy.md`.
- [ ] Phase `0B` ships `src/app/__tests__/TabHost.test.tsx`, `src-tauri/tests/app_boot_smoke.rs`, and `scripts/smoke/phase-0b-shell.sh`.
- [ ] Phase `1` ships `src/features/projects/__tests__/ProjectSwitcher.test.tsx`, `src-tauri/tests/projects_db_tests.rs`, `src-tauri/tests/path_guard_tests.rs`, and `scripts/smoke/phase-1-projects.sh`.
- [ ] Phase `2` ships `src/features/agents/__tests__/TerminalPanel.test.tsx`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_ws_attach_tests.rs`, and `scripts/smoke/phase-2-terminal-core.sh`.
- [ ] Phase `3` ships `src/features/agents/__tests__/DispatchModal.test.tsx`, `src-tauri/tests/dispatch_validation_tests.rs`, `src-tauri/tests/task_transition_tests.rs`, and `scripts/smoke/phase-3-direct-dispatch.sh`.
- [ ] Phase `4` ships `src/features/tasks/__tests__/KanbanBoard.test.tsx`, `src-tauri/tests/task_export_tests.rs`, and `scripts/smoke/phase-4-tasks.sh`.
- [ ] Phase `5` ships `src/features/files/__tests__/FilePreview.test.tsx`, `src-tauri/tests/project_fs_tests.rs`, `src-tauri/tests/file_watch_tests.rs`, and `scripts/smoke/phase-5-files.sh`.
- [ ] Phase `6` ships `src/features/history/__tests__/HistoryTab.test.tsx`, `src-tauri/tests/save_point_tests.rs`, `src-tauri/tests/history_restore_tests.rs`, and `scripts/smoke/phase-6-history.sh`.
- [ ] Phase `7` ships `src/features/agents/__tests__/OpenClawStatus.test.tsx`, `src-tauri/tests/openclaw_client_tests.rs`, and `scripts/smoke/phase-7-openclaw.sh`; `DISPATCH-034` owns the smoke script as the last Phase `7` integration ticket.
- [ ] Phase `8` ships `src/features/chat/__tests__/ChatTab.test.tsx`, `src-tauri/tests/chat_stream_tests.rs`, `src-tauri/tests/review_router_tests.rs`, and `scripts/smoke/phase-8-chat-review.sh`.
- [ ] Phase `9` ships `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src-tauri/tests/settings_secret_tests.rs`, and `scripts/smoke/phase-9-system.sh`.
- [ ] Phase `10` ships `src-tauri/tests/release_smoke.rs` and `scripts/smoke/phase-10-release.sh`.
- [ ] Phase `11` remains post-v1 and, if enabled later, ships `src/features/browser/__tests__/BrowserTab.test.tsx` and `scripts/smoke/phase-11-browser.sh`.

## Scope Notes

- [ ] `ROADMAP-v2.md` resolves the current PRD drift: voice input is post-v1, Browser is post-v1/experimental, and PR creation/review automation is outside the v1 build path.
- [ ] Browser remains a deferred surface after v1 release; any later implementation is handled as a separate post-v1 lane behind a default-off flag and a localhost-only allowlist.
- [ ] Browser preview targets remain limited to `http://localhost:*` and `http://127.0.0.1:*` until a separate post-v1 decision expands the policy.
- [ ] Voice input remains deferred; no microphone UI or partial transcription flow lands in v1.
- [ ] Branch-safe revert stays out of v1; restore in v1 works directly from Dispatch save points without creating a new branch commit.
- [ ] PR creation and review automation remain post-v1 even though chat and review routing are in v1.
