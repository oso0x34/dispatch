# Dispatch Ticket Breakdown

## Planning Assumptions

- Source of truth: `ROADMAP-v2.md`
- `PRD.md` is used for product behavior detail only where it does not conflict with `ROADMAP-v2.md`
- `ROADMAP-v2.md` resolves the known PRD drift:
  - voice input is post-v1, so there are no v1 voice tickets
  - Browser is post-v1/experimental, so Browser work is isolated after release
  - PR creation/review automation is out of the v1 build path
  - Linux `.AppImage` + `.deb` are the v1 release targets

## Dependency Graph Summary

- Critical path:
  `DISPATCH-001 -> DISPATCH-002 -> DISPATCH-003 -> DISPATCH-004 -> DISPATCH-005 -> DISPATCH-006 -> DISPATCH-007 -> DISPATCH-008 -> DISPATCH-009 -> DISPATCH-011 -> DISPATCH-012 -> DISPATCH-013 -> DISPATCH-015 -> DISPATCH-016 -> DISPATCH-017 -> DISPATCH-018 -> DISPATCH-020 -> DISPATCH-021 -> DISPATCH-023 -> DISPATCH-032 -> DISPATCH-033 -> DISPATCH-034 -> DISPATCH-035 -> DISPATCH-036 -> DISPATCH-037 -> DISPATCH-038 -> DISPATCH-039 -> DISPATCH-041 -> DISPATCH-043 -> DISPATCH-044 -> DISPATCH-045 -> DISPATCH-046`
- Recommended execution order:
  1. Architecture lock: `DISPATCH-001` to `DISPATCH-003`
  2. Shell/bootstrap: `DISPATCH-004` to `DISPATCH-007`
  3. Persistence foundation: `DISPATCH-008` to `DISPATCH-011`
  4. Core execution lane: terminal + direct dispatch + task wiring via `DISPATCH-012` to `DISPATCH-023`
  5. Parallel product lanes: files `DISPATCH-024` to `DISPATCH-027`, history `DISPATCH-028` to `DISPATCH-031`
  6. OpenClaw/chat/review lane: `DISPATCH-032` to `DISPATCH-038`
  7. System polish/release lane: `DISPATCH-039` to `DISPATCH-046`
  8. Post-v1 browser lane: `DISPATCH-047` to `DISPATCH-048`

## Parallel Workstreams

- After `DISPATCH-004`: `DISPATCH-005` and `DISPATCH-006` can run in parallel.
- After `DISPATCH-008`: `DISPATCH-009`, `DISPATCH-010`, and `DISPATCH-028` can run in parallel.
- After `DISPATCH-011`: `DISPATCH-012` and `DISPATCH-020` can run in parallel.
- After `DISPATCH-020`: `DISPATCH-021` and `DISPATCH-022` can run in parallel.
- After `DISPATCH-024`: `DISPATCH-025` and `DISPATCH-026` can run in parallel.
- After `DISPATCH-032`: `DISPATCH-033` and `DISPATCH-035` can run in parallel.
- After `DISPATCH-039`: `DISPATCH-040`, `DISPATCH-041`, and `DISPATCH-042` can run in parallel.
- After `DISPATCH-046`: `DISPATCH-047` and `DISPATCH-048` form an isolated post-v1 experimental lane.

## Tickets

### DISPATCH-001 — Lock Runtime Boundaries and Terminal Lifecycle ADRs
- **Phase**: Phase 0A — Architecture Lock
- **Description**: Write the runtime-boundary and terminal-lifecycle ADRs that freeze ownership between Rust and React, establish PTY single ownership, and define attach-only websocket semantics for all later work.
- **Acceptance Criteria**:
  - `docs/adr/0001-runtime-boundaries.md` explicitly assigns SQLite, secrets, filesystem, PTYs, and OpenClaw connectivity to Rust, with frontend state limited to UI concerns.
  - `docs/adr/0002-terminal-lifecycle.md` states that `create_terminal_session()` is the only PTY creation path and `GET /ws/terminal/:session_id` only attaches.
  - Disconnect, reconnect, and shutdown behavior for PTY-backed sessions is documented with no unresolved TODOs.
- **Dependencies**: none
- **Estimated Hours**: 3
- **Priority**: P0
- **Key Files**:
  - `docs/adr/0001-runtime-boundaries.md`
  - `docs/adr/0002-terminal-lifecycle.md`

### DISPATCH-002 — Freeze Data Model, Save-Point Rules, and v1 Scope
- **Phase**: Phase 0A — Architecture Lock
- **Description**: Write the data-model and history-save-point ADRs plus the v1 scope checklist so schema, task states, secret precedence, save-point namespace, and deferred features are fixed before implementation.
- **Acceptance Criteria**:
  - `docs/adr/0003-data-model.md` defines the initial `projects`, `tasks`, `agent_sessions`, and `settings` schema plus locked task state enums.
  - `docs/adr/0004-history-save-points.md` defines `refs/dispatch/*` naming, pre/post/manual/latest save-point rules, and synthetic Dispatch signatures.
  - `docs/checklists/v1-scope.md` distinguishes v1 from post-v1, including no voice input in v1 and Browser moved to post-v1.
- **Dependencies**: DISPATCH-001
- **Estimated Hours**: 3
- **Priority**: P0
- **Key Files**:
  - `docs/adr/0003-data-model.md`
  - `docs/adr/0004-history-save-points.md`
  - `docs/checklists/v1-scope.md`

### DISPATCH-003 — Publish Verification Strategy and Architecture Gate Checklist
- **Phase**: Phase 0A — Architecture Lock
- **Description**: Create the project-wide test strategy and final architecture gate so each phase has explicit verification lanes and the roadmap/PRD contradictions are closed in writing.
- **Acceptance Criteria**:
  - `docs/test-strategy.md` maps Rust unit tests, Rust integration tests, React component tests, and shell smoke scripts to exact repo locations.
  - `docs/checklists/v1-scope.md` includes quality gates for PTY single creation, structured dispatch, single DB owner, single filesystem owner, early `agent_sessions`, and verification per phase.
  - The document set explicitly records that `ROADMAP-v2.md` supersedes conflicting PRD items on voice, Browser, and PR automation scope.
- **Dependencies**: DISPATCH-001, DISPATCH-002
- **Estimated Hours**: 2
- **Priority**: P0
- **Key Files**:
  - `docs/test-strategy.md`
  - `docs/checklists/v1-scope.md`

### DISPATCH-004 — Bootstrap the Tauri/React Workspace
- **Phase**: Phase 0B — Scaffold + Shell
- **Description**: Scaffold the Dispatch app with the locked package versions, base folder structure, providers/store entry points, and a minimal Rust boot path that can host later feature work.
- **Acceptance Criteria**:
  - `npm run tauri dev` opens a native window with the scaffolded Dispatch app.
  - Frontend and backend file layout matches the canonical repo structure in the roadmap.
  - A minimal health command exists in Rust and can be called through a typed frontend wrapper.
- **Dependencies**: DISPATCH-003
- **Estimated Hours**: 4
- **Priority**: P0
- **Key Files**:
  - `package.json`
  - `vite.config.ts`
  - `tsconfig.json`
  - `src/main.tsx`
  - `src/app/providers.tsx`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/lib.rs`

## Skill Handoff Ledger

- 2026-03-19 20:02:24 CDT — `implementer -> DISPATCH-005 / DISPATCH-006`
  Status: PARTIAL_PASS
  Summary: Scaffolded the real Tauri v2 + React 19 workspace, added the canonical repo layout under `src/` and `src-tauri/`, created the provider/store entry points, wired a typed frontend `health` invoke wrapper, and added the minimal Rust `health` command plus `tauri::Builder` boot path.
  AC coverage: AC2 PASS. AC3 PASS. AC1 code path is ready but local verification is blocked by missing Ubuntu Tauri native prerequisites (`gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, `atk`) on this host.
  Command summary: `npm install` PASS. `npm run build` PASS. `cargo build` BLOCKED by missing system GTK/WebKit headers. `npm run tauri dev` BLOCKED by the same host prerequisite gap after Vite started successfully.
  Next skill must read: `CONTEXT_PACKAGE.md`, `package.json`, `src/app/App.tsx`, `src/app/providers.tsx`, `src/shared/tauri/health.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/health.rs`, `src-tauri/tauri.conf.json`.

### DISPATCH-005 — Build the Dark Shell, Top Bar, and Lazy Tab Host
- **Phase**: Phase 0B — Scaffold + Shell
- **Description**: Replace the starter UI with the Dispatch shell, tab bar, placeholders, and lazy-mount-once tab behavior for heavy surfaces.
- **Acceptance Criteria**:
  - The top bar and tab shell render the v1 tabs in the intended dark theme.
  - Agents, Files, History, and Chat mount only after first open and preserve state when revisited.
  - Tasks and settings overlays use normal mount/unmount behavior.
- **Dependencies**: DISPATCH-004
- **Estimated Hours**: 5
- **Priority**: P0
- **Key Files**:
  - `src/app/App.tsx`
  - `src/app/TabHost.tsx`
  - `src/shared/components/TopBar.tsx`
  - `src/shared/components/TabBar.tsx`
  - `src/features/projects/ProjectsPlaceholder.tsx`
  - `src/features/agents/AgentsPlaceholder.tsx`
  - `src/features/tasks/TasksPlaceholder.tsx`
  - `src/features/files/FilesPlaceholder.tsx`
  - `src/features/history/HistoryPlaceholder.tsx`
  - `src/features/chat/ChatPlaceholder.tsx`
  - `src/styles/globals.css`

### DISPATCH-006 — Add Logging, Panic Capture, and Per-Tab Error Isolation
- **Phase**: Phase 0B — Scaffold + Shell
- **Description**: Implement early logging, panic capture, and per-surface error boundaries so failures are diagnosable without taking down the whole shell.
- **Acceptance Criteria**:
  - `dispatch.log` is created in the Tauri log directory on first boot and uses file rotation.
  - Panic hook writes timestamped panic logs to disk.
  - Each major tab surface is wrapped in an error boundary and a surface-level failure does not unmount the full app shell.
- **Dependencies**: DISPATCH-004
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src/shared/components/ErrorBoundary.tsx`
  - `src-tauri/src/logging.rs`
  - `src-tauri/src/error.rs`
  - `src-tauri/src/lib.rs`

### DISPATCH-007 — Add Shell Tests and Boot Smoke Coverage
- **Phase**: Phase 0B — Scaffold + Shell
- **Description**: Create the first shell test harness so the app can prove boot viability, lazy mounting, and health-command availability in CI and local smoke runs.
- **Acceptance Criteria**:
  - `src/app/__tests__/TabHost.test.tsx` verifies lazy-mount-once behavior for heavy tabs.
  - `src-tauri/tests/app_boot_smoke.rs` validates app state boot and health command response.
  - `scripts/smoke/phase-0b-shell.sh` runs the shell smoke flow and fails loudly on boot regressions.
- **Dependencies**: DISPATCH-005, DISPATCH-006
- **Estimated Hours**: 3
- **Priority**: P1
- **Key Files**:
  - `src/app/__tests__/TabHost.test.tsx`
  - `src-tauri/tests/app_boot_smoke.rs`
  - `scripts/smoke/phase-0b-shell.sh`

### DISPATCH-008 — Create the Initial SQLite Schema and DB Bootstrap
- **Phase**: Phase 1 — Projects + Persistence Foundation
- **Description**: Implement Rust-owned DB bootstrap, migration running, and models for the initial schema so all later features persist through the same authority layer.
- **Acceptance Criteria**:
  - `src-tauri/migrations/001_init.sql` creates `projects`, `tasks`, `agent_sessions`, and `settings` with the roadmap-required columns.
  - Migrations run from Rust only and store the SQLite file in the Tauri app data directory.
  - Tests can initialize a fresh database and verify the expected schema shape.
- **Dependencies**: DISPATCH-007
- **Estimated Hours**: 5
- **Priority**: P0
- **Key Files**:
  - `src-tauri/migrations/001_init.sql`
  - `src-tauri/src/db/mod.rs`
  - `src-tauri/src/db/migrate.rs`
  - `src-tauri/src/models/project.rs`
  - `src-tauri/src/models/task.rs`
  - `src-tauri/src/models/agent_session.rs`
  - `src-tauri/src/models/setting.rs`

### DISPATCH-009 — Implement Project Registry and Path Guard Backend
- **Phase**: Phase 1 — Projects + Persistence Foundation
- **Description**: Build the backend services that own project root registration, canonicalization, and path safety so no later feature can escape a registered project root.
- **Acceptance Criteria**:
  - Project roots are canonicalized and deduplicated when stored.
  - `assert_project_relative(project_id, relative_path)` rejects traversal and symlink escapes in tests.
  - Project CRUD commands expose only safe project-scoped paths to the frontend.
- **Dependencies**: DISPATCH-008
- **Estimated Hours**: 6
- **Priority**: P0
- **Key Files**:
  - `src-tauri/src/services/project_registry.rs`
  - `src-tauri/src/services/path_guard.rs`
  - `src-tauri/src/commands/projects.rs`
  - `src-tauri/tests/projects_db_tests.rs`
  - `src-tauri/tests/path_guard_tests.rs`

### DISPATCH-010 — Implement Settings Persistence and Secret Storage
- **Phase**: Phase 1 — Projects + Persistence Foundation
- **Description**: Add Rust-owned settings persistence plus keychain/env secret handling without ever making the frontend the system of record for secrets.
- **Acceptance Criteria**:
  - Non-secret settings persist in SQLite rather than a JSON store.
  - Secret APIs support `set_secret`, `get_secret_status`, and `clear_secret` with `keychain | env | missing` status semantics.
  - Stored secret values are never returned to the frontend after initial set and are not written to SQLite.
- **Dependencies**: DISPATCH-008
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/secrets.rs`
  - `src-tauri/src/commands/settings.rs`
  - `src-tauri/src/models/setting.rs`

### DISPATCH-011 — Wire the Project Switcher and Add Project Dialog
- **Phase**: Phase 1 — Projects + Persistence Foundation
- **Description**: Connect the shell project controls to real Tauri commands and dialog-based project selection so multi-project state is usable before feature tabs fill in.
- **Acceptance Criteria**:
  - Users can add, list, switch, and remove projects from the UI.
  - Active project state reloads correctly after restart.
  - Component tests cover empty, populated, add, switch, and remove flows.
- **Dependencies**: DISPATCH-009
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src/shared/lib/tauri.ts`
  - `src/features/projects/ProjectSwitcher.tsx`
  - `src/features/projects/AddProjectDialog.tsx`
  - `src/features/projects/__tests__/ProjectSwitcher.test.tsx`
  - `scripts/smoke/phase-1-projects.sh`

### DISPATCH-012 — Implement PTY Session Creation and Persistence
- **Phase**: Phase 2 — Terminal Core
- **Description**: Build `create_terminal_session()` as the single PTY creation entry point and persist every session immediately into `agent_sessions`.
- **Acceptance Criteria**:
  - All new terminal sessions and dispatch-launched sessions are created through `create_terminal_session()`.
  - PTY-backed sessions are inserted into `agent_sessions` before websocket attach begins.
  - PTY manager tests cover project cwd selection, shell selection, and persisted session metadata.
- **Dependencies**: DISPATCH-011
- **Estimated Hours**: 6
- **Priority**: P0
- **Key Files**:
  - `src-tauri/src/services/pty_manager.rs`
  - `src-tauri/src/commands/terminal.rs`
  - `src-tauri/tests/pty_manager_tests.rs`

### DISPATCH-013 — Build the Attach-Only Terminal WebSocket Transport
- **Phase**: Phase 2 — Terminal Core
- **Description**: Implement the Axum websocket attach server for existing PTY sessions, including binary output, resize messages, and reconnect behavior without respawning processes.
- **Acceptance Criteria**:
  - `GET /ws/terminal/:session_id` attaches only to existing running sessions and rejects missing or finished ones.
  - Resize messages update PTY dimensions correctly.
  - Websocket reconnects resume session I/O without creating a second PTY process.
- **Dependencies**: DISPATCH-012
- **Estimated Hours**: 5
- **Priority**: P0
- **Key Files**:
  - `src-tauri/src/services/terminal_ws.rs`
  - `src-tauri/src/commands/terminal.rs`
  - `src-tauri/tests/terminal_ws_attach_tests.rs`

### DISPATCH-014 — Add Session Supervision, Cleanup, and Session Logs
- **Phase**: Phase 2 — Terminal Core
- **Description**: Implement cleanup ownership for PTYs by adding session supervision, shutdown handling, stale-session reconciliation, and per-session log capture.
- **Acceptance Criteria**:
  - Kill sends SIGTERM first and escalates to SIGKILL after timeout.
  - App startup marks stale running sessions as `abandoned`.
  - Session logs are written under `AppLog/sessions/<session_id>.log` and referenced by tests.
- **Dependencies**: DISPATCH-012
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/session_supervisor.rs`
  - `src-tauri/src/services/pty_manager.rs`
  - `src-tauri/tests/pty_manager_tests.rs`

### DISPATCH-015 — Build the Agents Tab Terminal UX
- **Phase**: Phase 2 — Terminal Core
- **Description**: Create the Agents tab sidebar, terminal panel, and frontend session store needed to browse and reattach multiple PTY sessions across tab switches.
- **Acceptance Criteria**:
  - Sidebar lists multiple sessions with status and elapsed time.
  - Terminal panel can switch between sessions without killing inactive ones.
  - Component tests cover session selection, mount behavior, and terminal readiness flow.
- **Dependencies**: DISPATCH-013, DISPATCH-014
- **Estimated Hours**: 6
- **Priority**: P1
- **Key Files**:
  - `src/features/agents/AgentsTab.tsx`
  - `src/features/agents/TerminalPanel.tsx`
  - `src/features/agents/SessionSidebar.tsx`
  - `src/features/agents/store/agentsSlice.ts`
  - `src/features/agents/__tests__/TerminalPanel.test.tsx`
  - `scripts/smoke/phase-2-terminal-core.sh`

### DISPATCH-016 — Add Agent Profiles Schema and Registry Service
- **Phase**: Phase 3 — Direct Dispatch
- **Description**: Persist structured agent profiles in SQLite, seed the default local agents, and expose registry APIs for later dispatch and settings flows.
- **Acceptance Criteria**:
  - `agent_profiles` storage exists with seeded Codex, Claude Code, and Gemini defaults.
  - Backend can list and mutate profiles without storing shell command templates.
  - Registry exposes an `Auto` option placeholder for standalone and OpenClaw-aware routing.
- **Dependencies**: DISPATCH-015
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/migrations/002_agent_profiles.sql`
  - `src-tauri/src/models/agent_profile.rs`
  - `src-tauri/src/services/agent_registry.rs`

### DISPATCH-017 — Implement the Structured Dispatch Resolver
- **Phase**: Phase 3 — Direct Dispatch
- **Description**: Resolve agent profiles into program, argv, env, and cwd in Rust, then feed those values directly into the PTY spawn path with no shell parsing.
- **Acceptance Criteria**:
  - Agent args support literals plus prompt/project/task placeholders and resolve to a final argv vector.
  - Dispatch never uses `sh -c`, string interpolation, or a quoting pass.
  - Validation tests cover quotes, newlines, missing data, and shell-injection attempts.
- **Dependencies**: DISPATCH-015, DISPATCH-016
- **Estimated Hours**: 6
- **Priority**: P0
- **Key Files**:
  - `src-tauri/src/services/dispatch.rs`
  - `src-tauri/src/commands/dispatch.rs`
  - `src-tauri/src/services/agent_registry.rs`
  - `src-tauri/tests/dispatch_validation_tests.rs`

### DISPATCH-018 — Automate Task State Transitions for Direct Dispatch
- **Phase**: Phase 3 — Direct Dispatch
- **Description**: Link direct-dispatch session lifecycle to task workflow state, run state, and `last_session_id` updates so the board can reflect execution without manual editing.
- **Acceptance Criteria**:
  - Task-linked dispatch sets `workflow_state=in_progress`, `last_run_state=running`, and `last_session_id`.
  - Successful, failed, and canceled direct sessions update task state per the roadmap contract.
  - Transition tests cover start, success, failure, and cancel flows.
- **Dependencies**: DISPATCH-017
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/commands/dispatch.rs`
  - `src-tauri/src/services/dispatch.rs`
  - `src-tauri/tests/task_transition_tests.rs`

### DISPATCH-019 — Build the Dispatch Modal and Session Controls
- **Phase**: Phase 3 — Direct Dispatch
- **Description**: Implement the shared dispatch modal, session toolbar actions, badges, and UI integration points for direct CLI execution.
- **Acceptance Criteria**:
  - Dispatch modal supports agent selection, prompt editing, project context, and standalone `Auto` fallback.
  - Session toolbar supports copy output, full-screen, kill, and linked-task navigation.
  - Component tests cover modal validation and registry-backed agent selection.
- **Dependencies**: DISPATCH-016, DISPATCH-017, DISPATCH-018
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src/features/agents/DispatchModal.tsx`
  - `src/features/agents/AgentSessionToolbar.tsx`
  - `src/features/settings/AgentRegistryPane.tsx`
  - `src/features/agents/__tests__/DispatchModal.test.tsx`
  - `scripts/smoke/phase-3-direct-dispatch.sh`

### DISPATCH-020 — Implement Task Commands and Frontend Store Foundation
- **Phase**: Phase 4 — Tasks
- **Description**: Build task CRUD commands and the project-scoped frontend store so the board UI has a stable data contract before drag/drop and detail work lands.
- **Acceptance Criteria**:
  - Tasks can be created, listed, updated, and deleted through typed Tauri commands.
  - Task queries are always scoped to `activeProjectId`.
  - Command or store tests cover empty and populated task sets per project.
- **Dependencies**: DISPATCH-011
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/commands/tasks.rs`
  - `src/features/tasks/store/tasksSlice.ts`
  - `src/features/tasks/TasksTab.tsx`

### DISPATCH-021 — Build the Kanban Board, Columns, and Drag/Drop
- **Phase**: Phase 4 — Tasks
- **Description**: Implement the five workflow columns, card rendering, and drag/drop state changes needed for the main planning board.
- **Acceptance Criteria**:
  - Board renders Draft, Planning, In Progress, Review, and Done columns.
  - Drag/drop persists workflow state changes.
  - Component tests cover reordering and cross-column moves.
- **Dependencies**: DISPATCH-020
- **Estimated Hours**: 6
- **Priority**: P1
- **Key Files**:
  - `src/features/tasks/KanbanBoard.tsx`
  - `src/features/tasks/KanbanColumn.tsx`
  - `src/features/tasks/KanbanCard.tsx`
  - `src/features/tasks/__tests__/KanbanBoard.test.tsx`

### DISPATCH-022 — Add Task Detail Drawer and Card Metadata Editing
- **Phase**: Phase 4 — Tasks
- **Description**: Add the detail drawer and editable task metadata so cards can carry the richer PRD fields without bloating the board surface.
- **Acceptance Criteria**:
  - Users can edit markdown description, subtasks, labels, priority, assignee/agent mode, and review notes.
  - Cards surface priority and last-run badges without opening the drawer.
  - Tests cover save, cancel, and metadata rendering behavior.
- **Dependencies**: DISPATCH-020
- **Estimated Hours**: 5
- **Priority**: P2
- **Key Files**:
  - `src/features/tasks/TaskDetailDrawer.tsx`
  - `src/features/tasks/KanbanCard.tsx`
  - `src/features/tasks/store/tasksSlice.ts`

### DISPATCH-023 — Add Markdown Export and Task Dispatch Wiring
- **Phase**: Phase 4 — Tasks
- **Description**: Export task state into project-local markdown and connect task cards to the shared dispatch flow so task status, markdown exports, and sessions stay in sync.
- **Acceptance Criteria**:
  - Task export writes `<project-root>/dispatch/tasks/<task-id>-<slug>.md` with required frontmatter fields.
  - Export updates on task create, edit, status change, and session transition.
  - Clicking `Send to Agent` from a task card reuses the shared dispatch modal and keeps task/session linkage current.
- **Dependencies**: DISPATCH-018, DISPATCH-021, DISPATCH-022
- **Estimated Hours**: 6
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/task_export.rs`
  - `src-tauri/src/commands/tasks.rs`
  - `src/features/tasks/TasksTab.tsx`
  - `src/features/tasks/KanbanCard.tsx`
  - `src-tauri/tests/task_export_tests.rs`
  - `scripts/smoke/phase-4-tasks.sh`

### DISPATCH-024 — Build Project-Scoped File Tree and Read Commands
- **Phase**: Phase 5 — Files
- **Description**: Implement the backend tree and file-read APIs rooted in project-relative paths so the Files tab can render without exposing arbitrary filesystem access.
- **Acceptance Criteria**:
  - Tree listing and file reads require `project_id` plus a project-relative path.
  - Absolute-path and traversal attempts are rejected in backend tests.
  - Valid text and markdown files can be read into preview-ready payloads.
- **Dependencies**: DISPATCH-009
- **Estimated Hours**: 6
- **Priority**: P2
- **Key Files**:
  - `src-tauri/src/services/project_fs.rs`
  - `src-tauri/src/commands/files.rs`
  - `src-tauri/tests/project_fs_tests.rs`

### DISPATCH-025 — Implement Path and Content Search for Project Files
- **Phase**: Phase 5 — Files
- **Description**: Add Rust-owned filename and content search using ignore/grep crates so the Files tab can search without shelling out to system tools.
- **Acceptance Criteria**:
  - Path search respects `.gitignore` and hides ignored directories.
  - Content search returns project-relative hits with enough context for preview navigation.
  - Tests cover ignored files, nested directories, and mixed content types.
- **Dependencies**: DISPATCH-024
- **Estimated Hours**: 4
- **Priority**: P2
- **Key Files**:
  - `src-tauri/src/services/project_fs.rs`
  - `src-tauri/src/commands/files.rs`
  - `src-tauri/tests/project_fs_tests.rs`

### DISPATCH-026 — Add File Watch Lifecycle and Refresh Events
- **Phase**: Phase 5 — Files
- **Description**: Implement Rust-managed file watchers that start only when needed, debounce change events, and stop cleanly on project switch or shutdown.
- **Acceptance Criteria**:
  - Watchers start on first Files-tab open for a project, not at app boot.
  - Project switch and app shutdown tear down active watchers cleanly.
  - Debounced typed refresh events are covered by tests.
- **Dependencies**: DISPATCH-024
- **Estimated Hours**: 4
- **Priority**: P2
- **Key Files**:
  - `src-tauri/src/services/file_watch.rs`
  - `src-tauri/src/commands/files.rs`
  - `src-tauri/tests/file_watch_tests.rs`

### DISPATCH-027 — Build the Files Tab UX and Editor Handoff
- **Phase**: Phase 5 — Files
- **Description**: Create the Files tab UI with tree navigation, preview, search entry points, and `Open in editor` behavior while preserving state across lazy tab switches.
- **Acceptance Criteria**:
  - Users can browse the tree, preview files, and keep the last selection when returning to the tab.
  - Search results navigate directly to matching files and preview content.
  - `Open in editor` launches the selected file via the opener plugin.
- **Dependencies**: DISPATCH-011, DISPATCH-025, DISPATCH-026
- **Estimated Hours**: 6
- **Priority**: P2
- **Key Files**:
  - `src/features/files/FilesTab.tsx`
  - `src/features/files/FileTree.tsx`
  - `src/features/files/FilePreview.tsx`
  - `src/features/files/store/filesSlice.ts`
  - `src/features/files/__tests__/FilePreview.test.tsx`
  - `scripts/smoke/phase-5-files.sh`

### DISPATCH-028 — Create Save-Point Metadata Schema and Discovery Service
- **Phase**: Phase 6 — History v1
- **Description**: Add the `save_points` metadata table and backend discovery service so Dispatch can track save-point refs independently of branch history.
- **Acceptance Criteria**:
  - Migration creates the roadmap-defined `save_points` schema.
  - Backend can list project save points in reverse chronological order.
  - Tests cover save-point metadata persistence for an existing git repo fixture.
- **Dependencies**: DISPATCH-008
- **Estimated Hours**: 4
- **Priority**: P2
- **Key Files**:
  - `src-tauri/migrations/003_save_points.sql`
  - `src-tauri/src/services/history/mod.rs`
  - `src-tauri/tests/save_point_tests.rs`

### DISPATCH-029 — Implement Dispatch Ref Creation and Lifecycle Hooks
- **Phase**: Phase 6 — History v1
- **Description**: Create pre/post/manual/latest refs under `refs/dispatch/*` and hook save-point creation into run lifecycles so agent work is recoverable without polluting branch history.
- **Acceptance Criteria**:
  - Pre-run save points are created even on clean repos.
  - Direct and orchestrated runs write `refs/dispatch/runs/*` and update `refs/dispatch/latest`.
  - Save-point creation uses a synthetic Dispatch identity and records metadata for each hook.
- **Dependencies**: DISPATCH-017, DISPATCH-028
- **Estimated Hours**: 6
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/history/save_points.rs`
  - `src-tauri/src/services/history/mod.rs`
  - `src-tauri/src/commands/history.rs`
  - `src-tauri/tests/save_point_tests.rs`

### DISPATCH-030 — Build Diff and Restore Backend for Existing Git Repos
- **Phase**: Phase 6 — History v1
- **Description**: Implement save-point diff payloads and restore flows, including single-file restore, while preserving the rule that non-git projects do not get auto-initialized.
- **Acceptance Criteria**:
  - Backend can generate diff summaries and file-level diff content for Dispatch save points.
  - Restore supports full-workspace and single-file restore from a Dispatch ref.
  - Non-git projects return a typed unsupported state instead of initializing a repository.
- **Dependencies**: DISPATCH-028
- **Estimated Hours**: 6
- **Priority**: P2
- **Key Files**:
  - `src-tauri/src/services/history/diff.rs`
  - `src-tauri/src/services/history/restore.rs`
  - `src-tauri/tests/history_restore_tests.rs`

### DISPATCH-031 — Build the History Tab and Restore UX
- **Phase**: Phase 6 — History v1
- **Description**: Create the History tab list, search, diff viewer, manual save point action, and restore confirmations so save-point recovery is usable from the desktop UI.
- **Acceptance Criteria**:
  - Users can list and search save points in the History tab.
  - Diff viewer loads file-by-file changes for a selected save point.
  - Manual save-point creation and restore confirmations are covered by component tests.
- **Dependencies**: DISPATCH-029, DISPATCH-030
- **Estimated Hours**: 6
- **Priority**: P2
- **Key Files**:
  - `src/features/history/HistoryTab.tsx`
  - `src/features/history/SavePointList.tsx`
  - `src/features/history/DiffViewer.tsx`
  - `src/features/history/__tests__/HistoryTab.test.tsx`
  - `scripts/smoke/phase-6-history.sh`

### DISPATCH-032 — Implement the OpenClaw Client and Connection State Machine
- **Phase**: Phase 7 — OpenClaw Thin Integration
- **Description**: Build the Rust OpenClaw client, protocol layer, and connection-state machine that lets Dispatch connect and recover without blocking standalone mode.
- **Acceptance Criteria**:
  - Backend exposes connect, disconnect, status, list, spawn, send, and kill commands.
  - Connection state transitions through `disconnected`, `connecting`, `connected`, and `reconnecting`.
  - Tests cover successful connection, reconnect, and gateway-down scenarios.
- **Dependencies**: DISPATCH-019
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/openclaw/client.rs`
  - `src-tauri/src/services/openclaw/protocol.rs`
  - `src-tauri/src/commands/openclaw.rs`
  - `src-tauri/tests/openclaw_client_tests.rs`

### DISPATCH-033 — Bridge Orchestrated Sessions into the Agents Sidebar
- **Phase**: Phase 7 — OpenClaw Thin Integration
- **Description**: Merge OpenClaw session events into the unified Agents tab session model so orchestrated and direct sessions share one control surface.
- **Acceptance Criteria**:
  - Orchestrated sessions appear in the Agents sidebar with a distinct badge and status.
  - Session bridge maps OpenClaw events into the same session list/store used by PTY sessions.
  - Component tests cover connected, disconnected, and mixed-session sidebar states.
- **Dependencies**: DISPATCH-015, DISPATCH-032
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/openclaw/session_bridge.rs`
  - `src/features/agents/OrchestratedSessionView.tsx`
  - `src/features/agents/store/agentsSlice.ts`
  - `src/features/agents/__tests__/OpenClawStatus.test.tsx`

### DISPATCH-034 — Enable VICAM Dispatch, Auto Routing, and Task Linkage
- **Phase**: Phase 7 — OpenClaw Thin Integration
- **Description**: Turn on the `Dispatch via VICAM` flow, upgrade `Auto` routing when connected, and apply the same task lifecycle rules to orchestrated sessions as direct dispatch.
- **Acceptance Criteria**:
  - `Dispatch via VICAM` is enabled only when OpenClaw is connected and stays disabled in standalone mode.
  - `Auto` routes to OpenClaw agent-pick when connected and falls back to the last-used local agent when disconnected.
  - Orchestrated session start, success, failure, and cancellation update linked task state consistently with direct CLI sessions.
- **Dependencies**: DISPATCH-023, DISPATCH-033
- **Estimated Hours**: 6
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/commands/openclaw.rs`
  - `src-tauri/src/services/openclaw/session_bridge.rs`
  - `src/features/agents/DispatchModal.tsx`
  - `src/features/tasks/TasksTab.tsx`

### DISPATCH-035 — Add Chat Cache Schema and Streaming Backend
- **Phase**: Phase 8 — Full Chat + Orchestrated Review Loop
- **Description**: Implement SQLite-backed chat caching plus a streaming backend for the main OpenClaw chat session with reconnect-safe history replay.
- **Acceptance Criteria**:
  - Migration creates chat cache storage and Rust commands can persist/load message history.
  - Streaming backend resumes after reconnect without duplicating cached messages.
  - Tests cover incremental stream events, reconnect, and cache replay.
- **Dependencies**: DISPATCH-032
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src-tauri/migrations/004_chat_cache.sql`
  - `src-tauri/src/services/openclaw/chat.rs`
  - `src-tauri/tests/chat_stream_tests.rs`

### DISPATCH-036 — Build the Chat Tab UI and Message Rendering
- **Phase**: Phase 8 — Full Chat + Orchestrated Review Loop
- **Description**: Create the Chat tab UI with streaming messages, markdown/code rendering, model selector, context badge, and quick action affordances aligned to the PRD.
- **Acceptance Criteria**:
  - Chat renders streaming assistant output with markdown and syntax-highlighted code blocks.
  - Model selector and project context badge are visible and affect outgoing message metadata.
  - Voice input is absent from the v1 UI and explicitly marked as post-v1 in code or UI copy.
- **Dependencies**: DISPATCH-035
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src/features/chat/ChatTab.tsx`
  - `src/features/chat/MessageList.tsx`
  - `src/features/chat/ChatInput.tsx`
  - `src/features/chat/store/chatSlice.ts`
  - `src/features/chat/__tests__/ChatTab.test.tsx`

### DISPATCH-037 — Implement the Automated Review Router
- **Phase**: Phase 8 — Full Chat + Orchestrated Review Loop
- **Description**: Build the review router that turns completed sessions into review requests and writes pass/fail decisions back into task workflow state and notes.
- **Acceptance Criteria**:
  - Successful sessions can trigger a review request when automated review is enabled.
  - Review pass moves a task to `done`; review fail moves it back to `in_progress` and stores feedback.
  - Tests cover enabled/disabled review mode plus pass/fail transitions.
- **Dependencies**: DISPATCH-023, DISPATCH-034, DISPATCH-035
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src-tauri/src/services/review_router.rs`
  - `src-tauri/tests/review_router_tests.rs`
  - `src/features/tasks/TaskDetailDrawer.tsx`

### DISPATCH-038 — Add Orchestrated Stream View and Review Handoff UI
- **Phase**: Phase 8 — Full Chat + Orchestrated Review Loop
- **Description**: Surface the clean stream view for orchestrated sessions and make review status/feedback visible where users inspect sessions and tasks.
- **Acceptance Criteria**:
  - Orchestrated sessions can toggle into a markdown stream view separate from terminal output.
  - Review outcome and feedback are visible from linked session/task surfaces.
  - Component tests cover stream rendering and review handoff states.
- **Dependencies**: DISPATCH-033, DISPATCH-036, DISPATCH-037
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src/features/agents/OrchestratedSessionView.tsx`
  - `src/features/chat/MessageList.tsx`
  - `src/features/tasks/TaskDetailDrawer.tsx`
  - `src/features/agents/__tests__/OpenClawStatus.test.tsx`
  - `scripts/smoke/phase-8-chat-review.sh`

### DISPATCH-039 — Build the Settings Shell, Connection Pane, and Projects Pane
- **Phase**: Phase 9 — System Integration + Polish
- **Description**: Implement the settings dialog shell and the foundational panes for OpenClaw connection management and project administration.
- **Acceptance Criteria**:
  - Settings dialog opens from the shell and preserves pane navigation while open.
  - Connection pane edits gateway settings and shows live connection status.
  - Projects pane can list, add, and remove projects through existing backend commands.
- **Dependencies**: DISPATCH-011, DISPATCH-032
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src/features/settings/SettingsDialog.tsx`
  - `src/features/settings/ConnectionSettings.tsx`
  - `src/features/settings/ProjectsPane.tsx`
  - `src/features/settings/__tests__/SettingsDialog.test.tsx`

### DISPATCH-040 — Build the Secrets Pane and Agent Registry Pane
- **Phase**: Phase 9 — System Integration + Polish
- **Description**: Add settings panes for secret-status management and agent profile editing so users can configure credentials and local agents without touching files.
- **Acceptance Criteria**:
  - Secrets pane shows `keychain | env | missing` status and supports set/clear flows without exposing raw stored values.
  - Agent registry pane can create, edit, and delete structured agent profiles.
  - Settings tests cover validation and successful persistence for both panes.
- **Dependencies**: DISPATCH-010, DISPATCH-016, DISPATCH-039
- **Estimated Hours**: 4
- **Priority**: P2
- **Key Files**:
  - `src/features/settings/SecretsPane.tsx`
  - `src/features/settings/AgentRegistryPane.tsx`
  - `src/features/settings/__tests__/SettingsDialog.test.tsx`

### DISPATCH-041 — Implement Notifications and System Tray Lifecycle
- **Phase**: Phase 9 — System Integration + Polish
- **Description**: Add desktop notifications and tray behavior so Dispatch can keep running in the background while surfacing task/review outcomes.
- **Acceptance Criteria**:
  - Notifications fire for task completed, task failed, and review complete events.
  - Closing the window hides to tray instead of terminating the app.
  - Tray menu exposes Show, New Terminal, and Quit, and tooltip reflects running session count.
- **Dependencies**: DISPATCH-038, DISPATCH-039
- **Estimated Hours**: 5
- **Priority**: P2
- **Key Files**:
  - `src-tauri/src/services/tray.rs`
  - `src-tauri/src/commands/window.rs`
  - `src-tauri/src/commands/notifications.rs`
  - `src/features/settings/SettingsDialog.tsx`
  - `scripts/smoke/phase-9-system.sh`

### DISPATCH-042 — Add the Command Palette and Global Hotkeys
- **Phase**: Phase 9 — System Integration + Polish
- **Description**: Implement keyboard-first control with a command palette and global shortcut registration for the highest-frequency Dispatch actions.
- **Acceptance Criteria**:
  - Command palette supports create task, new terminal, dispatch selected task, create manual save point, and open settings.
  - Global shortcut focuses or reveals Dispatch when the app is running.
  - Tests cover command registration/execution and prevent duplicate hotkey bindings.
- **Dependencies**: DISPATCH-019, DISPATCH-031, DISPATCH-039
- **Estimated Hours**: 4
- **Priority**: P2
- **Key Files**:
  - `src/shared/components/CommandPalette.tsx`
  - `src/shared/hooks/useAppHotkeys.ts`
  - `src/features/settings/SettingsDialog.tsx`

### DISPATCH-043 — Harden Performance and Cleanup Visibility
- **Phase**: Phase 9 — System Integration + Polish
- **Description**: Tighten lifecycle behavior across watchers, sessions, and tab surfaces while making logs and stale-state debugging visible from the UI.
- **Acceptance Criteria**:
  - Watchers and session subscriptions only run when their surfaces are active or required by user state.
  - Settings/About surface exposes session log paths and stale-session/debug info.
  - Error-boundary coverage exists for Chat, Tasks, Agents, Files, History, and Settings.
- **Dependencies**: DISPATCH-027, DISPATCH-031, DISPATCH-041, DISPATCH-042
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `src/features/settings/SettingsDialog.tsx`
  - `src/shared/components/ErrorBoundary.tsx`
  - `src/features/files/store/filesSlice.ts`
  - `src/features/agents/store/agentsSlice.ts`
  - `src-tauri/src/services/file_watch.rs`
  - `src-tauri/src/services/session_supervisor.rs`

### DISPATCH-044 — Finalize Release Packaging Configuration
- **Phase**: Phase 10 — Packaging + Release
- **Description**: Lock Tauri release configuration, versioning, and Linux packaging outputs so Dispatch can produce consistent `.AppImage` and `.deb` artifacts.
- **Acceptance Criteria**:
  - `tauri.conf.json` produces `.AppImage` and `.deb` outputs for version `0.1.0`.
  - Packaged builds can boot and answer the basic health path on a clean Linux environment.
  - Release smoke test exists for packaged artifact sanity.
- **Dependencies**: DISPATCH-043
- **Estimated Hours**: 4
- **Priority**: P1
- **Key Files**:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tests/release_smoke.rs`

### DISPATCH-045 — Add Release CI Workflow and Smoke Automation
- **Phase**: Phase 10 — Packaging + Release
- **Description**: Build the release CI workflow that runs tests, packages Linux artifacts, and blocks publication on smoke or packaging failures.
- **Acceptance Criteria**:
  - GitHub Actions runs Rust tests, frontend tests, release build, and smoke scripts in one workflow.
  - Workflow uploads `.AppImage` and `.deb` artifacts on release/tag execution.
  - Packaging or smoke failures stop artifact publication.
- **Dependencies**: DISPATCH-044
- **Estimated Hours**: 5
- **Priority**: P1
- **Key Files**:
  - `.github/workflows/release.yml`
  - `scripts/smoke/phase-10-release.sh`
  - `src-tauri/tests/release_smoke.rs`

### DISPATCH-046 — Write Release Docs, Metrics Checklist, and Install Guide
- **Phase**: Phase 10 — Packaging + Release
- **Description**: Document how to build, install, validate, and ship Dispatch, including startup and latency targets needed for release decisions.
- **Acceptance Criteria**:
  - `README.md` documents prerequisites, install steps, and standalone vs OpenClaw modes.
  - Release checklist covers startup time, idle memory, terminal spawn latency, and save-point latency targets.
  - Docs reference the release smoke script and the repeatable cut process.
- **Dependencies**: DISPATCH-045
- **Estimated Hours**: 3
- **Priority**: P2
- **Key Files**:
  - `README.md`
  - `scripts/smoke/phase-10-release.sh`

### DISPATCH-047 — Add the Experimental Browser Flag and Localhost Policy
- **Phase**: Phase 11 — Browser Experimental (Post-v1 Only)
- **Description**: Define the feature flag and enforcement rules for a deliberately narrow localhost-only browser preview that stays outside the v1 release path.
- **Acceptance Criteria**:
  - Browser feature is disabled by default and clearly labeled experimental/post-v1.
  - Allowed targets are limited to `http://localhost:*` and `http://127.0.0.1:*`.
  - External browsing, DevTools embedding, and separate multi-webview management remain out of scope.
- **Dependencies**: DISPATCH-046
- **Estimated Hours**: 3
- **Priority**: P3
- **Key Files**:
  - `src/features/browser/store/browserSlice.ts`
  - `src/app/TabHost.tsx`
  - `docs/checklists/v1-scope.md`

### DISPATCH-048 — Build the Experimental Browser Preview UI
- **Phase**: Phase 11 — Browser Experimental (Post-v1 Only)
- **Description**: Implement the constrained Browser tab UI with address validation, iframe preview, and smoke coverage under the experimental feature flag.
- **Acceptance Criteria**:
  - When enabled, the Browser tab can load an allowed localhost URL in an iframe preview.
  - Address bar validation rejects non-localhost targets with clear user feedback.
  - Component and smoke tests cover enabled mode, basic navigation, and blocked targets.
- **Dependencies**: DISPATCH-047
- **Estimated Hours**: 6
- **Priority**: P3
- **Key Files**:
  - `src/features/browser/BrowserTab.tsx`
  - `src/features/browser/AddressBar.tsx`
  - `src/features/browser/store/browserSlice.ts`
  - `src/features/browser/__tests__/BrowserTab.test.tsx`
  - `scripts/smoke/phase-11-browser.sh`
