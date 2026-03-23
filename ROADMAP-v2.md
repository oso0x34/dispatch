---
title: "Dispatch — Build Roadmap v2"
type: feat
status: active
date: 2026-03-19
version: v2
origin: ROADMAP-REVIEW.md + ROADMAP.md + PRD.md + research/*
---

# Dispatch — Build Roadmap v2

## Visual Design Authority

- `docs/visual-rebuild-spec.md` plus `docs/reference/visual-rebuild/*` are the authority for shell and visual design decisions.
- `ROADMAP-v2.md` remains the authority for architecture, ownership, release scope, and verification, but it does not define the final product shell.
- `old-v.png` and `old-v-2.png` are historical only and must not be used as implementation targets.

## Changes from v1

- The roadmap now starts with an explicit architecture lock. v1 jumped straight into scaffold work while key ownership questions were still unresolved; that would have caused rework in PTY, filesystem, and settings.
- PTY lifecycle is now single-owner: `create_terminal_session()` creates and persists sessions in Rust, and `GET /ws/terminal/:session_id` only attaches to an existing session. Reconnects attach; they do not spawn.
- Direct CLI dispatch no longer uses shell-string templates. Agent definitions are now structured as `program`, `args[]`, `env`, and `cwd`, with typed placeholder resolution and zero shell parsing.
- Canonical storage ownership is fixed. Rust owns SQLite via `rusqlite`, Rust owns filesystem access and watching, and Rust owns secrets via OS keychain access. The frontend only uses typed Tauri commands and keeps non-authoritative UI state locally.
- `agent_sessions` moves into the early foundation schema, not late polish. Task/session linkage and automatic task state transitions are part of the core flow, not an afterthought.
- Save points are moved out of branch history and into `refs/dispatch/*`. Pre-run save points are always created, even when the repo is clean.
- Verification is now part of every phase: Rust unit/integration tests, React component tests, and smoke tests are all assigned where the risk actually appears.
- Heavy tabs now use lazy-mount-once, not blanket mount-everything. Agents, Files, History, and Chat keep state after first open; lighter surfaces do not stay alive unnecessarily.
- Browser is removed from the v1 critical path. If implemented after release, it is limited to localhost iframe preview only.
- PRD drift is closed. Kanban markdown export and auto agent-pick are added to v1. Voice input is explicitly deferred to post-v1 because it introduces audio permission and transcription backend decisions that are not required to ship the core command center.

## Locked Decisions

### Ownership

| Domain | Owner | Implementation |
|---|---|---|
| Projects, tasks, agent sessions, chat cache, non-secret settings | Rust backend | `rusqlite = 0.39.0` + SQL migrations in `src-tauri/migrations/` |
| Secrets | Rust backend | `keyring = 3.6.3`; if keychain write is unavailable, Dispatch falls back to inherited env vars and does not persist the secret elsewhere |
| Filesystem read/search/watch | Rust backend | `notify = 8.2.0`, `ignore = 0.4.25`, `grep-searcher = 0.1.16`, `grep-regex = 0.1.14` |
| PTY lifecycle and transport | Rust backend | `portable-pty = 0.9.0` + `axum = 0.8.8` websocket attach server |
| OpenClaw connectivity | Rust backend | `tokio-tungstenite = 0.28.0` + `reqwest = 0.12.28` |
| Frontend state | React frontend | Zustand for UI state only; no direct DB or filesystem access |

### Non-Negotiable Architecture Rules

- No `tauri-plugin-sql`, no `tauri-plugin-store`, and no `tauri-plugin-fs` in v1.
- No shell-string interpolation for agent dispatch.
- No implicit git repo initialization. History v1 works only for existing git repositories.
- No branch-history pollution for save points. Use `refs/dispatch/*`.
- No arbitrary filesystem access from the frontend. Every path must resolve under a registered project root.
- No background process without cleanup ownership. PTYs, watchers, and OpenClaw sockets must be shut down or reconciled on restart.

## v1 Scope

Dispatch v1 ships:

- Multi-project desktop shell
- Project CRUD and persistent data foundation
- Embedded terminals and direct CLI dispatch
- Kanban with task/session linkage and markdown export
- Files tab with safe Rust-owned browsing/search/watch
- History v1 with Dispatch ref save points and restore
- Thin OpenClaw integration
- Full text chat and orchestrated review loop
- Settings, notifications, shortcuts, packaging

Dispatch post-v1:

- Voice input / Whisper capture
- Browser preview tab
- Branch-safe "revert as new branch commit" workflow
- PR creation/review automation

## Baseline Versions

### Frontend

| Package | Version |
|---|---|
| `@tauri-apps/cli` | `2.10.1` |
| `@tauri-apps/api` | `2.10.1` |
| `react` | `19.2.4` |
| `react-dom` | `19.2.4` |
| `typescript` | `5.9.3` |
| `vite` | `8.0.1` |
| `@vitejs/plugin-react` | `6.0.1` |
| `tailwindcss` | `4.2.2` |
| `@tailwindcss/vite` | `4.2.2` |
| `zustand` | `5.0.12` |
| `immer` | `11.1.4` |
| `react-resizable-panels` | `4.7.3` |
| `@dnd-kit/core` | `6.3.1` |
| `@dnd-kit/sortable` | `10.0.0` |
| `@tanstack/react-virtual` | `3.13.23` |
| `@xterm/xterm` | `6.0.0` |
| `@xterm/addon-fit` | `0.11.0` |
| `@xterm/addon-search` | `0.16.0` |
| `@xterm/addon-web-links` | `0.12.0` |
| `@xterm/addon-webgl` | `0.19.0` |
| `react-markdown` | `10.1.0` |
| `remark-gfm` | `4.0.1` |
| `rehype-highlight` | `7.0.2` |
| `rehype-slug` | `6.0.0` |
| `highlight.js` | `11.11.1` |
| `react-hotkeys-hook` | `5.2.4` |
| `cmdk` | `1.1.1` |
| `lucide-react` | `0.577.0` |
| `@tauri-apps/plugin-dialog` | `2.6.0` |
| `@tauri-apps/plugin-notification` | `2.3.3` |
| `@tauri-apps/plugin-opener` | `2.5.3` |
| `@tauri-apps/plugin-global-shortcut` | `2.3.1` |
| `vitest` | `4.1.0` |
| `@testing-library/react` | `16.3.2` |
| `@testing-library/user-event` | `14.6.1` |
| `@playwright/test` | `1.58.2` |

### Rust

| Crate | Version |
|---|---|
| `tauri` | `2.10.3` |
| `tokio` | `1.50.0` |
| `axum` | `0.8.8` |
| `rusqlite` | `0.39.0` |
| `portable-pty` | `0.9.0` |
| `git2` | `0.20.4` |
| `notify` | `8.2.0` |
| `ignore` | `0.4.25` |
| `grep-searcher` | `0.1.16` |
| `grep-regex` | `0.1.14` |
| `grep-matcher` | `0.1.8` |
| `tracing` | `0.1.44` |
| `tracing-subscriber` | `0.3.23` |
| `tracing-appender` | `0.2.4` |
| `tokio-tungstenite` | `0.28.0` |
| `reqwest` | `0.12.28` |
| `keyring` | `3.6.3` |
| `tauri-plugin-dialog` | `2.6.0` |
| `tauri-plugin-opener` | `2.5.3` |
| `tauri-plugin-notification` | `2.3.3` |
| `tauri-plugin-global-shortcut` | `2.3.1` |

## Canonical Repo Layout

```text
~/projects/dispatch/
├── docs/
│   ├── adr/
│   ├── checklists/
│   └── test-strategy.md
├── scripts/
│   └── smoke/
├── src/
│   ├── app/
│   ├── features/
│   │   ├── agents/
│   │   ├── chat/
│   │   ├── files/
│   │   ├── history/
│   │   ├── projects/
│   │   ├── settings/
│   │   └── tasks/
│   ├── shared/
│   └── styles/
├── src-tauri/
│   ├── capabilities/
│   ├── migrations/
│   ├── src/
│   │   ├── commands/
│   │   ├── db/
│   │   ├── models/
│   │   ├── services/
│   │   ├── app_state.rs
│   │   ├── error.rs
│   │   ├── logging.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   └── tests/
└── package.json
```

## Phase Order

| Phase | Name | Outcome | Est. Effort |
|---|---|---|---|
| `0A` | Architecture Lock | Runtime boundaries, schema, verification, and scope frozen | 0.5-1 day |
| `0B` | Scaffold + Shell | Running desktop shell with lazy tab host and test harness | 1-1.5 days |
| `1` | Projects + Persistence Foundation | Project CRUD, schema, settings, secrets, logging | 1.5-2 days |
| `2` | Terminal Core | Persistent PTY sessions with attach-only websocket transport | 2-3 days |
| `3` | Direct Dispatch | Structured agent registry and safe CLI dispatch | 1-2 days |
| `4` | Tasks | Kanban, markdown export, dispatch bindings | 1.5-2 days |
| `5` | Files | Safe Rust-owned file browser, search, and watch | 1.5-2 days |
| `6` | History v1 | Dispatch ref save points, diff, restore | 2-3 days |
| `7` | OpenClaw Thin Integration | Connection, spawn/list/kill, orchestrated sessions in Agents | 1-2 days |
| `8` | Full Chat + Review Loop | Chat tab, streaming, review automation | 2-3 days |
| `9` | System Integration + Polish | Settings, shortcuts, notifications, cleanup, perf | 1.5-2 days |
| `10` | Packaging + Release | CI, Linux builds, metrics, release artifacts | 1-1.5 days |
| `11` | Browser Experimental | Post-v1 localhost iframe preview only | post-v1 |

## Phase 0A — Architecture Lock

**Goal:** Freeze the build contract before code: ownership, schema, session model, cleanup rules, and verification strategy.

**Files**

- `docs/adr/0001-runtime-boundaries.md`
- `docs/adr/0002-terminal-lifecycle.md`
- `docs/adr/0003-data-model.md`
- `docs/adr/0004-history-save-points.md`
- `docs/checklists/v1-scope.md`
- `docs/test-strategy.md`

**Dependencies in play**

- `tauri 2.10.3`
- `react 19.2.4`
- `rusqlite 0.39.0`
- `portable-pty 0.9.0`
- `git2 0.20.4`
- `notify 8.2.0`

**Commands**

```bash
mkdir -p ~/projects/dispatch/docs/adr ~/projects/dispatch/docs/checklists ~/projects/dispatch/scripts/smoke
cd ~/projects/dispatch && node -v && rustc -V && cargo -V
```

**Implementation**

- Write the ownership ADR that states Rust owns SQLite, secrets, filesystem, PTYs, and OpenClaw connectivity.
- Write the terminal lifecycle ADR that states:
  - `create_terminal_session()` is the only PTY creation entry point.
  - `dispatch_agent()` internally calls that same creation path.
  - `GET /ws/terminal/:session_id` only attaches to an existing session.
  - websocket disconnect does not kill the PTY.
- Write the data model ADR with the initial schema:
  - `projects`
  - `tasks`
  - `agent_sessions`
  - `settings`
- Lock task state semantics:
  - `workflow_state`: `draft | planning | in_progress | review | done`
  - `last_run_state`: `idle | running | succeeded | failed | canceled | abandoned`
- Lock secret precedence:
  - app keychain secret if set
  - inherited environment variable if keychain value is absent
  - missing/blank if neither exists
- Lock v1 deferrals:
  - no voice input
  - no Browser tab in release scope
  - no branch-history revert workflow
- Write the test strategy doc with the exact lanes:
  - Rust unit tests in `src-tauri/src/**`
  - Rust integration/smoke tests in `src-tauri/tests/**`
  - React component tests in `src/**/__tests__/**`
  - shell smoke scripts in `scripts/smoke/**`

**Verification**

- Review the ADR set against `PRD.md` and `ROADMAP-REVIEW.md` and confirm every contradiction is resolved in writing.
- Add a checklist section to `docs/checklists/v1-scope.md` for:
  - PTY single creation point
  - structured dispatch model
  - one DB owner
  - one filesystem owner
  - `agent_sessions` in early schema
  - verification in every phase

**Done when**

- The four ADRs exist and are internally consistent.
- The task state model, session lifecycle, and save-point namespace are frozen.
- v1 vs post-v1 scope is explicit enough that implementation can start without re-deciding fundamentals.

## Phase 0B — Scaffold + Shell

**Goal:** Create the Tauri app, test harness, dark shell, and lazy tab host.

**Files**

- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `src/main.tsx`
- `src/app/App.tsx`
- `src/app/TabHost.tsx`
- `src/app/providers.tsx`
- `src/shared/components/TopBar.tsx`
- `src/shared/components/TabBar.tsx`
- `src/shared/components/ErrorBoundary.tsx`
- `src/features/projects/ProjectsPlaceholder.tsx`
- `src/features/agents/AgentsPlaceholder.tsx`
- `src/features/tasks/TasksPlaceholder.tsx`
- `src/features/files/FilesPlaceholder.tsx`
- `src/features/history/HistoryPlaceholder.tsx`
- `src/features/chat/ChatPlaceholder.tsx`
- `src/store/index.ts`
- `src/store/uiSlice.ts`
- `src/styles/globals.css`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/logging.rs`
- `src-tauri/src/error.rs`
- `src-tauri/capabilities/default.json`
- `src/app/__tests__/TabHost.test.tsx`
- `src-tauri/tests/app_boot_smoke.rs`
- `scripts/smoke/phase-0b-shell.sh`

**Dependencies introduced**

- Frontend:
  - `@tauri-apps/api 2.10.1`
  - `react 19.2.4`
  - `react-dom 19.2.4`
  - `vite 8.0.1`
  - `@vitejs/plugin-react 6.0.1`
  - `tailwindcss 4.2.2`
  - `@tailwindcss/vite 4.2.2`
  - `zustand 5.0.12`
  - `immer 11.1.4`
  - `react-resizable-panels 4.7.3`
  - `lucide-react 0.577.0`
  - `vitest 4.1.0`
  - `@testing-library/react 16.3.2`
  - `@testing-library/user-event 14.6.1`
- Rust:
  - `tauri 2.10.3`
  - `tokio 1.50.0`
  - `tracing 0.1.44`
  - `tracing-subscriber 0.3.23`
  - `tracing-appender 0.2.4`

**Commands**

```bash
cd ~/projects
npm create tauri-app@latest dispatch
cd ~/projects/dispatch
npm install tailwindcss@4.2.2 @tailwindcss/vite@4.2.2 zustand@5.0.12 immer@11.1.4 react-resizable-panels@4.7.3 lucide-react@0.577.0
npm install -D vitest@4.1.0 @testing-library/react@16.3.2 @testing-library/user-event@14.6.1
npm run tauri dev
```

**Implementation**

- Scaffold the app at `~/projects/dispatch`.
- Replace the default app with the Dispatch shell and six top-level tabs.
- Implement lazy-mount-once tab behavior:
  - persistent after first open: Agents, Files, History, Chat
  - normal mount/unmount: Tasks, Settings overlays
- Add `logging.rs` early:
  - write app logs to `AppLog/dispatch.log`
  - rotate file appender
  - install panic hook that writes `panic-<timestamp>.log`
- Add `ErrorBoundary` around each tab surface.
- Add a health command in `lib.rs` so smoke tests can boot the app state without feature code.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml app_boot_smoke`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/app/__tests__/TabHost.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-0b-shell.sh`

**Done when**

- `npm run tauri dev` opens a native Dispatch window.
- The top bar and tab shell render in the intended dark theme.
- Heavy tabs do not mount until opened once.
- `dispatch.log` is written under the Tauri app log directory on first boot.

## Phase 1 — Projects + Persistence Foundation

**Goal:** Establish the canonical SQLite schema, project CRUD, safe path authority, and secret handling.

**Files**

- `src-tauri/migrations/001_init.sql`
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/db/migrate.rs`
- `src-tauri/src/models/project.rs`
- `src-tauri/src/models/task.rs`
- `src-tauri/src/models/agent_session.rs`
- `src-tauri/src/models/setting.rs`
- `src-tauri/src/services/project_registry.rs`
- `src-tauri/src/services/path_guard.rs`
- `src-tauri/src/services/secrets.rs`
- `src-tauri/src/commands/projects.rs`
- `src-tauri/src/commands/settings.rs`
- `src/shared/lib/tauri.ts`
- `src/features/projects/ProjectSwitcher.tsx`
- `src/features/projects/AddProjectDialog.tsx`
- `src/features/projects/__tests__/ProjectSwitcher.test.tsx`
- `src-tauri/tests/projects_db_tests.rs`
- `src-tauri/tests/path_guard_tests.rs`
- `scripts/smoke/phase-1-projects.sh`

**Dependencies introduced**

- Frontend:
  - `@tauri-apps/plugin-dialog 2.6.0`
- Rust:
  - `rusqlite 0.39.0`
  - `keyring 3.6.3`
  - `tauri-plugin-dialog 2.6.0`

**Commands**

```bash
cd ~/projects/dispatch
npm install @tauri-apps/plugin-dialog@2.6.0
cargo test --manifest-path src-tauri/Cargo.toml projects_db_tests
```

**Implementation**

- Create `001_init.sql` with:
  - `projects`
  - `tasks`
  - `agent_sessions`
  - `settings`
- Required columns:
  - `tasks`: `workflow_state`, `last_run_state`, `last_session_id`, `assigned_agent_mode`, `markdown_export_path`
  - `agent_sessions`: `project_id`, `task_id`, `source`, `session_kind`, `status`, `program`, `args_json`, `env_keys_json`, `cwd`, `transport`, `exit_code`, `started_at`, `ended_at`
- Implement `path_guard.rs`:
  - canonicalize project roots
  - reject symlink/path traversal escapes
  - expose `assert_project_relative(project_id, relative_path)`
- Implement `secrets.rs`:
  - `set_secret(key, value)`
  - `get_secret_status(key)` returning `keychain | env | missing`
  - `clear_secret(key)`
  - never return the stored secret to the frontend after initial set
- Add project CRUD commands.
- Persist non-secret settings in SQLite, not JSON store.
- Update `ProjectSwitcher.tsx` to load real projects and add/remove them via typed Tauri commands.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml projects_db_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml path_guard_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/projects/__tests__/ProjectSwitcher.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-1-projects.sh`

**Done when**

- Projects can be added, listed, removed, and reloaded after restart.
- The SQLite DB is created only by Rust and stored in the Tauri app data directory.
- `agent_sessions` exists before any terminal code lands.
- Path traversal outside a registered project root is rejected in tests.
- Secret status can be shown in Settings without storing secrets in SQLite or JS.

## Phase 2 — Terminal Core

**Goal:** Ship durable PTY sessions with correct attach/reconnect semantics and cleanup.

**Files**

- `src-tauri/src/services/pty_manager.rs`
- `src-tauri/src/services/terminal_ws.rs`
- `src-tauri/src/services/session_supervisor.rs`
- `src-tauri/src/commands/terminal.rs`
- `src/features/agents/AgentsTab.tsx`
- `src/features/agents/TerminalPanel.tsx`
- `src/features/agents/SessionSidebar.tsx`
- `src/features/agents/store/agentsSlice.ts`
- `src/features/agents/__tests__/TerminalPanel.test.tsx`
- `src-tauri/tests/pty_manager_tests.rs`
- `src-tauri/tests/terminal_ws_attach_tests.rs`
- `scripts/smoke/phase-2-terminal-core.sh`

**Dependencies introduced**

- Frontend:
  - `@xterm/xterm 6.0.0`
  - `@xterm/addon-fit 0.11.0`
  - `@xterm/addon-search 0.16.0`
  - `@xterm/addon-web-links 0.12.0`
  - `@xterm/addon-webgl 0.19.0`
- Rust:
  - `axum 0.8.8`
  - `portable-pty 0.9.0`

**Commands**

```bash
cd ~/projects/dispatch
npm install @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 @xterm/addon-search@0.16.0 @xterm/addon-web-links@0.12.0 @xterm/addon-webgl@0.19.0
cargo test --manifest-path src-tauri/Cargo.toml pty_manager_tests
```

**Implementation**

- Implement `create_terminal_session(project_id, shell, cwd)` in `pty_manager.rs` as the single PTY creation point.
- Persist every PTY-backed session immediately in `agent_sessions`.
- Implement `GET /ws/terminal/:session_id` in `terminal_ws.rs` to:
  - load existing session
  - reject missing/finished sessions
  - attach websocket I/O only
  - never spawn a process
- Support:
  - binary PTY output frames
  - typed resize message
  - reconnect attach
  - multi-session sidebar
- Add cleanup rules in `session_supervisor.rs`:
  - on kill: SIGTERM, then SIGKILL after timeout
  - on app close: drain all sessions
  - on startup: mark stale running sessions as `abandoned`
- Write session logs under `AppLog/sessions/<session_id>.log`.
- Wire terminal readiness so the frontend asks for the websocket port only after Axum bind completes.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml pty_manager_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml terminal_ws_attach_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/agents/__tests__/TerminalPanel.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-2-terminal-core.sh`

**Done when**

- A terminal session is created exactly once, stored in SQLite, and can be reattached after websocket disconnect.
- Resizing sends explicit PTY resize events and updates the child process correctly.
- Multiple terminal sessions can remain alive while switching tabs.
- Session cleanup on kill and app shutdown is covered by tests.

## Phase 3 — Direct Dispatch

**Goal:** Add safe structured agent dispatch, task/session linkage, and direct CLI execution without shell parsing.

**Files**

- `src-tauri/migrations/002_agent_profiles.sql`
- `src-tauri/src/models/agent_profile.rs`
- `src-tauri/src/services/agent_registry.rs`
- `src-tauri/src/services/dispatch.rs`
- `src-tauri/src/commands/dispatch.rs`
- `src/features/agents/DispatchModal.tsx`
- `src/features/agents/AgentSessionToolbar.tsx`
- `src/features/settings/AgentRegistryPane.tsx`
- `src/features/agents/__tests__/DispatchModal.test.tsx`
- `src-tauri/tests/dispatch_validation_tests.rs`
- `src-tauri/tests/task_transition_tests.rs`
- `scripts/smoke/phase-3-direct-dispatch.sh`

**Dependencies introduced**

- Frontend:
  - `react 19.2.4`
  - `zustand 5.0.12`
  - `@xterm/xterm 6.0.0`
- Rust:
  - `rusqlite 0.39.0`
  - `portable-pty 0.9.0`
  - `axum 0.8.8`

**Commands**

```bash
cd ~/projects/dispatch
cargo test --manifest-path src-tauri/Cargo.toml dispatch_validation_tests
cargo test --manifest-path src-tauri/Cargo.toml task_transition_tests
```

**Implementation**

- Add `agent_profiles` persistence in SQLite, seeded with Codex, Claude Code, and Gemini defaults.
- Replace command templates with a structured model:

```rust
struct AgentProfile {
    id: String,
    name: String,
    program: String,
    args: Vec<AgentArg>,
    env: HashMap<String, AgentEnvValue>,
    cwd: AgentCwd,
}

enum AgentArg {
    Literal(String),
    Prompt,
    ProjectPath,
    TaskTitle,
    TaskBody,
}
```

- Resolve the profile into `program`, `Vec<String>`, `env`, and `cwd` in Rust and feed that directly into PTY spawn. No shell, no quoting pass, no `sh -c`.
- Add optional `task_id` to `dispatch_agent()`.
- On dispatch from a task:
  - set `workflow_state = in_progress`
  - set `last_run_state = running`
  - store `last_session_id`
- On direct session completion:
  - exit `0` -> `workflow_state = review`, `last_run_state = succeeded`
  - non-zero -> keep `workflow_state = in_progress`, set `last_run_state = failed`
  - killed/canceled -> set `last_run_state = canceled`
- Add sidebar badges for `session_kind` and `status`.
- Add `Copy Output` and full-screen terminal actions.
- Add "Auto" as the first agent option:
  - standalone mode resolves to last-used local agent for the project
  - OpenClaw-aware auto-pick is activated in Phase 7

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml dispatch_validation_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml task_transition_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/agents/__tests__/DispatchModal.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-3-direct-dispatch.sh`

**Done when**

- Direct dispatch passes prompts with quotes/newlines safely because each argument is a real argv entry.
- Task-linked dispatch updates task workflow and run state automatically.
- Custom agents can be added without introducing shell injection risk.
- Session completion and failure are visible in both the Agents tab and the linked task.

## Phase 4 — Tasks

**Goal:** Build the Kanban board, task editing, and markdown export with direct dispatch wiring.

**Files**

- `src-tauri/src/commands/tasks.rs`
- `src-tauri/src/services/task_export.rs`
- `src/features/tasks/TasksTab.tsx`
- `src/features/tasks/KanbanBoard.tsx`
- `src/features/tasks/KanbanColumn.tsx`
- `src/features/tasks/KanbanCard.tsx`
- `src/features/tasks/TaskDetailDrawer.tsx`
- `src/features/tasks/store/tasksSlice.ts`
- `src/features/tasks/__tests__/KanbanBoard.test.tsx`
- `src-tauri/tests/task_export_tests.rs`
- `scripts/smoke/phase-4-tasks.sh`

**Dependencies introduced**

- `@dnd-kit/core 6.3.1`
- `@dnd-kit/sortable 10.0.0`
- `@tanstack/react-virtual 3.13.23`
- `react-markdown 10.1.0`
- `remark-gfm 4.0.1`
- `rehype-highlight 7.0.2`
- `rehype-slug 6.0.0`
- `highlight.js 11.11.1`

**Commands**

```bash
cd ~/projects/dispatch
npm install @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @tanstack/react-virtual@3.13.23 react-markdown@10.1.0 remark-gfm@4.0.1 rehype-highlight@7.0.2 rehype-slug@6.0.0 highlight.js@11.11.1
npm run test -- src/features/tasks/__tests__/KanbanBoard.test.tsx
```

**Implementation**

- Implement 5 workflow columns: Draft, Planning, In Progress, Review, Done.
- Surface `last_run_state` on each card as a badge.
- Build task create/edit/delete and drag/drop.
- Reuse `DispatchModal.tsx` from Phase 3 for "Send to Agent".
- Add markdown export in `task_export.rs`:
  - export path: `<project-root>/dispatch/tasks/<task-id>-<slug>.md`
  - include frontmatter: `id`, `project_id`, `workflow_state`, `priority`, `last_run_state`, `last_session_id`
  - update export on create, edit, status change, and session transition
- Add import-friendly markdown body containing description, subtasks, and review notes.
- Keep the task board scoped to `activeProjectId`.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml task_export_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/tasks/__tests__/KanbanBoard.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-4-tasks.sh`

**Done when**

- Tasks can be created, edited, reordered, and dispatched.
- Markdown exports are written under `dispatch/tasks/` inside each project root.
- Task cards reflect real session state without manual refresh.
- Dispatching from a task produces both a session row and a linked markdown export update.

## Phase 5 — Files

**Goal:** Ship a safe, Rust-owned Files tab with tree navigation, preview, search, and file watching.

**Files**

- `src-tauri/src/services/project_fs.rs`
- `src-tauri/src/services/file_watch.rs`
- `src-tauri/src/commands/files.rs`
- `src/features/files/FilesTab.tsx`
- `src/features/files/FileTree.tsx`
- `src/features/files/FilePreview.tsx`
- `src/features/files/store/filesSlice.ts`
- `src/features/files/__tests__/FilePreview.test.tsx`
- `src-tauri/tests/project_fs_tests.rs`
- `src-tauri/tests/file_watch_tests.rs`
- `scripts/smoke/phase-5-files.sh`

**Dependencies introduced**

- Frontend:
  - `@tauri-apps/plugin-opener 2.5.3`
- Rust:
  - `notify 8.2.0`
  - `ignore 0.4.25`
  - `grep-searcher 0.1.16`
  - `grep-regex 0.1.14`
  - `grep-matcher 0.1.8`
  - `tauri-plugin-opener 2.5.3`

**Commands**

```bash
cd ~/projects/dispatch
npm install @tauri-apps/plugin-opener@2.5.3
cargo test --manifest-path src-tauri/Cargo.toml project_fs_tests
cargo test --manifest-path src-tauri/Cargo.toml file_watch_tests
```

**Implementation**

- All file commands accept `project_id` plus project-relative paths. No absolute path entry from the frontend.
- Implement:
  - `list_project_tree(project_id, root_relative_path)`
  - `read_project_file(project_id, relative_path)`
  - `search_project_paths(project_id, query)`
  - `search_project_content(project_id, query)`
  - `open_in_editor(project_id, relative_path)`
- Use `ignore` for `.gitignore` filtering and traversal.
- Use `notify` watchers managed by Rust:
  - start on first Files tab open
  - stop on project switch or app shutdown
  - debounce change events and emit typed frontend refresh events
- Keep Files tab lazy-mounted-once so preview state persists, but do not watch projects that have never opened the Files tab.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml project_fs_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml file_watch_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/files/__tests__/FilePreview.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-5-files.sh`

**Done when**

- The file tree is always derived from Rust-owned project scope.
- `.gitignore` entries are hidden.
- Full-text search works without shelling out to system `rg`.
- File watching stops and starts cleanly during project switches.

## Phase 6 — History v1

**Goal:** Build a safe snapshot history on `refs/dispatch/*` for existing git repos only.

**Files**

- `src-tauri/migrations/003_save_points.sql`
- `src-tauri/src/services/history/mod.rs`
- `src-tauri/src/services/history/save_points.rs`
- `src-tauri/src/services/history/diff.rs`
- `src-tauri/src/services/history/restore.rs`
- `src-tauri/src/commands/history.rs`
- `src/features/history/HistoryTab.tsx`
- `src/features/history/SavePointList.tsx`
- `src/features/history/DiffViewer.tsx`
- `src/features/history/__tests__/HistoryTab.test.tsx`
- `src-tauri/tests/save_point_tests.rs`
- `src-tauri/tests/history_restore_tests.rs`
- `scripts/smoke/phase-6-history.sh`

**Dependencies introduced**

- `git2 0.20.4`

**Commands**

```bash
cd ~/projects/dispatch
cargo test --manifest-path src-tauri/Cargo.toml save_point_tests
cargo test --manifest-path src-tauri/Cargo.toml history_restore_tests
npm run test -- src/features/history/__tests__/HistoryTab.test.tsx
```

**Implementation**

- Add `save_points` metadata table with:
  - `project_id`
  - `run_id`
  - `ref_name`
  - `commit_oid`
  - `base_head_oid`
  - `stage`
  - `created_at`
- History v1 only activates for an existing git repository discovered under the project root.
- Create save points under:
  - `refs/dispatch/runs/<run_id>/pre`
  - `refs/dispatch/runs/<run_id>/post`
  - `refs/dispatch/manual/<timestamp>`
  - `refs/dispatch/latest`
- Always create the pre-run save point, even if the repo tree matches the last snapshot.
- Use a synthetic Dispatch signature, never the user's git identity.
- The v1 restore action restores the workspace snapshot from a Dispatch ref. It does not create a visible branch commit automatically.
- Single-file restore is in scope.
- Hook save-point creation into direct dispatch and orchestrated dispatch lifecycle.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml save_point_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml history_restore_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/history/__tests__/HistoryTab.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-6-history.sh`

**Done when**

- Save points live under `refs/dispatch/*`, not on the active branch.
- A clean repo still gets a pre-run anchor.
- The UI can list, diff, and restore Dispatch save points for existing repos.
- History v1 never initializes git automatically in a non-git project.

## Phase 7 — OpenClaw Thin Integration

**Goal:** Connect Dispatch to OpenClaw early enough to support orchestrated sessions without blocking standalone mode.

**Files**

- `src-tauri/src/services/openclaw/client.rs`
- `src-tauri/src/services/openclaw/protocol.rs`
- `src-tauri/src/services/openclaw/session_bridge.rs`
- `src-tauri/src/commands/openclaw.rs`
- `src/features/agents/OrchestratedSessionView.tsx`
- `src/features/agents/__tests__/OpenClawStatus.test.tsx`
- `src-tauri/tests/openclaw_client_tests.rs`
- `scripts/smoke/phase-7-openclaw.sh`

**Dependencies introduced**

- Rust:
  - `tokio-tungstenite 0.28.0`
  - `reqwest 0.12.28`

**Commands**

```bash
cd ~/projects/dispatch
cargo test --manifest-path src-tauri/Cargo.toml openclaw_client_tests
bash scripts/smoke/phase-7-openclaw.sh
```

**Implementation**

- Implement connection state management:
  - `disconnected`
  - `connecting`
  - `connected`
  - `reconnecting`
- Add Rust commands for:
  - connect
  - disconnect
  - status
  - sessions list
  - sessions spawn
  - sessions send
  - sessions kill
- Show orchestrated sessions in the Agents sidebar with a distinct badge.
- Activate the "Dispatch via VICAM" button when connected.
- Upgrade the "Auto" agent mode:
  - connected -> OpenClaw picks the agent
  - disconnected -> fallback to last-used direct CLI agent
- Wire task state transitions for orchestrated sessions using the same rules as direct dispatch.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml openclaw_client_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/agents/__tests__/OpenClawStatus.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-7-openclaw.sh`

**Done when**

- Dispatch can connect to a local OpenClaw gateway and list/spawn/kill sessions.
- Orchestrated sessions appear in the same Agents sidebar as PTY sessions.
- Auto-pick behaves correctly in connected and standalone modes.
- Session completion/failure continues to drive task transitions automatically.

## Phase 8 — Full Chat + Orchestrated Review Loop

**Goal:** Ship the primary chat surface and the task review loop that turns completed sessions into reviewable work.

**Files**

- `src-tauri/migrations/005_chat_cache.sql`
- `src-tauri/src/services/openclaw/chat.rs`
- `src-tauri/src/services/review_router.rs`
- `src/features/chat/ChatTab.tsx`
- `src/features/chat/MessageList.tsx`
- `src/features/chat/ChatInput.tsx`
- `src/features/chat/store/chatSlice.ts`
- `src/features/chat/__tests__/ChatTab.test.tsx`
- `src-tauri/tests/chat_stream_tests.rs`
- `src-tauri/tests/review_router_tests.rs`
- `scripts/smoke/phase-8-chat-review.sh`

**Dependencies introduced**

- Frontend:
  - `react 19.2.4`
  - `react-markdown 10.1.0`
  - `remark-gfm 4.0.1`
  - `rehype-highlight 7.0.2`
- Rust:
  - `tokio-tungstenite 0.28.0`
  - `reqwest 0.12.28`
  - `rusqlite 0.39.0`

**Commands**

```bash
cd ~/projects/dispatch
cargo test --manifest-path src-tauri/Cargo.toml chat_stream_tests
cargo test --manifest-path src-tauri/Cargo.toml review_router_tests
npm run test -- src/features/chat/__tests__/ChatTab.test.tsx
```

**Implementation**

- Build the Chat tab with:
  - streaming message list
  - markdown rendering
  - syntax-highlighted code blocks
  - model selector
  - project context badge
- Cache chat history in SQLite via Rust commands.
- Add the review router:
  - task reaches `review` after successful session completion
  - if automated review is enabled, Dispatch sends the review request through OpenClaw
  - OpenClaw response routes:
    - pass -> `workflow_state = done`
    - fail -> `workflow_state = in_progress`, review note populated
- Keep Agents tab stream view for orchestrated sessions.
- Explicitly defer voice input:
  - no microphone button in v1 release
  - add backlog note in code and docs, not a half-implemented UI

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml chat_stream_tests`
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml review_router_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/chat/__tests__/ChatTab.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-8-chat-review.sh`

**Done when**

- Chat streams reliably from OpenClaw and survives reconnects.
- A successful session can move a task from `review` to `done` via the review router.
- A failed review can move a task back to `in_progress` with feedback stored.
- Voice input is explicitly documented as post-v1, not silently omitted.

## Phase 9 — System Integration + Polish

**Goal:** Finish the product surface: settings, notifications, shortcuts, cleanup visibility, and performance hardening.

**Files**

- `src/features/settings/SettingsDialog.tsx`
- `src/features/settings/ConnectionSettings.tsx`
- `src/features/settings/SecretsPane.tsx`
- `src/features/settings/ProjectsPane.tsx`
- `src/features/settings/AgentRegistryPane.tsx`
- `src/shared/components/CommandPalette.tsx`
- `src/shared/hooks/useAppHotkeys.ts`
- `src-tauri/src/services/tray.rs`
- `src-tauri/src/commands/window.rs`
- `src-tauri/src/commands/notifications.rs`
- `src/features/settings/__tests__/SettingsDialog.test.tsx`
- `src-tauri/tests/settings_secret_tests.rs`
- `scripts/smoke/phase-9-system.sh`

**Dependencies introduced**

- Frontend:
  - `cmdk 1.1.1`
  - `react-hotkeys-hook 5.2.4`
  - `@tauri-apps/plugin-notification 2.3.3`
  - `@tauri-apps/plugin-global-shortcut 2.3.1`
- Rust:
  - `tauri-plugin-notification 2.3.3`
  - `tauri-plugin-global-shortcut 2.3.1`

**Commands**

```bash
cd ~/projects/dispatch
npm install cmdk@1.1.1 react-hotkeys-hook@5.2.4 @tauri-apps/plugin-notification@2.3.3 @tauri-apps/plugin-global-shortcut@2.3.1
cargo test --manifest-path src-tauri/Cargo.toml settings_secret_tests
npm run test -- src/features/settings/__tests__/SettingsDialog.test.tsx
```

**Implementation**

- Build the Settings dialog with sections for:
  - OpenClaw connection
  - projects
  - secret status and set/clear flows
  - agent registry
  - terminal preferences
  - notifications
  - about/build info
- Add desktop notifications for:
  - task completed
  - task failed
  - review complete
- Add system tray behavior:
  - closing the window hides to tray instead of destroying the app
  - tray tooltip shows running session count
  - tray menu exposes Show, New Terminal, and Quit
- Add global shortcut to focus Dispatch.
- Add command palette actions for:
  - create task
  - new terminal
  - dispatch selected task
  - create manual save point
  - open settings
- Add performance hardening:
  - watchers only active when needed
  - session logs discoverable from the Settings/About pane
  - error boundaries on all major surfaces

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml settings_secret_tests`
- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/settings/__tests__/SettingsDialog.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-9-system.sh`

**Done when**

- Users can configure OpenClaw, projects, agent profiles, and secret storage without raw file edits.
- Notifications and shortcuts work without destabilizing the app.
- Cleanup state is visible enough that stale sessions and log paths are debuggable.

## Phase 10 — Packaging + Release

**Goal:** Produce a releasable Linux build with CI, metrics, and documented install steps.

**Files**

- `src-tauri/tauri.conf.json`
- `.github/workflows/release.yml`
- `README.md`
- `scripts/smoke/phase-10-release.sh`
- `src-tauri/tests/release_smoke.rs`

**Dependencies introduced**

- Frontend:
  - `@tauri-apps/cli 2.10.1`
- Rust:
  - `tauri 2.10.3`

**Commands**

```bash
cd ~/projects/dispatch
npm run tauri build
cargo test --manifest-path src-tauri/Cargo.toml release_smoke
bash scripts/smoke/phase-10-release.sh
```

**Implementation**

- Package Linux targets:
  - `.AppImage`
  - `.deb`
- Build CI on Ubuntu 20.04 for glibc compatibility.
- Add release checklist for:
  - startup time
  - idle memory
  - terminal spawn latency
  - save-point creation latency
- Document build prerequisites and installation steps in `README.md`.
- Set release version to `0.1.0`.

**Verification**

- Rust:
  - `cd ~/projects/dispatch && cargo test --manifest-path src-tauri/Cargo.toml release_smoke`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-10-release.sh`
- Release metrics:
  - cold start under 2 seconds on target Linux box
  - direct dispatch spawn under 3 seconds

**Done when**

- CI produces `.AppImage` and `.deb` artifacts.
- A clean Linux test box can install and launch the app.
- Release docs and smoke checklist are complete enough for repeatable packaging.

## Phase 11 — Browser Experimental (Post-v1 Only)

**Goal:** If Browser returns after release, keep it deliberately narrow: localhost iframe preview only.

**Files**

- `src/features/browser/BrowserTab.tsx`
- `src/features/browser/AddressBar.tsx`
- `src/features/browser/store/browserSlice.ts`
- `src/features/browser/__tests__/BrowserTab.test.tsx`
- `scripts/smoke/phase-11-browser.sh`

**Dependencies introduced**

- Frontend:
  - `react 19.2.4`
  - `vite 8.0.1`

**Commands**

```bash
cd ~/projects/dispatch
npm run test -- src/features/browser/__tests__/BrowserTab.test.tsx
bash scripts/smoke/phase-11-browser.sh
```

**Implementation**

- Limit preview targets to `http://localhost:*` and `http://127.0.0.1:*`.
- Use iframe preview only.
- No arbitrary external browsing.
- No separate multi-webview manager.
- No DevTools embedding.
- Keep the feature behind an experimental flag until it proves stable.

**Verification**

- Component:
  - `cd ~/projects/dispatch && npm run test -- src/features/browser/__tests__/BrowserTab.test.tsx`
- Smoke:
  - `cd ~/projects/dispatch && bash scripts/smoke/phase-11-browser.sh`

**Done when**

- Browser is explicitly post-v1.
- Any future implementation is constrained to safe localhost preview scope.

## Final Build Checklist

- `agent_sessions` exists before PTY or OpenClaw work starts.
- PTY creation happens in one place only.
- WebSocket routes attach only.
- Direct CLI dispatch uses structured argv, env, and cwd.
- Rust is the only DB owner.
- Rust is the only filesystem owner.
- Secrets never land in SQLite or JSON settings.
- Save points live in `refs/dispatch/*`.
- Every phase has Rust tests, component tests, or a smoke script assigned.
- Browser and voice input are explicitly out of the v1 critical path.
