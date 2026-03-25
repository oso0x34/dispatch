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

## Current Host Verification Status

- As of 2026-03-20 05:17:53 CDT, the Linux Rust/Tauri host-prerequisite gap described in older handoff notes is resolved on this machine.
- Verified via `pkg-config` for `gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, `atk`, `libsoup-3.0`, `javascriptcoregtk-4.1`, and `webkit2gtk-4.1`.
- Verified by passing `cargo test --manifest-path src-tauri/Cargo.toml --test app_boot_smoke`, `cargo test --manifest-path src-tauri/Cargo.toml --test db_schema_smoke`, `cargo test --manifest-path src-tauri/Cargo.toml --test projects_db_tests --test path_guard_tests`, `cargo test --manifest-path src-tauri/Cargo.toml --test settings_secret_tests`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- Historical `PASS_WITH_HOST_GAP` and related command summaries below should be read as point-in-time results from 2026-03-19, not current host state.

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

- 2026-03-20 06:00:40 PM CDT — `implementer -> DISPATCH-048`
  Status: PASS
  Summary: DISPATCH-048 is complete. The experimental browser lane now has a real iframe-backed preview surface in `src/features/browser/BrowserTab.tsx`, with `src/features/browser/AddressBar.tsx` handling address submission and error display. The browser slice already owns the constrained localhost-only navigation contract, and the tab host now routes the Browser panel into the real component when the experimental flag is enabled. Browser UI tests cover the enabled surface, a successful localhost navigation, and a blocked external target with clear feedback, and the new Phase 11 smoke script runs the browser component suite plus the frontend build.
  AC coverage: AC1 PASS. Enabled browser mode can load an allowed localhost URL into the iframe preview. AC2 PASS. Blocked targets are rejected through the address bar and surfaced to the user as a clear validation message. AC3 PASS. Component coverage and the phase-11 smoke script exercise enabled mode, basic navigation, and blocked-target rejection.
  Command summary: `npm test -- src/features/browser/__tests__/BrowserTab.test.tsx src/features/browser/store/browserSlice.test.ts src/shared/components/__tests__/TabBar.test.tsx src/app/__tests__/TabHost.test.tsx` PASS. `bash scripts/smoke/phase-11-browser.sh` PASS. `npm test` PASS. `npm run build` PASS.
  Residual risk: the localhost preflight now proves the target accepted a network request before the iframe loads, but it still cannot guarantee that the target renders meaningful UI once embedded.
  Next skill must read: `src/features/browser/BrowserTab.tsx`, `src/features/browser/AddressBar.tsx`, `src/features/browser/store/browserSlice.ts`, `src/features/browser/__tests__/BrowserTab.test.tsx`, `scripts/smoke/phase-11-browser.sh`, `src/app/TabHost.tsx`, `TICKETS.md`.

- 2026-03-20 05:56:45 PM CDT — `implementer -> DISPATCH-047`
  Status: PASS
  Summary: DISPATCH-047 is complete. `src/features/browser/store/browserSlice.ts` now introduces the post-v1 browser policy layer with a default-off experimental flag plus typed validation that only allows `http://localhost:*` and `http://127.0.0.1:*` preview targets. The shell now knows about the browser lane without turning it into a real feature prematurely: `src/store/index.ts` wires the new slice into the app store, `src/store/uiSlice.ts` registers a `Browser (Experimental)` panel id, `src/shared/components/TabBar.tsx` hides the tab while the flag is off and labels it as post-v1 when enabled, and `src/app/TabHost.tsx` renders a policy placeholder instead of a real browser surface. `docs/checklists/v1-scope.md` now also states the localhost-only and default-off constraints explicitly so the browser lane stays outside v1 by contract.
  AC coverage: AC1 PASS. The browser lane is off by default in the shared store and clearly labeled experimental/post-v1 when surfaced. AC2 PASS. The shared validator only accepts `http://localhost:*` and `http://127.0.0.1:*` targets and rejects external or non-HTTP URLs with typed reasons. AC3 PASS. No real browsing surface, DevTools embedding, or multi-webview management was added; the shell only exposes a placeholder and policy groundwork.
  Command summary: `npm test -- src/features/browser/store/browserSlice.test.ts src/shared/components/__tests__/TabBar.test.tsx src/app/__tests__/TabHost.test.tsx` PASS. `npm run build` PASS.
  Residual risk: the experimental browser flag is still an in-memory UI toggle rather than a persisted setting, which is acceptable for this policy-only groundwork but will need to be revisited if DISPATCH-048 expects a user-facing enablement flow.
  Next skill must read: `src/features/browser/store/browserSlice.ts`, `src/store/uiSlice.ts`, `src/shared/components/TabBar.tsx`, `src/app/TabHost.tsx`, `src/features/browser/store/browserSlice.test.ts`, `src/shared/components/__tests__/TabBar.test.tsx`, `docs/checklists/v1-scope.md`, `TICKETS.md`.

- 2026-03-20 05:51:50 PM CDT — `implementer -> DISPATCH-047`
  Status: PASS
  Summary: DISPATCH-046 is complete. A new root `README.md` now documents what Dispatch ships today, the difference between standalone and OpenClaw-connected operation, Linux source-build prerequisites, local development and packaging commands, packaged `.AppImage` and `.deb` install steps, the Phase 10 release smoke path, and a repeatable release cut process that matches the new CI workflow. The README also makes the release-decision bar explicit by documenting startup, idle-memory, terminal-spawn, and save-point latency targets, while calling out that the current automated release gate is still `.github/workflows/release.yml` plus `scripts/smoke/phase-10-release.sh` rather than automated performance measurement, and that `workflow_dispatch` is validation-only while artifact publication stays tag-driven.
  AC coverage: AC1 PASS. `README.md` now covers prerequisites, packaged install steps, and the standalone vs OpenClaw operating modes that exist in the app today. AC2 PASS. The release checklist in `README.md` now sets explicit targets for startup time, idle memory, terminal spawn latency, and save-point latency. AC3 PASS. The docs reference `scripts/smoke/phase-10-release.sh`, the release workflow, and a repeatable tag-driven cut process.
  Command summary: `bash scripts/smoke/phase-10-release.sh` PASS. `cargo test --locked --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. Documentation spot-check: `README.md` references current repo files and commands only.
  Residual risk: the performance targets are documented release bars, not instrumented benchmarks yet, so the final human release check still needs a clean Linux box for cold-start and install validation.
  Next skill must read: `README.md`, `.github/workflows/release.yml`, `scripts/smoke/phase-10-release.sh`, `TICKETS.md`.

- 2026-03-20 05:48:35 PM CDT — `implementer -> DISPATCH-046`
  Status: PASS
  Summary: DISPATCH-045 is complete. `.github/workflows/release.yml` now defines a single Linux release workflow for tag or manual validation execution, installs the Tauri Linux packaging prerequisites on `ubuntu-22.04`, runs `npm ci`, the full Rust suite, the full frontend suite, and then `bash scripts/smoke/phase-10-release.sh` before any artifact upload. `scripts/smoke/phase-10-release.sh` now owns the release gate: it verifies `src-tauri/tests/release_smoke.rs`, clears stale bundle output, performs a real `npx tauri build --bundles appimage,deb --ci`, reruns `release_smoke` with `DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1`, and lists the emitted bundle files so packaging or smoke failures stop artifact publication before `actions/upload-artifact@v4` runs.
  AC coverage: AC1 PASS. The GitHub Actions workflow runs Rust tests, frontend tests, and the Phase 10 release smoke in one job. AC2 PASS. Successful tag-triggered workflow completion uploads the real `.AppImage` and `.deb` outputs from `target/release/bundle/appimage/*.AppImage` and `target/release/bundle/deb/*.deb`, while `workflow_dispatch` remains a validation-only path. AC3 PASS. Artifact upload steps are ordered after the smoke gate, so any failing test, packaging step, or artifact-required smoke assertion stops publication.
  Command summary: `bash -n scripts/smoke/phase-10-release.sh` PASS. `bash scripts/smoke/phase-10-release.sh` PASS. `cargo test --locked --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS.
  Residual risk: the workflow assumes GitHub's `ubuntu-22.04` runner continues to provide both `libappindicator3-dev` and `libayatana-appindicator3-dev`; if runner package availability shifts, the install step may need adjustment even though the repo-side smoke and bundle contract are correct.
  Next skill must read: `README.md`, `scripts/smoke/phase-10-release.sh`, `.github/workflows/release.yml`, `src-tauri/tests/release_smoke.rs`, `src-tauri/tauri.conf.json`, `TICKETS.md`.

- 2026-03-20 05:40:44 PM CDT — `implementer -> DISPATCH-045`
  Status: PASS
  Summary: DISPATCH-044 is now fully closed. The previously missing Linux appindicator development chain was installed on the host, and the repo-side packaging work already in place was reverified end to end: `src-tauri/tauri.conf.json` produces Linux `appimage` and `deb` bundles for version `0.1.0`, and `src-tauri/tests/release_smoke.rs` now passes in strict artifact-required mode against the actual packaged outputs. The real `npx tauri build --bundles appimage,deb --ci` run completed successfully and emitted `/home/oso0x/projects/dispatch/target/release/bundle/appimage/Dispatch_0.1.0_amd64.AppImage` plus `/home/oso0x/projects/dispatch/target/release/bundle/deb/Dispatch_0.1.0_amd64.deb`.
  AC coverage: AC1 PASS. `src-tauri/tauri.conf.json` builds versioned `.AppImage` and `.deb` outputs for `0.1.0`, and the actual bundle run produced both artifacts. AC2 PASS_WITH_HOST_ASSUMPTION. Real packaged artifacts were created successfully on Linux and the artifact-required smoke gate passed, which is strong evidence that the packaged builds can boot on a clean Linux environment once matching runtime prerequisites are installed; this ticket still does not add a separate out-of-process boot harness beyond successful Tauri bundling and artifact validation. AC3 PASS. `src-tauri/tests/release_smoke.rs` exists, verifies release config sanity, and now also passed with `DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1` against the generated bundles.
  Command summary: `pkg-config --modversion ayatana-appindicator3-0.1` PASS (`0.5.90`). `pkg-config --modversion ayatana-indicator3-0.4` PASS (`0.9.4`). `pkg-config --modversion dbusmenu-glib-0.4` PASS (`16.04.0`). `npx tauri build --bundles appimage,deb --ci` PASS. `DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1 cargo test --manifest-path src-tauri/Cargo.toml --test release_smoke` PASS.
  Residual risk: the packaging lane now depends on the Linux build host having the same appindicator/pkg-config prerequisites available in CI, so DISPATCH-045 must install those packages explicitly before attempting artifact publication.
  Next skill must read: `.github/workflows/release.yml`, `scripts/smoke/phase-10-release.sh`, `src-tauri/tests/release_smoke.rs`, `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `TICKETS.md`.

- 2026-03-20 05:06:21 PM CDT — `implementer -> DISPATCH-044`
  Status: BLOCKED
  Summary: DISPATCH-044 is partially implemented but blocked at real Linux bundle generation. The repo-side release packaging contract is now in place: `src-tauri/tauri.conf.json` enables bundling, locks targets to `appimage` and `deb`, and pins the shipping icon, while `src-tauri/tests/release_smoke.rs` now verifies the config contract and can optionally require real `.AppImage` and `.deb` artifacts after a package build. However, the actual `npx tauri build --bundles appimage,deb --ci` run on this host aborts after producing the optimized binary with `Can't detect any appindicator library`, and no `target/release/bundle` artifacts are emitted. Investigation showed the runtime library exists (`libayatana-appindicator3.so.1` is present), but the host is missing the pkg-config/development metadata the Tauri Linux bundler expects: `pkg-config --modversion appindicator3-0.1` and `pkg-config --modversion ayatana-appindicator3-0.1` both fail, `find /usr -name '*appindicator*.pc' -o -name '*ayatana*.pc'` finds no `.pc` files, and `apt-cache depends libayatana-appindicator3-dev` shows the missing dev chain (`libayatana-appindicator3-dev`, `libayatana-indicator3-dev`, `libdbusmenu-glib-dev`). I could not install those packages because `sudo` on this host requires an interactive password.
  AC coverage: AC1 PASS. `src-tauri/tauri.conf.json` now declares version `0.1.0`, `bundle.active: true`, and Linux bundle targets `appimage` plus `deb`. AC2 BLOCKED. A real bundled build was attempted with `npx tauri build --bundles appimage,deb --ci`, but the Tauri CLI aborted on missing appindicator pkg-config metadata before any Linux artifacts were produced, so packaged boot/health validation could not proceed. AC3 PASS_WITH_HOST_GAP. `src-tauri/tests/release_smoke.rs` exists and validates the release config plus artifact sanity when bundles are present, but the artifact-required gate still fails on this host because the bundler never emits `target/release/bundle`.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test release_smoke` PASS. `npx tauri build --bundles appimage,deb --ci` BLOCKED after building `/home/oso0x/projects/dispatch/target/release/dispatch` with `Can't detect any appindicator library`. `DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1 cargo test --manifest-path src-tauri/Cargo.toml --test release_smoke` FAIL as expected because `/home/oso0x/projects/dispatch/target/release/bundle` was never created. Host evidence: `pkg-config --modversion appindicator3-0.1` FAIL. `pkg-config --modversion ayatana-appindicator3-0.1` FAIL. `ldconfig -p | rg 'appindicator|ayatana'` shows the runtime library is present. `sudo apt-get install -y libayatana-appindicator3-dev` could not proceed because `sudo` requires an interactive password on this machine.
  Residual risk: until the appindicator development/pkg-config packages are installed on the packaging host, Linux bundle generation is not reproducible even though the repo config and smoke gate are ready. Once that host prerequisite is resolved, rerun `npx tauri build --bundles appimage,deb --ci` and then `DISPATCH_REQUIRE_RELEASE_ARTIFACTS=1 cargo test --manifest-path src-tauri/Cargo.toml --test release_smoke` before advancing to DISPATCH-045.
  Next skill must read: `src-tauri/tauri.conf.json`, `src-tauri/tests/release_smoke.rs`, `package.json`, `src-tauri/Cargo.toml`, `TICKETS.md`.

- 2026-03-20 04:59:35 PM CDT — `implementer -> DISPATCH-044`
  Status: PASS
  Summary: Implemented DISPATCH-043 by tightening active-surface lifecycle behavior across the mounted shell tabs and surfacing boot/runtime diagnostics in Settings. `src/app/TabHost.tsx` now passes explicit active state into the heavy Agents, Files, and Chat surfaces instead of relying on hidden-but-mounted panels to keep background effects alive. `src/features/files/FilesTab.tsx` now starts its project watcher and refresh-event subscription only while the Files surface is active, `src/features/chat/ChatTab.tsx` only polls the OpenClaw transcript snapshot while Chat is active, and `src/features/agents/TerminalPanel.tsx` plus `src/features/agents/OrchestratedSessionView.tsx` now attach a single selected terminal viewport and gate terminal/transcript transport work on active visibility instead of keeping hidden sockets and transcript polling alive. On the Tauri side, `src-tauri/src/app_state.rs`, `src-tauri/src/commands/health.rs`, `src-tauri/src/logging.rs`, and `src-tauri/src/lib.rs` now persist boot diagnostics into managed app state so `src/features/settings/SettingsDialog.tsx` can expose an About pane with the log directory, active log file, session-log directory, boot timestamp, and stale-session cleanup count without inventing frontend-only state.
  AC coverage: AC1 PASS. Watchers and session subscriptions now only run while their surfaces are active: Files watchers/listeners are paused when hidden, Chat snapshot polling is gated on active chat visibility, and Agents now attaches only the selected terminal session while transcript polling is gated by both active tab state and transcript mode. AC2 PASS. Settings now exposes an About pane with boot/runtime diagnostics, including log paths, session log directory, and the stale-session count recorded during boot recovery. AC3 PASS. Error-boundary coverage remains in place for Chat, Tasks, Agents, Files, History, and Settings, and the new tests prove the active-surface lifecycle wiring without removing the existing boundary surfaces.
  Command summary: `npm test -- src/features/files/__tests__/FilesTab.test.tsx src/features/chat/__tests__/ChatTab.test.tsx src/features/settings/__tests__/SettingsDialog.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx src/features/agents/__tests__/OrchestratedSessionView.test.tsx src/app/__tests__/AppSettingsOverlay.test.tsx src/app/__tests__/AppCommandPalette.test.tsx src/app/__tests__/TabHost.test.tsx` PASS with the existing canvas/JSDOM notice only. `cargo test --manifest-path src-tauri/Cargo.toml --test app_boot_smoke` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS with the existing canvas/JSDOM notice only. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: hidden tabs now intentionally stop live transport work, so session/chat/sidebar freshness is restored when the user returns to those surfaces rather than being streamed continuously in the background. That matches the ticket, but release packaging and final system polish should still sanity-check the tab-switch behavior in a real desktop session.
  Next skill must read: `src/app/TabHost.tsx`, `src/features/agents/AgentsTab.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/agents/OrchestratedSessionView.tsx`, `src/features/files/FilesTab.tsx`, `src/features/chat/ChatTab.tsx`, `src/features/settings/SettingsDialog.tsx`, `src/shared/lib/tauri.ts`, `src-tauri/src/app_state.rs`, `src-tauri/src/commands/health.rs`, `src-tauri/src/logging.rs`, `src-tauri/src/lib.rs`, `src/features/agents/__tests__/TerminalPanel.test.tsx`, `src/features/agents/__tests__/OrchestratedSessionView.test.tsx`, `src/features/files/__tests__/FilesTab.test.tsx`, `src/features/chat/__tests__/ChatTab.test.tsx`, `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src-tauri/tests/app_boot_smoke.rs`, `src-tauri/tauri.conf.json`, `src-tauri/tests/release_smoke.rs`, `TICKETS.md`.

- 2026-03-20 04:46:41 PM CDT — `implementer -> DISPATCH-043`
  Status: PASS
  Summary: Implemented DISPATCH-042 by adding the new keyboard-first control surface in `src/shared/components/CommandPalette.tsx`, the global/local hotkey orchestration in `src/shared/hooks/useAppHotkeys.ts`, and the frontend bridge/window helpers in `src/shared/lib/tauri.ts`. The shell now mounts the palette from `src/app/App.tsx`, exposes a visible trigger in `src/shared/components/TopBar.tsx`, and extends the UI slice in `src/store/uiSlice.ts` so overlays and the palette do not fight for ownership. The palette supports create task, new terminal, dispatch selected task, create manual save point, and open settings, reusing the existing task/agent/history flows while passing typed payloads through the current store. The hotkey layer now toggles the palette on `CommandOrControl+K`, registers a singleton `CommandOrControl+Shift+D` reveal shortcut through the Tauri global-shortcut plugin, and uses a leased registration/cleanup path so React `StrictMode` remounts do not double-bind the OS shortcut. Coverage landed in `src/app/__tests__/AppCommandPalette.test.tsx` and `src/shared/hooks/useAppHotkeys.test.tsx`, which prove command execution, local palette toggling, global registration dedupe, and reveal-handler behavior.
  AC coverage: AC1 PASS. The command palette now supports create task, new terminal, dispatch selected task, create manual save point, and open settings through the real app shell. AC2 PASS. The global reveal shortcut registers on desktop startup and routes through `show_main_window`, which focuses or reveals Dispatch while the app is already running. AC3 PASS. New frontend coverage proves palette command execution plus duplicate-safe global shortcut registration under `StrictMode`.
  Command summary: `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test -- src/shared/hooks/useAppHotkeys.test.tsx src/app/__tests__/AppCommandPalette.test.tsx` PASS. `npm test` PASS with the existing canvas/JSDOM notice only. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: the global reveal shortcut is currently fixed to `CommandOrControl+Shift+D` and is not yet user-configurable, and the command-palette tests mock the Agents/Tasks heavy surfaces so xterm/canvas behavior remains covered by the existing Agents test lane rather than these new command-focused specs.
  Next skill must read: `src/shared/components/CommandPalette.tsx`, `src/shared/hooks/useAppHotkeys.ts`, `src/store/uiSlice.ts`, `src/shared/lib/tauri.ts`, `src/shared/components/TopBar.tsx`, `src/app/App.tsx`, `src/app/__tests__/AppCommandPalette.test.tsx`, `src/shared/hooks/useAppHotkeys.test.tsx`, `src/features/settings/SettingsDialog.tsx`, `src/features/files/store/filesSlice.ts`, `src/features/agents/store/agentsSlice.ts`, `src-tauri/src/services/file_watch.rs`, `src-tauri/src/services/pty_manager.rs`, `src/shared/components/ErrorBoundary.tsx`, `TICKETS.md`.

- 2026-03-20 04:27:41 PM CDT — `implementer -> DISPATCH-042`
  Status: PASS
  Summary: Implemented DISPATCH-041 by wiring desktop notifications and tray lifecycle behavior through `src-tauri/src/services/tray.rs`, `src-tauri/src/commands/window.rs`, `src-tauri/src/commands/notifications.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/services/openclaw/dispatch_bridge.rs`, `src-tauri/src/services/dispatch.rs`, `src-tauri/src/services/pty_manager.rs`, and `src-tauri/src/lib.rs`. The app now registers the notification plugin and tray service at startup, intercepts main-window close requests so the app hides instead of terminating, exposes Show/Hide/Visible commands over IPC, and keeps the tray tooltip synchronized with the live `agent_sessions` running count across PTY creation, PTY completion/cancel, OpenClaw session dispatch, OpenClaw sidebar sync, and OpenClaw cancellation. Notification semantics were corrected so task failures fire when linked task execution actually fails, review completion fires when automated review returns PASS or FAIL, and task completed only fires on review pass when the task truly reaches `done` instead of the earlier `review` transition. The OpenClaw bridge now normalizes gateway session states before syncing linked tasks, returns typed task-transition results so one-shot failure notifications only fire on real state changes, and the new `scripts/smoke/phase-9-system.sh` plus `src-tauri/tests/system_tray_smoke.rs` extend the Phase 9 verification lane with tray/window command coverage, review/task lifecycle coverage, and production-build checks.
  AC coverage: AC1 PASS. Notifications now fire for task failed events from both PTY-backed direct dispatch and normalized OpenClaw-linked task failures, review complete events from automated review routing, and task completed only when review pass moves the task to `done`. AC2 PASS. The main-window close handler is registered at app bootstrap and hides the main window instead of terminating the app when the user closes Dispatch normally. AC3 PASS. The tray service builds Show/New Terminal/Quit menu items, the New Terminal action still opens a shell against the active project, and tooltip refresh now tracks the real running-session count across terminal and OpenClaw lifecycle edges.
  Command summary: `cargo check --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test review_router_tests --test task_transition_tests --test terminal_commands_smoke` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test system_tray_smoke` PASS. `bash scripts/smoke/phase-9-system.sh` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS with the existing canvas/JSDOM notice only. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: Tauri's `MockRuntime` does not model GTK tray creation or real OS window visibility transitions, so the automated Rust coverage proves command wiring, lifecycle state transitions, tooltip/notification helpers, and build integrity, while the actual close-to-tray and tray-menu UX remains code-reviewed rather than fully simulated in headless tests.
  Next skill must read: `src-tauri/src/services/tray.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/services/dispatch.rs`, `src-tauri/src/services/openclaw/dispatch_bridge.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/commands/window.rs`, `src-tauri/src/commands/notifications.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/system_tray_smoke.rs`, `scripts/smoke/phase-9-system.sh`, `src/features/settings/SettingsDialog.tsx`, `src/shared/components/TopBar.tsx`, `src/shared/lib/tauri.ts`, `TICKETS.md`.

- 2026-03-20 03:40:34 PM CDT — `implementer -> DISPATCH-041`
  Status: PASS
  Summary: Implemented DISPATCH-040 by extending the live settings shell with real Secrets and Agent registry panes in `src/features/settings/SecretsPane.tsx`, `src/features/settings/AgentRegistryPane.tsx`, and `src/features/settings/SettingsDialog.tsx`. The frontend bridge in `src/shared/lib/tauri.ts` now exposes typed secret-status commands and full agent-profile CRUD contracts so the settings surface can work entirely through structured IPC. The secrets pane surfaces write-only set/clear flows for `OPENCLAW_GATEWAY_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`, while only ever rendering Rust-reported `keychain | env | missing` state and clearing the local input after successful writes. The agent registry pane now manages explicit local profiles with structured args and env-source metadata, supports create/edit/delete flows, and keeps the `Auto` route visible as a pinned runtime concept rather than an editable profile. Final settings coverage lives in `src/features/settings/__tests__/SettingsDialog.test.tsx`, which now exercises secret set/clear, agent-profile validation, and agent-profile create/update/delete through the real settings shell.
  AC coverage: AC1 PASS. The new secrets pane reports `keychain`, `env`, and `missing` state through the existing Rust secret commands and supports write-only set/clear flows without exposing stored secret values back to the frontend. AC2 PASS. The agent registry pane can create, edit, and delete structured local agent profiles using the existing Rust-backed profile commands and typed profile contracts. AC3 PASS. The settings shell tests now cover successful secret persistence/clear flows, profile validation surfacing, profile create/update/delete, and the widened shell integration path.
  Command summary: `npx vitest run src/features/settings/__tests__/SettingsDialog.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test settings_secret_tests` PASS. `npm test` PASS. `npm run build` PASS with the existing canvas/JSDOM notice in tests and the existing Vite large-chunk warning only.
  Residual risk: the secrets pane currently ships with a fixed credential catalog rather than a user-extensible registry, so additional provider keys still require code changes until a later settings ticket introduces configurable secret definitions.
  Next skill must read: `src/features/settings/SecretsPane.tsx`, `src/features/settings/AgentRegistryPane.tsx`, `src/features/settings/SettingsDialog.tsx`, `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src/shared/lib/tauri.ts`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `package.json`, `TICKETS.md`.

- 2026-03-20 03:24:06 PM CDT — `implementer -> DISPATCH-040`
  Status: PASS
  Summary: Implemented DISPATCH-039 by replacing the placeholder settings surface with a real overlay shell in `src/features/settings/SettingsDialog.tsx`, then wiring the shell into `src/app/App.tsx` so settings now mount from the main overlay instead of the lazy tab host. The new `src/features/settings/ConnectionSettings.tsx` persists the OpenClaw gateway URL through existing settings IPC, exposes connect/disconnect/refresh controls, and polls live connection state while its pane is active. The new `src/features/settings/ProjectsPane.tsx` reuses the existing project slice and add-project dialog to list projects, set the active workspace, and remove entries from the registry. Focus trapping in `src/app/App.tsx` now filters hidden controls by computed visibility instead of layout rectangles so pane-local state can stay mounted without leaking hidden tabbables, and the new settings tests in `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src/app/__tests__/AppSettingsOverlay.test.tsx`, and `src/features/settings/__tests__/ConnectionSettings.test.tsx` cover pane persistence, visible-pane focus behavior, and transient polling error recovery.
  AC coverage: AC1 PASS. Settings opens from the shell overlay, keeps pane-local component state mounted while the overlay remains open, and preserves edits when switching between Connection and Projects. AC2 PASS. Connection settings now read and persist `openclaw.gateway_url`, expose connect/disconnect/refresh actions over the existing backend commands, and show live connection state with background refresh while the pane is active. AC3 PASS. Projects settings now list registered projects, launch the existing add-project flow, support remove and make-active actions through the established project backend commands, and are covered by component tests.
  Command summary: `npx vitest run src/app/__tests__/AppSettingsOverlay.test.tsx src/features/settings/__tests__/ConnectionSettings.test.tsx src/features/settings/__tests__/SettingsDialog.test.tsx` PASS. `npm test` PASS. `npm run build` PASS with the existing canvas/JSDOM notice in tests and the existing Vite large-chunk warning only.
  Residual risk: the settings shell still has only the Connection and Projects panes; the remaining Phase 9 settings work for secrets, agent registry editing, notifications, and shortcuts is intentionally deferred to the next tickets rather than hidden behind placeholder copy.
  Next skill must read: `src/app/App.tsx`, `src/features/settings/SettingsDialog.tsx`, `src/features/settings/ConnectionSettings.tsx`, `src/features/settings/ProjectsPane.tsx`, `src/features/settings/__tests__/SettingsDialog.test.tsx`, `src/app/__tests__/AppSettingsOverlay.test.tsx`, `src/features/settings/__tests__/ConnectionSettings.test.tsx`, `src/features/settings/AgentRegistryPane.tsx`, `src-tauri/src/commands/settings.rs`, `src-tauri/src/commands/agent_profiles.rs`, `src/shared/lib/tauri.ts`, `TICKETS.md`.

- 2026-03-20 03:11:31 PM CDT — `implementer -> DISPATCH-039`
  Status: PASS
  Summary: Implemented DISPATCH-038 by replacing the placeholder `src/features/agents/OrchestratedSessionView.tsx` with a real two-mode orchestrated session surface that can toggle between overview and a session-scoped markdown transcript fetched through `get_openclaw_chat_snapshot`. The shared markdown renderer in `src/features/chat/MessageList.tsx` now supports lightweight copy/empty-state overrides so the orchestrated stream view can reuse the same chat presentation instead of duplicating markdown/rendering logic. `src/features/agents/TerminalPanel.tsx` now threads linked task context into orchestrated sessions, and `src/features/tasks/TaskDetailDrawer.tsx` surfaces a read-only review handoff summary that tracks the current draft review notes while keeping linked-session metadata visible. The new parser helper in `src/features/tasks/reviewSummary.ts` normalizes persisted automated review blocks, `src/features/agents/__tests__/OrchestratedSessionView.test.tsx` covers transcript rendering plus linked review feedback, `src/features/tasks/__tests__/TaskDetailDrawer.test.tsx` now covers persisted and live-edit review handoff states, and `scripts/smoke/phase-8-chat-review.sh` provides the Phase 8 chat/review verification entry point.
  AC coverage: AC1 PASS. Orchestrated sessions now expose an explicit Overview/Transcript toggle, and Transcript mode renders the cached OpenClaw markdown stream separately from terminal output by polling `get_openclaw_chat_snapshot` for the selected session key. AC2 PASS. Linked task review outcome and feedback are visible from both the orchestrated session surface and the task drawer, including live draft updates while users edit review notes. AC3 PASS. Focused component coverage now exercises transcript rendering, linked review handoff badges/feedback, and the draft-vs-summary path in the task drawer; the new Phase 8 smoke script also exercises the frontend and Rust chat/review path together.
  Command summary: `npx vitest run src/features/agents/__tests__/OrchestratedSessionView.test.tsx src/features/tasks/__tests__/TaskDetailDrawer.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx src/features/chat/__tests__/ChatTab.test.tsx` PASS. `npm test` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `bash scripts/smoke/phase-8-chat-review.sh` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: the orchestrated transcript view is still timer-polled against the chat cache rather than subscribing to push updates from the frontend, so transcript freshness is near-real-time rather than event-driven; if the Phase 9 system work introduces background session surfaces, this polling behavior should be revisited.
  Next skill must read: `src/features/agents/OrchestratedSessionView.tsx`, `src/features/chat/MessageList.tsx`, `src/features/tasks/TaskDetailDrawer.tsx`, `src/features/tasks/reviewSummary.ts`, `src/features/agents/__tests__/OrchestratedSessionView.test.tsx`, `src/features/tasks/__tests__/TaskDetailDrawer.test.tsx`, `scripts/smoke/phase-8-chat-review.sh`, `src/features/settings/SettingsPlaceholder.tsx`, `src/app/App.tsx`, `src/shared/components/TopBar.tsx`, `src/shared/components/TabBar.tsx`, `src/shared/lib/tauri.ts`, `TICKETS.md`.

- 2026-03-20 02:57:54 PM CDT — `implementer -> DISPATCH-038`
  Status: PASS
  Summary: Implemented DISPATCH-037 by adding the automated review router in `src-tauri/src/services/review_router.rs`, wiring the global enable/disable toggle into `src/features/tasks/TaskDetailDrawer.tsx`, and connecting review routing to OpenClaw sidebar reconciliation through `src-tauri/src/commands/openclaw.rs`. The app now manages `ReviewRouterService` in `src-tauri/src/lib.rs`, `src-tauri/src/services/pty_manager.rs` can queue review-routing work for successful terminal sessions, and the isolated/router-plus-OpenClaw coverage was expanded in `src-tauri/tests/review_router_tests.rs`, `src-tauri/tests/openclaw_client_tests.rs`, and `src/features/tasks/__tests__/TaskDetailDrawer.test.tsx`. Follow-up cleanup from verification also tightened `apply_review_decision` so zero-row updates fail loudly, normalized the review-notes rendering contract to `RESULT`/`FEEDBACK`, and made the PTY supervision test wait for async registry cleanup in `src-tauri/tests/pty_manager_tests.rs`.
  AC coverage: AC1 PASS. Successful OpenClaw session snapshots now trigger review routing when `dispatch.review.auto_enabled` is true, and the task drawer exposes that global toggle through the existing settings store. AC2 PASS. Review PASS moves the linked task to `done`, review FAIL moves it back to `in_progress`, both append automated feedback into `review_notes_markdown`, and the markdown export is resynced after the decision is applied. AC3 PASS. Rust coverage now includes disabled/pass/fail router behavior plus the OpenClaw sidebar-triggered handoff, and the frontend test coverage proves the automation toggle loads and saves through IPC.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test review_router_tests --test task_transition_tests --test openclaw_client_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: the direct-dispatch PTY success path is queued for automated review in `src-tauri/src/services/pty_manager.rs`, but the current deterministic end-to-end coverage is still concentrated on the router service itself plus the OpenClaw snapshot-triggered path; if Phase 8 UI work leans on local-session review handoff, that path should get a stronger integration harness.
  Next skill must read: `src-tauri/src/services/review_router.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/tests/review_router_tests.rs`, `src-tauri/tests/openclaw_client_tests.rs`, `src/features/tasks/TaskDetailDrawer.tsx`, `src/features/tasks/__tests__/TaskDetailDrawer.test.tsx`, `src/features/agents/OrchestratedSessionView.tsx`, `src/features/chat/MessageList.tsx`, `src/features/agents/__tests__/OpenClawStatus.test.tsx`, `scripts/smoke/phase-8-chat-review.sh`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 02:25:04 PM CDT — `implementer -> DISPATCH-037`
  Status: PASS
  Summary: Implemented DISPATCH-036 by replacing the Chat placeholder with a real `src/features/chat/ChatTab.tsx` surface, adding the new `src/features/chat/MessageList.tsx`, `src/features/chat/ChatInput.tsx`, and `src/features/chat/store/chatSlice.ts` chat state model, and covering the UI contract in `src/features/chat/__tests__/ChatTab.test.tsx`. The chat surface now polls `get_openclaw_chat_snapshot`, renders cached and streaming transcript rows with markdown plus syntax-highlighted code blocks, sends messages back through `send_openclaw_chat_message`, exposes a model override sourced from the agent registry, shows the active project context badge, and routes the quick action into the existing Tasks overlay. On the bridge/backend side, `src/shared/lib/tauri.ts` and `src-tauri/src/services/openclaw/chat.rs` now accept an optional `modelId` on outgoing chat sends and persist `conversationId`, `projectId`, and `modelId` into the cached user-message metadata, with `src-tauri/tests/chat_stream_tests.rs` covering that contract. `src/app/TabHost.tsx` now mounts the real Chat tab, and `src/app/__tests__/TabHost.test.tsx` was updated so the lazy-mount regression coverage follows the new chat entry point.
  AC coverage: AC1 PASS. `MessageList.tsx` renders markdown transcript rows through `react-markdown` + `remark-gfm` + `rehype-highlight`, preserves streamed assistant rows, and now autoscrolls on incremental message updates instead of only on new message counts. AC2 PASS. `ChatInput.tsx` shows the model selector and project-context badge, `ChatTab.tsx` threads the active project id plus selected model into `send_openclaw_chat_message`, and the backend now persists those metadata keys on cached user messages with a dedicated Rust regression test. AC3 PASS. Voice input remains absent from the v1 UI and is explicitly called out as post-v1 in the chat header/input copy and the focused component test.
  Command summary: `npm install react-markdown@10.1.0 remark-gfm@4.0.1 rehype-highlight@7.0.2 highlight.js@11.11.1` PASS. `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test chat_stream_tests` PASS. `npm test -- src/features/chat/__tests__/ChatTab.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: the Chat tab is still polling cached snapshots rather than subscribing to a frontend event stream, so streamed assistant text lands in near-real-time but not truly push-driven; real-gateway validation for richer chat metadata also remains outstanding.
  Next skill must read: `src/features/chat/ChatTab.tsx`, `src/features/chat/MessageList.tsx`, `src/features/chat/ChatInput.tsx`, `src/features/chat/store/chatSlice.ts`, `src/features/chat/__tests__/ChatTab.test.tsx`, `src/shared/lib/tauri.ts`, `src-tauri/src/services/openclaw/chat.rs`, `src-tauri/tests/chat_stream_tests.rs`, `src/features/tasks/TaskDetailDrawer.tsx`, `src-tauri/src/services/dispatch.rs`, `src-tauri/src/commands/tasks.rs`, `src-tauri/tests/task_transition_tests.rs`, `src-tauri/src/services/task_export.rs`, `src-tauri/tests/task_export_tests.rs`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 02:13:19 PM CDT — `implementer -> DISPATCH-036`
  Status: PASS
  Summary: Implemented DISPATCH-035 by landing the chat cache schema in `src-tauri/migrations/005_chat_cache.sql`, wiring the new `ChatMessage` model through `src-tauri/src/models/chat_message.rs`, and extending `src-tauri/src/db/migrate.rs` plus `src-tauri/tests/db_schema_smoke.rs` so fresh and migrated databases both understand `chat_messages`. `src-tauri/src/services/openclaw/chat.rs` now owns the Phase 8 backend: it persists cached chat rows, replays gateway history without duplicate rows, degrades to cached reads when `chat.subscribe` or `chat.history` fail, and binds the runtime database so streamed `chat` events are written through to SQLite as they arrive rather than waiting for a later poll. `src-tauri/src/services/openclaw/client.rs`, `src-tauri/src/services/openclaw/protocol.rs`, `src-tauri/src/services/openclaw/mod.rs`, `src-tauri/src/commands/openclaw.rs`, and `src-tauri/src/lib.rs` now expose the additional chat protocol methods, event fan-out, managed chat service state, and the new `get_openclaw_chat_snapshot` plus `send_openclaw_chat_message` Tauri commands. On the frontend bridge, `src/shared/lib/tauri.ts` now exposes typed chat snapshot/send contracts for the upcoming Chat tab work, and `src-tauri/tests/chat_stream_tests.rs` covers reconnect-safe replay, incremental stream upserts, degraded cache reads, and send-path resilience.
  AC coverage: AC1 PASS. The `chat_messages` migration is live as version 5, Rust commands now load cached chat snapshots and send cached chat messages through the new OpenClaw chat commands, and schema smoke coverage verifies the new table/index contract. AC2 PASS. The chat backend replays gateway history into SQLite on reconnect, upserts by stable message id to avoid duplicate cache rows, and degrades to cached reads plus direct `chat.send` when replay-specific methods fail. AC3 PASS. `chat_stream_tests.rs` now covers incremental assistant stream updates, reconnect history replay without duplicate rows, and the degraded cache/send path when `chat.subscribe` and `chat.history` are unavailable.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test chat_stream_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: the real OpenClaw gateway payload shapes for `chat.subscribe` and `chat.history` are still only exercised through the mock gateway harness here, so Phase 8 UI work should verify the backend against a live gateway before depending on richer message metadata.
  Next skill must read: `src-tauri/migrations/005_chat_cache.sql`, `src-tauri/src/models/chat_message.rs`, `src-tauri/src/services/openclaw/chat.rs`, `src-tauri/src/services/openclaw/client.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/tests/chat_stream_tests.rs`, `src/shared/lib/tauri.ts`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 01:52:11 PM CDT — `implementer -> DISPATCH-035`
  Status: PASS
  Summary: Implemented DISPATCH-034 so VICAM dispatch is now a real route in the shared dispatch flow, `Auto` prefers OpenClaw when connected and otherwise falls back to the last-used local agent, and orchestrated sessions drive the same linked-task lifecycle updates as direct dispatch. `src-tauri/src/services/dispatch.rs` now persists the last-used local agent profile, validates linked tasks for both dispatch paths, and exposes shared task lifecycle helpers used by both direct and orchestrated sessions. `src-tauri/src/services/openclaw/dispatch_bridge.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/services/openclaw/session_bridge.rs`, and `src-tauri/src/lib.rs` now create mirrored OpenClaw `agent_sessions` rows, link tasks through the existing foreign-key path, reconcile start/success/failure/cancel states, normalize `session_kind` to `orchestrated_agent`, and expose the new `dispatch_openclaw_session` Tauri command. On the frontend, `src/shared/lib/tauri.ts`, `src/features/agents/store/agentsSlice.ts`, `src/features/agents/DispatchModal.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/tasks/TasksTab.tsx`, and `src/features/agents/OrchestratedSessionView.tsx` now support explicit `local` vs `vicam` routing, a guarded `Dispatch via VICAM` action, and task-aware orchestrated session selection. The phase verification surface now includes `scripts/smoke/phase-7-openclaw.sh`.
  AC coverage: AC1 PASS. `Dispatch via VICAM` is enabled only while OpenClaw is connected, stays disabled in standalone mode, and the shared modal preserves the local dispatch path. AC2 PASS. `Auto` now routes to OpenClaw through the VICAM path when connected and falls back to the persisted last-used local agent profile when disconnected; the dispatch validation suite covers both the fallback and error cases. AC3 PASS. OpenClaw session start, terminal success/failure, and cancellation now update linked task workflow state through the same shared dispatch/task lifecycle helpers used by direct sessions, and repeated sidebar refreshes no longer overwrite later manual task transitions.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test openclaw_client_tests --test dispatch_validation_tests` PASS. `npm test -- --run src/features/agents/__tests__/DispatchModal.test.tsx src/features/agents/__tests__/OpenClawStatus.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx src/features/tasks/__tests__/TasksTab.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS with the existing Vite large-chunk warning only. `bash scripts/smoke/phase-7-openclaw.sh` PASS.
  Residual risk: The regression coverage now proves repeated snapshot refreshes do not revert a later manual task move to `done`, but it still does not exercise every possible manual task edit while an OpenClaw session remains active.
  Next skill must read: `src-tauri/src/services/dispatch.rs`, `src-tauri/src/services/openclaw/dispatch_bridge.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/services/openclaw/session_bridge.rs`, `src-tauri/tests/openclaw_client_tests.rs`, `src-tauri/tests/dispatch_validation_tests.rs`, `src/shared/lib/tauri.ts`, `src/features/agents/store/agentsSlice.ts`, `src/features/agents/DispatchModal.tsx`, `src/features/tasks/TasksTab.tsx`, `scripts/smoke/phase-7-openclaw.sh`, `TICKETS.md`.

- 2026-03-20 01:21:02 PM CDT — `implementer -> DISPATCH-034`
  Status: PASS
  Summary: Implemented the DISPATCH-033 OpenClaw session bridge so orchestrated sessions now land in the same Agents sidebar as direct PTY sessions without pretending they are attachable terminals. `src-tauri/src/services/openclaw/session_bridge.rs` now normalizes `sessions.list` payloads into typed sidebar records and exposes a resilient `OpenClawSidebarSnapshot`, while `src-tauri/src/commands/openclaw.rs`, `src-tauri/src/services/openclaw/mod.rs`, `src-tauri/src/lib.rs`, and `src-tauri/tests/openclaw_client_tests.rs` wire and verify the new `get_openclaw_sidebar_snapshot` Tauri command. On the frontend, `src/shared/lib/tauri.ts` now exposes the typed sidebar snapshot contract, `src/features/agents/store/agentsSlice.ts` now merges PTY and OpenClaw records into one discriminated session list plus connection snapshot state, `src/features/agents/SessionSidebar.tsx` now renders source badges and standalone/connected copy, and `src/features/agents/TerminalPanel.tsx` now branches between the existing xterm PTY viewport and the new `src/features/agents/OrchestratedSessionView.tsx` detail surface for mirrored OpenClaw rows. `src/features/agents/AgentSessionToolbar.tsx`, `src/features/agents/AgentsTab.tsx`, `src/features/agents/__tests__/OpenClawStatus.test.tsx`, and `src/features/agents/__tests__/TerminalPanel.test.tsx` were updated to cover the mixed-session surface and keep the PTY behavior intact.
  AC coverage: AC1 PASS. Orchestrated OpenClaw sessions now render in the shared Agents sidebar with an explicit `OpenClaw` badge, canonical status text, and connected/standalone header copy, while PTY rows keep their local-session affordances. AC2 PASS. `session_bridge.rs` owns the gateway-to-sidebar normalization, `get_openclaw_sidebar_snapshot` exposes the typed snapshot, and `agentsSlice.ts` merges the OpenClaw snapshot into the same `sessions` store that already backs PTY selection and toolbar state. AC3 PASS. `OpenClawStatus.test.tsx` covers disconnected, connected, and mixed-session sidebar states; `TerminalPanel.test.tsx` keeps PTY behavior green under the new snapshot load; and `openclaw_client_tests.rs` now exercises the new sidebar snapshot command over IPC.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test openclaw_client_tests` PASS. `npm test -- --run src/features/agents/__tests__/TerminalPanel.test.tsx src/features/agents/__tests__/OpenClawStatus.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS with the existing Vite large-chunk warning only.
  Residual risk: OpenClaw rows are currently snapshot-backed identity/status views, not live streamed transcript panes; that is aligned with the Phase 8 roadmap note that the Agents tab keeps the orchestrated stream view later rather than in this bridge slice.
  Next skill must read: `src-tauri/src/services/openclaw/session_bridge.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/tests/openclaw_client_tests.rs`, `src/shared/lib/tauri.ts`, `src/features/agents/store/agentsSlice.ts`, `src/features/agents/SessionSidebar.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/agents/OrchestratedSessionView.tsx`, `src/features/agents/__tests__/OpenClawStatus.test.tsx`, `src/features/agents/__tests__/TerminalPanel.test.tsx`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 01:07:00 PM CDT — `implementer -> DISPATCH-033`
  Status: PASS
  Summary: Implemented the DISPATCH-032 OpenClaw thin-integration backend as a Rust-owned WebSocket client and state machine. `src-tauri/src/services/openclaw/protocol.rs` now defines the typed gateway framing/handshake contract Dispatch uses, `src-tauri/src/services/openclaw/client.rs` now owns the `disconnected | connecting | connected | reconnecting` lifecycle plus reconnect-safe request routing, and `src-tauri/src/commands/openclaw.rs` exposes the Phase 7 command surface through Tauri. The command surface keeps Dispatch’s stable verbs while translating them onto the real gateway RPCs: `connect`/`disconnect` manage the socket locally, `status` returns Dispatch-owned connection state, `list` maps to `sessions.list`, `spawn` maps to `agent`, `send` maps to `chat.send`, and `kill` maps to `chat.abort`. `src-tauri/src/lib.rs`, `src-tauri/src/services/mod.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/Cargo.toml`, and `src/shared/lib/tauri.ts` now wire the service into the app/runtime/frontend bridge, while `src-tauri/tests/openclaw_client_tests.rs` covers service behavior plus the full IPC contract with a mock gateway. Reviewer follow-up was applied before handoff: the client now fences reconnect loops with a generation token so stale background drivers cannot overwrite shared status after disconnect/reconfigure, and the IPC suite now exercises `connect_openclaw`, `disconnect_openclaw`, `list_openclaw_sessions`, `spawn_openclaw_session`, `send_openclaw_message`, and `kill_openclaw_session` in addition to raw status.
  AC coverage: AC1 PASS. The backend now exposes connect, disconnect, status, list, spawn, send, and kill through `src-tauri/src/commands/openclaw.rs`, with the stable Dispatch verbs translated inside `client.rs` onto the live gateway surface (`sessions.list`, `agent`, `chat.send`, `chat.abort`) instead of assuming one-to-one RPC names that do not exist. AC2 PASS. `OpenClawConnectionStatus` in `client.rs` now moves through `disconnected`, `connecting`, `connected`, and `reconnecting`, and the driver loop refreshes status/health/presence snapshots after each successful reconnect so standalone mode remains intact while gateway state recovers. AC3 PASS. `src-tauri/tests/openclaw_client_tests.rs` now covers successful connection plus list/spawn/send/kill routing, reconnect after socket drop, gateway-down behavior, and the registered Tauri command surface over IPC.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test openclaw_client_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Residual risk: device-token pairing/rotation support is not implemented in this thin Phase 7 slice; the current client relies on the documented optionality of `connect.params.device` and `auth.deviceToken`, so a future follow-up should add persisted device-token handling if Dispatch needs first-class paired-gateway recovery.
  Next skill must read: `src-tauri/src/services/openclaw/protocol.rs`, `src-tauri/src/services/openclaw/client.rs`, `src-tauri/src/commands/openclaw.rs`, `src-tauri/tests/openclaw_client_tests.rs`, `src/shared/lib/tauri.ts`, `src/features/agents/AgentsTab.tsx`, `src/features/agents/SessionSidebar.tsx`, `src/features/agents/store/agentsSlice.ts`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 12:42:16 PM CDT — `implementer -> DISPATCH-032`
  Status: PASS
  Summary: Implemented the DISPATCH-031 History tab UX on top of the newly verified save-point backend. `src/features/history/HistoryTab.tsx`, `src/features/history/SavePointList.tsx`, `src/features/history/DiffViewer.tsx`, and `src/features/history/RestoreConfirmDialog.tsx` now replace the old placeholder with a real lazy-mounted history surface that lists project save points, filters them locally by search query, loads save-point diffs on selection, supports manual save-point creation, and gates both workspace and single-file restore behind explicit confirmation dialogs. `src/app/TabHost.tsx` now mounts the real History tab, `src/app/__tests__/TabHost.test.tsx` keeps the lazy-mount contract covered, `src/features/history/__tests__/HistoryTab.test.tsx` exercises the save-point list/search/diff/create/restore flows with mocked Tauri commands, and `scripts/smoke/phase-6-history.sh` now codifies the phase-specific history smoke path.
  AC coverage: AC1 PASS. The History tab now lists and client-side searches save points for the active project through `SavePointList.tsx` and `HistoryTab.tsx`, while preserving selection state across lazy panel switches. AC2 PASS. Selecting a save point loads file-by-file diff content through `DiffViewer.tsx`, including summary badges and per-file restore affordances. AC3 PASS. Manual save-point creation plus both workspace and file restore confirmations are covered in `HistoryTab.test.tsx`, and the new phase-6 smoke script verifies the History ticket path against the Rust save-point suites plus the frontend build.
  Command summary: `bash scripts/smoke/phase-6-history.sh` PASS. `npm test` PASS. `npx vitest run src/features/history/__tests__/HistoryTab.test.tsx src/app/__tests__/TabHost.test.tsx` PASS. `npm run build` PASS.
  Next skill must read: `ROADMAP-v2.md`, `docs/adr/0001-runtime-boundaries.md`, `TICKETS.md`, `src-tauri/src/services/dispatch.rs`, `src/features/agents/store/agentsSlice.ts`, `src-tauri/src/lib.rs`.

- 2026-03-20 12:34:06 PM CDT — `implementer -> DISPATCH-031`
  Status: PASS
  Summary: Implemented the DISPATCH-030 diff and restore backend for git-backed save points without changing the non-git contract. `src-tauri/src/services/history/diff.rs` now resolves Dispatch save-point refs back to synthetic commits, diffs the save-point tree against the captured base HEAD tree, and returns typed summary plus file-level patch payloads. `src-tauri/src/services/history/restore.rs` now restores either the full workspace or a single project-relative file from a selected save point, keeps `latest` and branch refs untouched, and returns typed unsupported results instead of auto-initializing repositories for plain folders. `src-tauri/src/services/history/mod.rs`, `src-tauri/src/commands/history.rs`, `src-tauri/src/lib.rs`, and `src/shared/lib/tauri.ts` now expose the diff/restore surface through the Tauri and frontend IPC contracts, and `src-tauri/tests/history_restore_tests.rs` now covers diff payloads, full restore, single-file restore, path validation, and unsupported non-git behavior.
  AC coverage: AC1 PASS. `get_save_point_diff(...)` now returns ready/unsupported typed results with summary counts plus per-file patch content, and `history_restore_tests.rs` proves add/modify/delete coverage against a real git repo fixture. AC2 PASS. `restore_project_save_point(...)` and `restore_project_save_point_file(...)` now restore full-workspace and single-file state from Dispatch refs, with tests proving full restore rewinds tracked and untracked workspace state while single-file restore leaves unrelated edits intact. AC3 PASS. Non-git projects now return typed unsupported diff/restore results instead of initializing a repository, and the same test suite verifies that behavior directly.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test history_restore_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/history/diff.rs`, `src-tauri/src/services/history/restore.rs`, `src-tauri/src/services/history/mod.rs`, `src-tauri/src/commands/history.rs`, `src/shared/lib/tauri.ts`, `src-tauri/tests/history_restore_tests.rs`, `docs/adr/0004-history-save-points.md`, `TICKETS.md`.

- 2026-03-20 12:22:37 PM CDT — `implementer -> DISPATCH-029`
  Status: PASS
  Summary: Implemented the DISPATCH-029 save-point creation and lifecycle-hook layer on top of the earlier metadata foundation. `src-tauri/src/services/history/save_points.rs` now uses `git2 0.20.4` plus an in-memory index snapshot to create synthetic Dispatch commits under `refs/dispatch/save-points/{project_id}/{timestamp}-{label}`, keeps `latest` as a symbolic ref, normalizes automatic and manual labels, restores `latest` on failed metadata writes, and returns a typed unsupported result for non-git projects. `src-tauri/src/services/history/mod.rs` now re-exports the creator API and records `save_points.created_at` with millisecond precision so pre/post hooks created in the same second sort correctly. `src-tauri/src/services/dispatch.rs` and `src-tauri/src/services/pty_manager.rs` now preallocate direct-dispatch session ids, create pre-agent save points before PTY launch, and create post-agent save points when direct sessions reach terminal status without blocking non-git projects. `src-tauri/src/commands/history.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, and `src/shared/lib/tauri.ts` now expose typed manual-create/list/latest history commands for the future History tab.
  AC coverage: AC1 PASS. `create_pre_agent_save_point(...)` creates synthetic pre-run commits even on clean git repos, and `history_dispatch_hooks_tests.rs` proves direct dispatch creates the pre-run anchor before the agent session completes. AC2 PASS for the current runtime surface. Direct dispatch now writes project-scoped pre/post refs plus a symbolic `latest` ref, `save_point_tests.rs` verifies the namespace and latest-ref behavior, and the same shared creator API now powers manual save points; there is no separate orchestrated run path in the repo yet, so there was nothing additional to hook. AC3 PASS. Save-point commits always use the synthetic Dispatch identity, metadata rows are persisted through `record_save_point(...)`, and the save-point tests verify author/committer identity plus metadata discovery.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test save_point_tests --test history_dispatch_hooks_tests --test task_export_tests --test task_transition_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test project_fs_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `docs/adr/0004-history-save-points.md`, `src-tauri/src/services/history/save_points.rs`, `src-tauri/src/services/history/mod.rs`, `src-tauri/src/services/dispatch.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/commands/history.rs`, `src-tauri/tests/save_point_tests.rs`, `src-tauri/tests/history_dispatch_hooks_tests.rs`, `TICKETS.md`.

- 2026-03-20 12:22:20 PM CDT — `implementer -> DISPATCH-027`
  Status: PASS
  Summary: Implemented the DISPATCH-027 Files tab UX on top of the existing safe project-scoped file APIs. `src/features/files/FilesTab.tsx`, `src/features/files/FileTree.tsx`, `src/features/files/FilePreview.tsx`, and `src/features/files/store/filesSlice.ts` now provide a real lazy-mounted file browser with persisted directory/search/preview state, path and content search, event-driven refresh on `dispatch://files/refresh`, and preview-driven editor handoff. `src/features/files/FilesPlaceholder.tsx`, `src/app/TabHost.tsx`, `src/app/__tests__/TabHost.test.tsx`, and `src/store/index.ts` now keep the Files surface mounted once activated so the state survives tab switches. To make `Open in editor` honest, `src-tauri/src/services/project_fs.rs` and `src/shared/lib/tauri.ts` now expose a vetted absolute preview path alongside the project-relative UI path, and `src-tauri/capabilities/default.json` now grants `opener:allow-open-path` so the frontend opener plugin can hand the selected file to the user’s editor without escaping the project root checks that already gate preview reads.
  AC coverage: AC1 PASS. The Files tab now lists the current project tree, previews readable files, preserves selected preview state across lazy tab switches through the shared store, and refreshes off the existing watcher event. AC2 PASS. Path and content search both render dedicated result lists, and clicking either path hits or content hits reuses the same preview/navigation flow. AC3 PASS. `FilePreview.tsx` now launches the selected file through `@tauri-apps/plugin-opener` using the vetted absolute preview path returned from Rust, with the required Rust plugin wiring and capability permission in place.
  Command summary: `npm test -- --run src/features/files/__tests__/FilePreview.test.tsx src/features/files/__tests__/FilesTab.test.tsx src/features/files/__tests__/FilesPlaceholder.test.tsx src/app/__tests__/TabHost.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test project_fs_tests` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src/features/files/FilesTab.tsx`, `src/features/files/FileTree.tsx`, `src/features/files/FilePreview.tsx`, `src/features/files/store/filesSlice.ts`, `src/shared/lib/tauri.ts`, `src-tauri/src/services/project_fs.rs`, `src-tauri/capabilities/default.json`, `src/features/files/__tests__/FilesTab.test.tsx`, `src/features/files/__tests__/FilePreview.test.tsx`, `TICKETS.md`.

- 2026-03-20 11:55:38 AM CDT — `implementer -> DISPATCH-029`
  Status: BLOCKED
  Summary: DISPATCH-029 is blocked on the missing `git2` runtime dependency. The now-implemented history metadata layer in `DISPATCH-028` is aligned to `docs/adr/0004-history-save-points.md`, and that ADR is explicit that History v1 save-point creation, lookup, diffing, and restore flows use `git2 0.20.4` in Rust rather than shelling out to the git CLI. This repo does not currently declare `git2` in `src-tauri/Cargo.toml`, and there is no existing Rust git integration layer to build ref creation, synthetic signatures, or commit writing on top of. Because adding a new dependency is an ask-first change, I did not implement `DISPATCH-029` against a different backend contract.
  AC coverage: AC1 NOT STARTED. The repo lacks the required Rust git client for creating synthetic pre-run save points. AC2 NOT STARTED. Project-scoped ref writes and `latest` updates cannot be implemented honestly without the missing git dependency. AC3 NOT STARTED. Synthetic Dispatch identity handling depends on the same missing Rust git layer.
  Command summary: Research only. Verified the blocker by reading `docs/adr/0004-history-save-points.md`, `TICKETS.md`, and `src-tauri/Cargo.toml`, and by confirming `git2` is absent from the current Rust dependency set.
  Next skill must read: `docs/adr/0004-history-save-points.md`, `src-tauri/Cargo.toml`, `src-tauri/src/services/history/mod.rs`, `src-tauri/migrations/004_save_points.sql`, `TICKETS.md`.

- 2026-03-20 11:55:15 AM CDT — `implementer -> DISPATCH-029`
  Status: PASS
  Summary: Implemented the DISPATCH-028 history metadata foundation on the independent Phase 6 lane. `src-tauri/migrations/004_save_points.sql` now adds the project-scoped `save_points` table plus listing indexes, with constraints that keep refs under `refs/dispatch/save-points/{project_id}/...` and explicitly forbid persisting the derived `latest` alias. `src-tauri/src/services/history/mod.rs` now provides the minimal backend discovery contract through `record_save_point(...)`, `list_project_save_points(...)`, and `latest_project_save_point(...)`, with git-repo activation checks and stage/ref-name validation aligned to `docs/adr/0004-history-save-points.md`. `src-tauri/src/db/migrate.rs`, `src-tauri/src/services/mod.rs`, and `src-tauri/tests/db_schema_smoke.rs` now register and verify migration `004_save_points`, while `src-tauri/tests/save_point_tests.rs` uses a real git repo fixture to prove save-point metadata persistence, reverse-chronological listing, duplicate-ref rejection, and typed unsupported behavior for non-git projects.
  AC coverage: AC1 PASS. Migration `004_save_points.sql` creates the save-point metadata table and indexes, and `db_schema_smoke.rs` verifies the fresh and upgrade paths record migration version 4. AC2 PASS. `list_project_save_points(...)` now returns project save points in reverse chronological order with `latest_project_save_point(...)` derived from the same ordering. AC3 PASS. `save_point_tests.rs` uses an existing git repo fixture created by the system `git` CLI to verify metadata persistence and discovery behavior without branch-history side effects.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test save_point_tests --test db_schema_smoke` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/migrations/004_save_points.sql`, `src-tauri/src/services/history/mod.rs`, `src-tauri/src/db/migrate.rs`, `src-tauri/tests/save_point_tests.rs`, `src-tauri/tests/db_schema_smoke.rs`, `docs/adr/0004-history-save-points.md`, `TICKETS.md`.

- 2026-03-20 11:46:00 AM CDT — `implementer -> DISPATCH-027`
  Status: BLOCKED
  Summary: DISPATCH-027 is blocked at the editor-handoff acceptance criterion before UI implementation starts. The ticket requires `Open in editor` to launch the selected file via the opener plugin, and the roadmap’s locked baseline agrees (`@tauri-apps/plugin-opener` on the frontend and `tauri-plugin-opener` on the Rust side). This repo does not currently include either dependency or plugin wiring: `package.json` does not list `@tauri-apps/plugin-opener`, `src-tauri/Cargo.toml` does not list `tauri-plugin-opener`, and there is no opener registration or usage in `src-tauri/src/lib.rs` or the current command surface. Because adding dependencies is an explicit ask-first change, I stopped here instead of building a different system-launch path that would drift from the roadmap and ticket text.
  AC coverage: AC1 NOT STARTED. Tree/preview/persistent-selection work is still implementable with the current stack. AC2 NOT STARTED. Search-result navigation is also implementable with the current stack. AC3 BLOCKED. `Open in editor` cannot honestly be implemented “via the opener plugin” until the missing opener dependencies and registration are added.
  Command summary: Research only. Verified missing opener integration via `rg -n "plugin-opener|open in editor|opener" package.json src src-tauri -g '!target' -g '!dist'`, `cat package.json`, `cat src-tauri/Cargo.toml`, `cat src-tauri/tauri.conf.json`, and `cargo tree --manifest-path src-tauri/Cargo.toml | rg -n "\\bopen\\b|opener|tauri-plugin-opener"`.
  Next skill must read: `ROADMAP-v2.md`, `TICKETS.md`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/features/files/FilesPlaceholder.tsx`, `src/shared/lib/tauri.ts`.

- 2026-03-20 11:44:18 AM CDT — `implementer -> DISPATCH-027`
  Status: PASS
  Summary: Implemented the DISPATCH-026 file-watch lifecycle across the backend service layer plus the minimal lazy Files-panel hook needed to start it at the right time. `src-tauri/src/services/file_watch.rs` now owns a single active project watch at a time, uses a polling/snapshot loop instead of adding a new watcher dependency, emits debounced `dispatch://files/refresh` payloads shaped as `{ projectId, changedPaths, changedAtUnixMs }`, replaces the active watch cleanly on project switch, and stops its background thread on explicit stop or service drop. `src-tauri/src/commands/files.rs`, `src-tauri/src/services/mod.rs`, and `src-tauri/src/lib.rs` now expose and register the typed `start_project_file_watch` and `stop_project_file_watch` command surface. On the frontend edge, `src/shared/lib/tauri.ts` now exports the exact watch contract for future Files work, `src/features/files/FilesPlaceholder.tsx` now starts the watch when the lazy Files panel first mounts and replaces/stops it on project changes or teardown, and `src/features/files/__tests__/FilesPlaceholder.test.tsx` verifies that lifecycle from the React side.
  AC coverage: AC1 PASS. Watchers now start lazily through `start_project_file_watch`, and `FilesPlaceholder.tsx` calls that command only when the Files panel mounts with an active project, not at app boot; the panel remains lazily mounted under `TabHost`, preserving the “first Files-tab open” behavior. AC2 PASS. Switching projects replaces the active watcher in `file_watch.rs`, `stop_project_file_watch` tears it down explicitly, and the service `Drop` path stops the background thread cleanly on shutdown. AC3 PASS. `file_watch_tests.rs` covers debounce, project-switch replacement, and drop cleanup for the typed refresh payloads, while `FilesPlaceholder.test.tsx` covers the lazy Files-panel start/replace/stop command flow.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test file_watch_tests` PASS. `npx vitest run src/features/files/__tests__/FilesPlaceholder.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/file_watch.rs`, `src-tauri/src/commands/files.rs`, `src-tauri/tests/file_watch_tests.rs`, `src/shared/lib/tauri.ts`, `src/features/files/FilesPlaceholder.tsx`, `src/features/files/__tests__/FilesPlaceholder.test.tsx`, `src/app/TabHost.tsx`, `TICKETS.md`.

- 2026-03-20 11:35:57 AM CDT — `implementer -> DISPATCH-026`
  Status: PASS
  Summary: Implemented the DISPATCH-025 search layer for project files on top of the existing project-scoped Files service. `src-tauri/src/services/project_fs.rs` now provides ignore-aware path search and content search rooted in the registered project path, using the `ignore` walker plus `grep` crates instead of shelling out to system tools. `src-tauri/src/commands/files.rs` now exposes typed `search_project_paths` and `search_project_content` commands, `src-tauri/src/lib.rs` registers the new IPC surface, `src/shared/lib/tauri.ts` exposes typed frontend bindings for both search paths, and `src-tauri/tests/project_fs_tests.rs` now covers ignored files/directories, nested directories, blank-query rejection, and mixed text/binary content handling.
  AC coverage: AC1 PASS. Path search now walks the project root with `.gitignore`/global ignore handling enabled and omits ignored directories/files through `build_project_walker(...)` in `project_fs.rs`. AC2 PASS. Content search now returns project-relative `path`, `line_number`, and `line_text` hits through `ProjectContentSearchHit`, which is enough for preview navigation and line targeting. AC3 PASS. `project_fs_tests.rs` now covers ignored files, nested directories, blank queries, and binary/text distinctions for both search modes.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test project_fs_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/project_fs.rs`, `src-tauri/src/commands/files.rs`, `src-tauri/tests/project_fs_tests.rs`, `src/shared/lib/tauri.ts`, `src-tauri/Cargo.toml`, `TICKETS.md`.

- 2026-03-20 11:29:43 AM CDT — `implementer -> DISPATCH-025`
  Status: PASS
  Summary: Implemented the DISPATCH-024 backend Files foundation as a fresh Rust-owned service/command slice. `src-tauri/src/services/project_fs.rs` now provides project-scoped directory listing and previewable file reads rooted in registered project paths, reusing `path_guard::assert_project_relative(...)` to reject absolute paths, traversal, and escaping symlink targets. `src-tauri/src/commands/files.rs` exposes typed `list_project_tree` and `read_project_file` Tauri commands, `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs` now register that IPC surface, and `src/shared/lib/tauri.ts` now carries typed bindings for future Files tab work. `src-tauri/tests/project_fs_tests.rs` covers project-root listing, nested listing, markdown/text preview payloads, absolute-path rejection, traversal rejection, and binary-file rejection.
  AC coverage: AC1 PASS. Tree listing and file reads now require `project_id` plus a project-relative path through `project_fs.rs` and `commands/files.rs`. AC2 PASS. Absolute paths and traversal attempts are rejected by the reused `path_guard` boundary, with direct backend coverage in `project_fs_tests.rs`. AC3 PASS. Valid markdown and text files now return preview-ready payloads with path, name, format, and content through `read_project_file(...)`.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test project_fs_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/project_fs.rs`, `src-tauri/src/commands/files.rs`, `src-tauri/tests/project_fs_tests.rs`, `src-tauri/src/services/path_guard.rs`, `src/shared/lib/tauri.ts`, `TICKETS.md`.

- 2026-03-20 11:24:49 AM CDT — `implementer -> DISPATCH-024`
  Status: PASS
  Summary: Completed the remaining DISPATCH-023 work by proving the existing markdown export pipeline end to end and wiring task cards into the shared direct-dispatch modal. On the backend, `src-tauri/src/services/task_export.rs` plus `src-tauri/src/commands/tasks.rs` and `src-tauri/src/services/dispatch.rs` now have verified coverage for create/edit/delete exports and direct-dispatch transition resyncs through `src-tauri/tests/task_export_tests.rs`. On the frontend, `src/features/tasks/KanbanCard.tsx` now exposes a `Send to Agent` action per card, `src/features/tasks/KanbanBoard.tsx` routes that action upward, and `src/features/tasks/TasksTab.tsx` now reuses `src/features/agents/DispatchModal.tsx` with task-aware dispatch requests, refreshes the terminal workspace when needed, forwards `taskId` into the shared `dispatchAgent(...)` path, and refreshes task state after dispatch so workflow/run/session linkage stays current on the board. `src/features/tasks/__tests__/TasksTab.test.tsx` now covers the task-card dispatch flow, while the existing export and board suites continue to prove the file output and UI behavior.
  AC coverage: AC1 PASS. Task markdown exports are written under `<project-root>/dispatch/tasks/<task-id>-<slug>.md` with verified frontmatter/body output in `task_export_tests.rs`. AC2 PASS. Export sync is now verified across task create/edit/delete plus direct-dispatch lifecycle transitions through `task_export.rs`, `commands/tasks.rs`, `services/dispatch.rs`, and `task_export_tests.rs`. AC3 PASS. Task cards now launch the shared dispatch modal through `TasksTab.tsx`/`KanbanCard.tsx`, and `TasksTab.test.tsx` verifies the dispatch request keeps `taskId` attached so board/session linkage refreshes after launch.
  Command summary: `npx vitest run src/features/tasks/__tests__/TasksTab.test.tsx src/features/tasks/__tests__/TaskDetailDrawer.test.tsx src/features/tasks/__tests__/KanbanBoard.test.tsx src/features/tasks/store/tasksSlice.test.ts` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/task_export.rs`, `src-tauri/tests/task_export_tests.rs`, `src-tauri/src/commands/tasks.rs`, `src-tauri/src/services/dispatch.rs`, `src/features/tasks/TasksTab.tsx`, `src/features/tasks/KanbanBoard.tsx`, `src/features/tasks/KanbanCard.tsx`, `src/features/tasks/__tests__/TasksTab.test.tsx`, `src/features/agents/DispatchModal.tsx`, `TICKETS.md`.

- 2026-03-20 11:10:09 AM CDT — `implementer -> DISPATCH-023`
  Status: PASS
  Summary: Implemented the DISPATCH-022 task detail drawer and richer card metadata on top of the now-typed task contract. `src/features/tasks/TaskDetailDrawer.tsx` now owns the editable drawer state for title, markdown description, subtasks, labels, priority, assignee, agent mode, workflow state, blocked reason, and review notes while keeping linked-session and last-run context visible; `src/features/tasks/TasksTab.tsx` now swaps the old static selected-task rail for that drawer, loads agent registry options for the agent-mode selector, and persists edits through the existing `updateTask(...)` path without changing store/backend contracts; and `src/features/tasks/KanbanCard.tsx` now surfaces compact priority and last-run badges directly on each card without disturbing the draggable button surface. The new `TaskDetailDrawer.test.tsx` suite covers save and cancel behavior, and `KanbanBoard.test.tsx` now asserts card metadata badge rendering alongside the existing drag/drop coverage.
  AC coverage: AC1 PASS. Users can now edit markdown description, subtasks, labels, priority, assignee, agent mode, review notes, and workflow state from `TaskDetailDrawer.tsx`, with save/cancel wired through the existing typed store contract. AC2 PASS. Kanban cards now surface priority and last-run badges directly in `KanbanCard.tsx` without requiring the drawer to open. AC3 PASS. `TaskDetailDrawer.test.tsx` covers save and cancel behavior, and `KanbanBoard.test.tsx` covers metadata rendering on the board surface.
  Command summary: `npx vitest run src/features/tasks/__tests__/TaskDetailDrawer.test.tsx src/features/tasks/__tests__/KanbanBoard.test.tsx` PASS. `npm test` PASS. `npm run build` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS.
  Next skill must read: `src/features/tasks/TaskDetailDrawer.tsx`, `src/features/tasks/TasksTab.tsx`, `src/features/tasks/KanbanCard.tsx`, `src/features/tasks/__tests__/TaskDetailDrawer.test.tsx`, `src/features/tasks/__tests__/KanbanBoard.test.tsx`, `src/shared/lib/tauri.ts`, `src-tauri/src/commands/tasks.rs`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 11:04:56 AM CDT — `implementer -> DISPATCH-022`
  Status: PASS
  Summary: Cleared the DISPATCH-022 persistence blocker by adding task metadata storage and typed API coverage before returning to the drawer UI work. `src-tauri/migrations/003_task_metadata.sql` now adds persisted `priority`, `labels_json`, `subtasks_json`, `review_notes_markdown`, and `assignee` columns; `src-tauri/src/db/migrate.rs`, `src-tauri/src/models/task.rs`, and `src-tauri/src/commands/tasks.rs` now round-trip those fields through the Rust task contract; and `src/shared/lib/tauri.ts` plus `src/features/tasks/store/tasksSlice.ts` now expose the typed frontend shape. Verification was also strengthened so this is not just a schema declaration: `src-tauri/tests/db_schema_smoke.rs` now covers the 003 migration on fresh and pre-003 databases, `src-tauri/tests/task_commands_tests.rs` reloads updated rows from SQLite, and `src-tauri/tests/task_commands_smoke.rs` exercises the new metadata over the IPC boundary.
  AC coverage: DISPATCH-022 preconditions restored. AC1 UNBLOCKED because description, subtasks, labels, priority, assignee, agent mode, and review-note fields now have real persistence/API support. AC2 UNBLOCKED because `priority` is now available for card rendering alongside the existing `last_run_state`. AC3 UNBLOCKED because save/cancel and metadata-rendering tests can now assert stable persisted fields instead of ephemeral UI-only state.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test db_schema_smoke --test task_commands_tests --test task_commands_smoke` PASS. `npx vitest run src/features/tasks/store/tasksSlice.test.ts src/features/tasks/__tests__/KanbanBoard.test.tsx` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/migrations/003_task_metadata.sql`, `src-tauri/src/db/migrate.rs`, `src-tauri/src/models/task.rs`, `src-tauri/src/commands/tasks.rs`, `src/shared/lib/tauri.ts`, `src/features/tasks/store/tasksSlice.ts`, `src-tauri/tests/db_schema_smoke.rs`, `src-tauri/tests/task_commands_tests.rs`, `src-tauri/tests/task_commands_smoke.rs`, `TICKETS.md`.

- 2026-03-20 07:24:01 CDT — `implementer -> DISPATCH-022`
  Status: BLOCKED
  Summary: DISPATCH-022 cannot be completed against the current persisted task contract. The existing task schema and IPC surface support `description_markdown`, `assigned_agent_mode`, `workflow_state`, `last_run_state`, `last_session_id`, `blocked_reason`, `markdown_export_path`, and timestamps, but the ticket’s required editable fields also include subtasks, labels, priority, and review notes. Those fields do not exist in `src-tauri/migrations/001_init.sql`, `src-tauri/src/models/task.rs`, or `src/shared/lib/tauri.ts`, so implementing the full drawer as written would require schema and API expansion rather than a pure UI pass.
  AC coverage: AC1 BLOCKED. Markdown description and agent-mode editing are supportable today, but subtasks, labels, priority, and review notes have no persisted fields. AC2 BLOCKED. `last_run_state` already exists and can be surfaced on cards, but `priority` has no backing schema/API field to render or edit. AC3 BLOCKED. Save/cancel tests for the full drawer contract would be misleading until the missing metadata fields have real persistence.
  Command summary: No code changes made for DISPATCH-022. Investigation only.
  Next skill must read: `src-tauri/migrations/001_init.sql`, `src-tauri/src/models/task.rs`, `src-tauri/src/commands/tasks.rs`, `src/shared/lib/tauri.ts`, `ROADMAP-v2.md`, `TICKETS.md`.

- 2026-03-20 07:22:37 CDT — `implementer -> DISPATCH-022`
  Status: PASS
  Summary: Implemented the DISPATCH-021 kanban board and drag/drop layer on top of the verified task store foundation. `src/features/tasks/KanbanBoard.tsx` now renders the five main workflow columns, keeps a local visual order for cards within the board, and routes cross-column drops through `onMoveTask({ taskId, workflowState })`; `src/features/tasks/KanbanColumn.tsx` provides the drop zones and column framing; and `src/features/tasks/KanbanCard.tsx` keeps the card surface presentational so later detail-drawer work can reuse it. `src/features/tasks/TasksTab.tsx` now swaps the temporary task list for the kanban board while preserving the create flow, project scoping, selected-task context, and blocked-task visibility outside the five main columns. `src/features/tasks/__tests__/KanbanBoard.test.tsx` covers column grouping, same-column visual reordering, and cross-column workflow moves.
  AC coverage: AC1 PASS. The Tasks overlay now renders Draft, Planning, In Progress, Review, and Done columns through `KanbanBoard.tsx`/`KanbanColumn.tsx`, grouped from the active project’s task slice state. AC2 PASS. Dragging a card across columns now persists the new workflow state through the existing `updateTask(...)` path in `TasksTab.tsx`, while same-column drops update local board order without inventing a new persistence field. AC3 PASS. Component tests now cover board grouping, same-column reorder behavior, and cross-column moves in `src/features/tasks/__tests__/KanbanBoard.test.tsx`.
  Command summary: `npx vitest run src/features/tasks/__tests__/KanbanBoard.test.tsx src/features/tasks/store/tasksSlice.test.ts` PASS. `npm test` PASS. `npm run build` PASS.
  Next skill must read: `src/features/tasks/KanbanBoard.tsx`, `src/features/tasks/KanbanColumn.tsx`, `src/features/tasks/KanbanCard.tsx`, `src/features/tasks/TasksTab.tsx`, `src/features/tasks/store/tasksSlice.ts`, `src/features/tasks/__tests__/KanbanBoard.test.tsx`, `src/shared/lib/tauri.ts`, `TICKETS.md`.

- 2026-03-20 07:17:16 CDT — `implementer -> DISPATCH-021`
  Status: PASS
  Summary: Implemented the DISPATCH-020 task CRUD and project-scoped store foundation across both the backend and frontend shell. `src-tauri/src/commands/tasks.rs` now exposes typed task list/create/update/delete commands against the existing `tasks` table, keeps reads and writes scoped to `project_id`, validates task IDs/titles plus allowed workflow and last-run states, and preserves unspecified fields on partial updates. `src/shared/lib/tauri.ts` now exposes typed `TaskRecord` payloads and task IPC helpers, `src/features/tasks/store/tasksSlice.ts` now routes all task queries through `activeProjectId` while owning task load/action/error/selection state, and `src/features/tasks/TasksTab.tsx` replaces the placeholder overlay with a real foundation surface that loads project tasks, supports draft creation, linked-task selection, workflow updates, and task deletion. `src/app/App.tsx` now mounts `TasksTab` in the overlay, `src-tauri/tests/task_commands_tests.rs` covers project-scoped helper behavior including partial updates, `src-tauri/tests/task_commands_smoke.rs` covers the actual IPC contract, and `src/features/tasks/store/tasksSlice.test.ts` covers active-project task scoping in the frontend store.
  AC coverage: AC1 PASS. Tasks can now be created, listed, updated, and deleted through typed Tauri commands in `src-tauri/src/commands/tasks.rs`, with typed frontend bindings in `src/shared/lib/tauri.ts`. AC2 PASS. Task queries are always scoped to `activeProjectId` in the frontend store and to `project_id` in the backend command layer, so switching projects replaces the task set instead of leaking rows across workspaces. AC3 PASS. Empty and populated task sets per project are now covered by backend command tests and smoke (`task_commands_tests.rs`, `task_commands_smoke.rs`) plus the frontend store test (`tasksSlice.test.ts`).
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test task_commands_tests --test task_commands_smoke` PASS. `npx vitest run src/features/tasks/store/tasksSlice.test.ts` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm test` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src/features/tasks/TasksTab.tsx`, `src/features/tasks/store/tasksSlice.ts`, `src/shared/lib/tauri.ts`, `src-tauri/src/commands/tasks.rs`, `src-tauri/tests/task_commands_tests.rs`, `src-tauri/tests/task_commands_smoke.rs`, `src/app/App.tsx`, `TICKETS.md`.

- 2026-03-20 07:08:07 CDT — `implementer -> DISPATCH-020`
  Status: PASS
  Summary: Implemented the DISPATCH-019 direct-dispatch UI layer across the frontend shell and typed Tauri bridge. `src/features/agents/DispatchModal.tsx` now loads the registry, keeps `Auto` available as the first dispatch path, validates missing project/profile cases, and submits project-scoped direct-dispatch launches; `src/features/agents/AgentSessionToolbar.tsx` adds copy-output, fullscreen, linked-task, terminate, and status/source/session-kind controls; `src/features/agents/TerminalPanel.tsx` now wires the shared modal, toolbar actions, per-session output buffering, fullscreen presentation, linked-task overlay jumps, and terminate-session flows through `agentsSlice.ts`; and `src/features/settings/AgentRegistryPane.tsx` exposes a read-only registry view inside Settings. `src/shared/lib/tauri.ts`, `src-tauri/src/commands/terminal.rs`, and `src-tauri/src/lib.rs` now expose the typed terminate-session IPC surface used by the toolbar. The component suite now covers modal validation and the toolbar controls in `DispatchModal.test.tsx` and `TerminalPanel.test.tsx`, `scripts/smoke/phase-3-direct-dispatch.sh` locks in the direct-dispatch smoke path, and full Rust verification uncovered then fixed a websocket reattach race by adding bounded attachment reacquire retries in `src-tauri/src/services/terminal_ws.rs`.
  AC coverage: AC1 PASS. The shared dispatch modal now supports explicit agent selection, editable prompt text, project context display, and the standalone `Auto` fallback through `DispatchModal.tsx`, with registry-backed selection and missing-project validation covered in `DispatchModal.test.tsx`. AC2 PASS. The session toolbar now supports copy output, full-screen, kill, and linked-task navigation through `AgentSessionToolbar.tsx` and `TerminalPanel.tsx`, with direct component coverage for the selected-session controls in `TerminalPanel.test.tsx`. AC3 PASS. Component tests cover registry-backed modal selection plus validation, and the direct-dispatch smoke script now exercises Rust validation/task-transition suites, the modal/toolbar Vitest suite, and a production frontend build. Residual verification gap closed: full `cargo test` now passes after fixing the websocket attachment teardown race in `terminal_ws.rs`.
  Command summary: `npx vitest run src/features/agents/__tests__/DispatchModal.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx` PASS. `bash scripts/smoke/phase-3-direct-dispatch.sh` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_ws_attach_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/migrations/001_init.sql`, `src-tauri/src/models/task.rs`, `src-tauri/src/commands/projects.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src/store/projectSlice.ts`, `src/store/index.ts`, `src/shared/lib/tauri.ts`, `src/features/tasks/TasksPlaceholder.tsx`, `src-tauri/tests/projects_commands_smoke.rs`, `src-tauri/tests/db_schema_smoke.rs`, `TICKETS.md`.

- 2026-03-20 06:50:18 CDT — `implementer -> DISPATCH-019`
  Status: PASS
  Summary: Implemented the DISPATCH-018 task lifecycle wiring for direct dispatch. `src-tauri/src/services/dispatch.rs` now marks task-linked direct sessions as `workflow_state=in_progress`, `last_run_state=running`, and `last_session_id=<session_id>` as soon as the PTY-backed session is created. `src-tauri/src/services/pty_manager.rs` now routes all session status transitions through a shared updater that also syncs linked tasks for direct-dispatch sessions, adds a cancel-request flag so kill flows resolve to `canceled` instead of racing with success/failure exit handling, and records canceled rows during `terminate_session()`. `src-tauri/src/services/terminal_ws.rs` now uses the shared exit recorder so websocket-attached sessions follow the same success/failure/cancel path. The new `src-tauri/tests/task_transition_tests.rs` acceptance suite covers start, success, failure, and cancel transitions on task-linked direct sessions.
  AC coverage: AC1 PASS. Task-linked `dispatch_agent(...)` now updates the linked task to `workflow_state=in_progress`, `last_run_state=running`, and `last_session_id=<session_id>` immediately after session creation through `services/dispatch.rs`, with direct coverage in `task_transition_tests.rs`. AC2 PASS. Successful direct sessions now move the task to `review` with `last_run_state=succeeded`, failed sessions keep the task `in_progress` with `last_run_state=failed`, and canceled sessions keep the task `in_progress` with `last_run_state=canceled`; these transitions are driven from the shared session-status path in `pty_manager.rs` and exercised by the success/failure/cancel acceptance tests. AC3 PASS. `task_transition_tests.rs` covers start, success, failure, and cancel flows end to end against real PTY-backed direct sessions, including `last_session_id` assertions for every path.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test task_transition_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src/features/agents/AgentsTab.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/agents/SessionSidebar.tsx`, `src/features/agents/store/agentsSlice.ts`, `src/shared/lib/tauri.ts`, `src/features/projects/AddProjectDialog.tsx`, `src/features/projects/ProjectSwitcher.tsx`, `src/features/agents/__tests__/TerminalPanel.test.tsx`, `src-tauri/src/commands/dispatch.rs`, `src-tauri/src/services/dispatch.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/tests/task_transition_tests.rs`, `TICKETS.md`.

- 2026-03-20 06:43:29 CDT — `implementer -> DISPATCH-018`
  Status: PASS
  Summary: Implemented the DISPATCH-017 structured direct-dispatch resolver in Rust. `src-tauri/src/services/dispatch.rs` now normalizes dispatch input, resolves structured agent profiles into a final `program`, `argv`, `env`, and `cwd` without any shell interpolation path, rejects the placeholder `Auto` mode for now, loads optional task context for `task_title` and `task_body`, resolves inherited and secret environment values, and feeds the resolved launch plan into the single PTY spawn path. `src-tauri/src/commands/dispatch.rs` exposes the typed `dispatch_agent` Tauri command with command-scoped validation/error mapping, and `src-tauri/src/lib.rs` registers that IPC entrypoint. The new `src-tauri/tests/dispatch_validation_tests.rs` suite covers final argv resolution, quote/newline preservation, shell-metacharacter payloads staying single argv entries, blank prompt rejection, missing task/env lookup failures, and unknown project/profile handling.
  AC coverage: AC1 PASS. Structured agent args now resolve literals plus prompt, project-path, task-title, and task-body placeholders into a final argv vector through `services/dispatch.rs`, with direct regression coverage in `dispatch_validation_tests.rs`. AC2 PASS. Direct dispatch resolves into `TerminalLaunchRequest` values and hands those values to `pty_manager::create_terminal_session(...)`; there is no `sh -c`, quoting pass, or string-template execution path, and `pty_manager.rs` continues to spawn via `portable_pty::CommandBuilder` with structured args/env fields. AC3 PASS. `dispatch_validation_tests.rs` explicitly covers quotes, newlines, shell-injection strings, blank prompt rejection, missing task context, missing inherited/secret env values, and unknown project/profile/task lookups.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test dispatch_validation_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/dispatch.rs`, `src-tauri/src/commands/dispatch.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/services/terminal_ws.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/dispatch_validation_tests.rs`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_ws_attach_tests.rs`, `src-tauri/migrations/001_init.sql`, `src-tauri/src/models/task.rs`, `ROADMAP-v2.md`.

- 2026-03-20 06:34:56 CDT — `implementer -> DISPATCH-017`
  Status: PASS
  Summary: Implemented the DISPATCH-016 backend registry layer for structured agent profiles. `src-tauri/migrations/002_agent_profiles.sql` adds the `agent_profiles` table plus default Codex, Claude Code, and Gemini rows; `src-tauri/src/models/agent_profile.rs` introduces the typed `AgentProfile`, `AgentArg`, `AgentEnvValue`, and `AgentCwd` structures used to persist structured execution data instead of raw shell command templates; `src-tauri/src/services/agent_registry.rs` now owns profile listing, lookup, save/delete mutation, validation, and the synthetic `Auto` registry entry; and `src-tauri/src/commands/agent_profiles.rs` exposes list/mutate IPC commands wired through `src-tauri/src/lib.rs`. The schema smoke suite now expects migration `002_agent_profiles`, and new Rust tests cover seeded defaults, structured persistence, reserved-id validation, and IPC mutation behavior.
  AC coverage: AC1 PASS. `agent_profiles` storage now exists through migration `002_agent_profiles.sql`, and a fresh database seeds Codex, Claude Code, and Gemini defaults; this is verified in `db_schema_smoke.rs` and `agent_registry_tests.rs`. AC2 PASS. The backend now lists, fetches, saves, and deletes structured profiles through `agent_registry.rs` and `commands/agent_profiles.rs`, storing `program`, typed `args`, typed `env`, and typed `cwd` JSON fields rather than a rendered shell command template string; `agent_profile_commands_smoke.rs` also asserts the IPC payload omits any raw `command` field. AC3 PASS. `list_agent_registry_entries()` now exposes `Auto` as the first registry option while leaving stored profiles as explicit `profile` entries, with direct coverage in `agent_registry_tests.rs` and `agent_profile_commands_smoke.rs`.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test db_schema_smoke --test agent_registry_tests --test agent_profile_commands_smoke` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/migrations/002_agent_profiles.sql`, `src-tauri/src/models/agent_profile.rs`, `src-tauri/src/services/agent_registry.rs`, `src-tauri/src/commands/agent_profiles.rs`, `src-tauri/src/db/migrate.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/tests/agent_registry_tests.rs`, `src-tauri/tests/agent_profile_commands_smoke.rs`, `src-tauri/tests/db_schema_smoke.rs`.

- 2026-03-20 06:26:57 CDT — `implementer -> DISPATCH-016`
  Status: PASS
  Summary: Implemented the DISPATCH-015 Agents terminal workspace across the frontend shell and typed Tauri bridge. `src/app/TabHost.tsx` now mounts `AgentsTab` instead of the placeholder, `src/features/agents/AgentsTab.tsx` adds the terminal workspace shell, `src/features/agents/SessionSidebar.tsx` renders persisted sessions with status plus elapsed time, and `src/features/agents/TerminalPanel.tsx` hosts xterm-backed websocket viewports that stay mounted across session switches so inactive PTYs remain attached instead of being torn down. `src/features/agents/store/agentsSlice.ts` now owns terminal workspace initialization, session selection, create-session flows, typed websocket base-url state, and an explicit forced refresh path; `src/shared/lib/tauri.ts` and `src/store/index.ts` wire the typed terminal commands and store slice into the app shell. The frontend now ships with the roadmap xterm dependency set in `package.json`, backend-style session id labels use a readable `pid:sequence` suffix, and `scripts/smoke/phase-2-terminal-core.sh` provides a terminal-core smoke path spanning Rust PTY suites, the new component tests, and a production frontend build.
  AC coverage: AC1 PASS. The sidebar now lists multiple PTY sessions with per-session status text and elapsed time via `SessionSidebar.tsx`, backed by typed `TerminalSessionRecord` data loaded through `get_terminal_workspace`. AC2 PASS. `TerminalPanel.tsx` mounts one websocket/xterm viewport per session and only toggles visibility on selection changes, so switching sessions keeps inactive terminals mounted and does not close their sockets or remount the terminal instances; this is covered in `TerminalPanel.test.tsx`. AC3 PASS. Component tests now cover terminal readiness flow, session selection, and persistent mount behavior using backend-style `session-{pid}-{nanos}-{seq}` ids and mocked websocket/xterm plumbing.
  Command summary: `npx vitest run src/app/__tests__/TabHost.test.tsx src/features/agents/__tests__/TerminalPanel.test.tsx` PASS. `bash scripts/smoke/phase-2-terminal-core.sh` PASS.
  Next skill must read: `src/features/agents/AgentsTab.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/agents/SessionSidebar.tsx`, `src/features/agents/store/agentsSlice.ts`, `src/features/agents/__tests__/TerminalPanel.test.tsx`, `src/shared/lib/tauri.ts`, `src/app/TabHost.tsx`, `scripts/smoke/phase-2-terminal-core.sh`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/services/terminal_ws.rs`.

- 2026-03-20 06:13:19 CDT — `implementer -> DISPATCH-015`
  Status: PASS
  Summary: Implemented the PTY supervision layer expected by DISPATCH-014. `src-tauri/src/services/session_supervisor.rs` now owns stale-session reconciliation and the `AppLog/sessions` directory contract, while `src-tauri/src/services/pty_manager.rs` now supports configured supervision, per-session log capture, background exit polling that marks finished sessions and removes them from the in-memory registry, and deterministic Unix terminate sequencing that sends `SIGTERM` before `SIGKILL` after the grace window. `src-tauri/src/lib.rs` now wires startup reconciliation plus supervision configuration during app setup, and the mock IPC lane configures the same supervision path in `terminal_commands_smoke.rs` so terminal-command coverage exercises real session log writes.
  AC coverage: AC1 PASS. PTY termination now follows a two-step Unix path with `SIGTERM` first and `SIGKILL` after timeout, backed by a deterministic fake-child regression in `pty_manager_tests.rs`; non-Unix continues to use a portable kill fallback. AC2 PASS. App startup now marks stale `running` `agent_sessions` as `abandoned` through `session_supervisor::abandon_stale_running_sessions(...)`, with direct regression coverage in `pty_manager_tests.rs`. AC3 PASS. Session output is now appended under `AppLog/sessions/<session_id>.log`, and tests verify both command-created sessions and supervised background sessions write logs at that path while completed rows transition out of `running`.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test pty_manager_tests --test terminal_commands_smoke --test terminal_ws_attach_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/session_supervisor.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/services/terminal_ws.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_commands_smoke.rs`, `src-tauri/tests/terminal_ws_attach_tests.rs`, `src/features/agents/AgentsTab.tsx`, `src/features/agents/TerminalPanel.tsx`, `src/features/agents/SessionSidebar.tsx`, `src/features/agents/store/agentsSlice.ts`, `src/features/agents/__tests__/TerminalPanel.test.tsx`, `scripts/smoke/phase-2-terminal-core.sh`.

- 2026-03-20 05:54:04 CDT — `implementer -> DISPATCH-014`
  Status: PASS
  Summary: Implemented the attach-only PTY websocket transport expected by DISPATCH-013. `src-tauri/src/services/terminal_ws.rs` now hosts an Axum websocket server at `GET /ws/terminal/:session_id` that attaches only to existing running PTY-backed sessions, forwards binary PTY output, accepts resize messages, and supports reconnect without respawning processes. The transport now uses backend-owned `Arc<Database>` and `Arc<PtyManager>` state instead of a non-`Send` Tauri app handle, and the PTY output pump was hardened to run on a dedicated thread so synchronous session creation remains valid outside Tokio-managed tests and commands. Additional regression coverage now verifies missing/finished-session rejection, reconnect behavior, resize propagation, and the case where a live attached shell exits and the websocket closes while the persisted session row is marked finished.
  AC coverage: AC1 PASS. `terminal_ws::attach_terminal` rejects missing sessions, non-PTY sessions, finished sessions, and PTY rows not owned by the current backend process before upgrading the websocket. AC2 PASS. Structured resize messages are decoded in `terminal_ws.rs` and applied to the existing PTY via `ManagedTerminalSession::resize`, with verification in `terminal_ws_attach_tests.rs`. AC3 PASS. Reattaching to an existing `session_id` reuses the same PTY process and in-memory registry entry without creating a second shell, and the regression suite also verifies close-and-finish behavior when the attached process exits.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test pty_manager_tests --test terminal_commands_smoke --test terminal_ws_attach_tests` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/terminal_ws.rs`, `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/services/mod.rs`, `src-tauri/tests/terminal_ws_attach_tests.rs`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_commands_smoke.rs`, `src-tauri/Cargo.toml`.

- 2026-03-20 05:29:06 CDT — `implementer -> DISPATCH-013`
  Status: PASS
  Summary: Implemented the missing PTY/session foundation that the ticket graph expected from DISPATCH-012. Added `src-tauri/src/services/pty_manager.rs` as the Rust-owned PTY registry and single creation path, wired `create_terminal_session` into Tauri through `src-tauri/src/commands/terminal.rs`, registered the managed `PtyManager` state in `src-tauri/src/lib.rs`, and added Rust integration coverage for shell launch resolution, dispatch-style launch reuse, persisted `agent_sessions` rows, and IPC command wiring. This entry supersedes earlier ledger label ambiguity around DISPATCH-012 readiness: the PTY-backed session creation path is implemented here.
  AC coverage: AC1 PASS. Both raw shell sessions and dispatch-style sessions now route through `services::pty_manager::create_terminal_session(...)`, making it the single PTY creation path available to later dispatch work. AC2 PASS. PTY-backed sessions are inserted into `agent_sessions` before the command returns and before any websocket attach path exists, with persisted metadata verified in integration tests. AC3 PASS. `pty_manager_tests.rs` covers project cwd selection, shell selection, direct-dispatch reuse of the same spawn path, and persisted session metadata; `terminal_commands_smoke.rs` verifies the new Tauri command uses managed PTY state and returns a sanitized payload.
  Command summary: `cargo test --manifest-path src-tauri/Cargo.toml --test pty_manager_tests --test terminal_commands_smoke` PASS. `cargo test --manifest-path src-tauri/Cargo.toml` PASS. `cargo build --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/services/pty_manager.rs`, `src-tauri/src/commands/terminal.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/services/mod.rs`, `src-tauri/tests/pty_manager_tests.rs`, `src-tauri/tests/terminal_commands_smoke.rs`, `src-tauri/Cargo.toml`.

- 2026-03-19 23:38:05 CDT — `implementer -> DISPATCH-012 / DISPATCH-020`
  Status: PASS
  Summary: Wired the Phase 1 project UI on top of the existing Rust commands. `src/shared/lib/tauri.ts` now provides typed invoke helpers for health, project CRUD, and settings, `src/store/projectSlice.ts` owns project hydration plus `app.active_project_id` persistence in Zustand, `src/features/projects/ProjectSwitcher.tsx` replaces the top-bar stub with a real dropdown switcher/delete flow, and `src/features/projects/AddProjectDialog.tsx` adds the creation form that calls `create_project` and promotes the new project to active state. `src/features/projects/__tests__/ProjectSwitcher.test.tsx` covers empty, persisted active, add, switch, and remove flows with mocked `@tauri-apps/api/core` invokes, and `scripts/smoke/phase-1-projects.sh` now runs the React verification lane for this phase.
  AC coverage: AC1 PASS. Users can add, list, switch, and remove projects through the shell project switcher and add-project dialog backed by the real Tauri commands. AC2 PASS. The store restores `app.active_project_id` from settings on load, falls back safely when the saved project is missing, and persists add/switch/remove updates back through `set_setting`. AC3 PASS. `ProjectSwitcher.test.tsx` covers empty, populated, add, switch, and remove flows, and the phase smoke script exercises the full Vitest plus build lane.
  Command summary: `npx vitest run src/features/projects/__tests__/ProjectSwitcher.test.tsx` PASS. `npx vitest run` PASS. `npm run build` PASS. `scripts/smoke/phase-1-projects.sh` PASS.
  Next skill must read: `src/shared/lib/tauri.ts`, `src/store/projectSlice.ts`, `src/features/projects/ProjectSwitcher.tsx`, `src/features/projects/AddProjectDialog.tsx`, `src/features/projects/__tests__/ProjectSwitcher.test.tsx`, `src/shared/components/TopBar.tsx`, `scripts/smoke/phase-1-projects.sh`.

- 2026-03-19 23:12:30 CDT — `implementer -> DISPATCH-011`
  Status: PASS
  Summary: Added SQLite-backed settings commands and Rust-only secret handling for DISPATCH-010. `src-tauri/src/commands/settings.rs` now exposes `get_setting`, `set_setting`, and `list_settings` against the shared `Database`, returning structured JSON values instead of a frontend-owned store. `src-tauri/src/services/secrets.rs` adds `set_secret`, `get_secret_status`, `clear_secret`, and internal secret resolution with keychain-first lookup, inherited env fallback, and SQLite marker rows that record only secret presence. `src-tauri/src/models/setting.rs` now serializes/deserializes JSON payloads instead of exposing raw `value_json`, and `src-tauri/tests/settings_secret_tests.rs` locks down persistence, precedence, and the rule that raw secret values never land in SQLite or public settings APIs.
  AC coverage: AC1 PASS. Non-secret settings now persist through SQLite-only command helpers using the shared `Database`, with regression coverage in `settings_secret_tests.rs`. AC2 PASS. Secret commands now support `set_secret`, `get_secret_status`, and `clear_secret` with `keychain | env | missing` semantics and keychain-first precedence. AC3 PASS. The frontend-facing secret APIs return status only, while SQLite stores only a safe marker row and never the raw secret value.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `PATH=$HOME/.cargo/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml` PASS. `npm run build` PASS.
  Next skill must read: `src-tauri/src/commands/settings.rs`, `src-tauri/src/services/secrets.rs`, `src-tauri/src/models/setting.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/settings_secret_tests.rs`, `src-tauri/src/db/mod.rs`, `src-tauri/Cargo.toml`.

- 2026-03-19 22:35:56 CDT — `implementer -> DISPATCH-010 / DISPATCH-011`
  Status: PASS_WITH_HOST_GAP
  Summary: Added the Phase 1 project registry and path guard backend. `src-tauri/src/services/project_registry.rs` now canonicalizes project roots before insert, trims names, rejects duplicate canonical roots, and serves DB-backed list/get/delete flows through the shared `Database`. `src-tauri/src/services/path_guard.rs` now resolves project-relative paths against registered roots, rejects `..` traversal, rejects absolute inputs, and blocks both live and broken symlink escapes. `src-tauri/src/commands/projects.rs` adds the `create_project`, `list_projects`, `get_project`, and `delete_project` Tauri commands with shared helper functions so the backend surface is ready for frontend wiring. New integration coverage in `src-tauri/tests/projects_db_tests.rs` and `src-tauri/tests/path_guard_tests.rs` locks down canonicalized CRUD payloads plus traversal/symlink escape rejection.
  AC coverage: AC1 PASS. `create_project` stores only canonicalized root paths and rejects duplicate canonical roots before insert, with regression coverage in `projects_db_tests.rs`. AC2 PASS in code and regression coverage: `assert_project_relative(database, project_id, relative_path)` rejects `..` traversal, absolute paths, live symlink escapes, and broken symlink escapes, while still allowing safe project descendants. AC3 PASS in backend code path: the new project CRUD commands expose the canonical project root path returned from the registry helpers and never return unchecked user input; direct Tauri IPC execution was not runnable on this host because Cargo cannot finish the Tauri dependency graph here.
  Command summary: `cargo fmt --manifest-path src-tauri/Cargo.toml` PASS. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` FAIL on pre-existing formatting drift in unrelated files that were intentionally left untouched: `src-tauri/build.rs`, `src-tauri/src/app_state.rs`, `src-tauri/src/commands/health.rs`, and `src-tauri/src/main.rs`. `npm run build` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test projects_db_tests --test path_guard_tests` FAIL on this host before Rust compilation reaches the new tests because the Tauri native prerequisites are still missing: `gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, `atk`, `libsoup-3.0`, and `javascriptcoregtk-4.1`.
  Next skill must read: `src-tauri/src/services/project_registry.rs`, `src-tauri/src/services/path_guard.rs`, `src-tauri/src/commands/projects.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/projects_db_tests.rs`, `src-tauri/tests/path_guard_tests.rs`, `src-tauri/src/db/mod.rs`, `src-tauri/src/models/project.rs`.
- 2026-03-19 21:52:19 CDT — `implementer -> DISPATCH-009`
  Status: PASS_WITH_HOST_GAP
  Summary: Added the first Rust-owned SQLite foundation for Dispatch: `001_init.sql` now creates the Phase 1 `projects`, `tasks`, `agent_sessions`, and `settings` tables with DB-level checks and secondary indexes; `src-tauri/src/db/` now opens the SQLite file in the Tauri app data directory, applies pragmas, tracks applied migrations in `dispatch_migrations`, and exposes a managed `Database` state for later services; and the new plain model structs plus `db_schema_smoke.rs` define and verify the expected persistence surface for follow-on ticket work.
  AC coverage: AC1 PASS. AC2 PASS in code and test coverage design: the DB bootstrap is Rust-only, resolves from `app_handle.path().app_data_dir()`, and is wired in `src-tauri/src/lib.rs`. AC3 IMPLEMENTED: the new `src-tauri/tests/db_schema_smoke.rs` initializes a fresh DB, checks schema tables/columns/indexes/foreign keys, and asserts migration idempotency.
  Command summary: `python3` SQLite smoke against `src-tauri/migrations/001_init.sql` PASS. `npm run build` PASS. `cargo test --manifest-path src-tauri/Cargo.toml --test db_schema_smoke` FAIL on this host before Rust compilation reaches the new DB code because the Tauri GTK prerequisites are still missing: `gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, and `atk`.
  Next skill must read: `src-tauri/migrations/001_init.sql`, `src-tauri/src/db/mod.rs`, `src-tauri/src/db/migrate.rs`, `src-tauri/tests/db_schema_smoke.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models/project.rs`, `src-tauri/src/models/task.rs`, `src-tauri/src/models/agent_session.rs`, `src-tauri/src/models/setting.rs`.
- 2026-03-19 21:06:36 CDT — `implementer -> DISPATCH-008`
  Status: PASS_WITH_HOST_GAP
  Summary: Added the first Phase 0B test harness: a Vitest + Testing Library `TabHost` spec that proves heavy tabs mount lazily exactly once and remain mounted across switches, a Rust `app_boot_smoke` integration test that exercises the shared Tauri state/health builder wiring, and a `scripts/smoke/phase-0b-shell.sh` gate that runs both suites and reports the failing step loudly.
  AC coverage: AC1 PASS. AC2 IMPLEMENTED and wired against the real `AppState` + `health` command path through a shared `configure_app(...)` builder. AC3 PASS.
  Command summary: `npm test -- src/app/__tests__/TabHost.test.tsx` PASS. `npm run build` PASS. `scripts/smoke/phase-0b-shell.sh` FAIL on this host because Cargo cannot compile Tauri GTK bindings without `gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, and `atk` pkg-config packages installed; the React lane passes and the script now reports `phase-0b shell smoke failed during: Rust app boot smoke`.
  Next skill must read: `src/app/__tests__/TabHost.test.tsx`, `src-tauri/tests/app_boot_smoke.rs`, `scripts/smoke/phase-0b-shell.sh`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`.
- 2026-03-19 20:44:28 CDT — `implementer -> DISPATCH-007`
  Status: PASS_WITH_HOST_GAP
  Summary: Added Rust-owned startup logging that resolves the Tauri app log directory, creates `dispatch.log`, rotates archived `dispatch.*.log` files, and installs a panic hook that writes timestamped `panic-*.log` files beside the main log. Reworked the shared React error boundary into a recoverable surface fallback, wrapped each panel tab individually, and kept overlay failures scoped to their own boundary so the shell stays mounted.
  AC coverage: AC1 IMPLEMENTED, runtime verification blocked by missing Linux Tauri system packages on this host. AC2 PASS by code path and panic file writer wiring. AC3 PASS.
  Command summary: `npm run build` PASS. `cargo check` BLOCKED by missing `gdk-3.0`, `gdk-pixbuf-2.0`, and `pango` pkg-config packages on this machine before Cargo could finish the Tauri dependency graph. `rustfmt --check src/logging.rs src/error.rs src/lib.rs` PASS.
  Next skill must read: `src-tauri/src/logging.rs`, `src-tauri/src/error.rs`, `src-tauri/src/lib.rs`, `src/shared/components/ErrorBoundary.tsx`, `src/app/TabHost.tsx`, `src/app/App.tsx`.
- 2026-03-19 20:02:24 CDT — `implementer -> DISPATCH-005 / DISPATCH-006`
  Status: PARTIAL_PASS
  Summary: Scaffolded the real Tauri v2 + React 19 workspace, added the canonical repo layout under `src/` and `src-tauri/`, created the provider/store entry points, wired a typed frontend `health` invoke wrapper, and added the minimal Rust `health` command plus `tauri::Builder` boot path.
  AC coverage: AC2 PASS. AC3 PASS. AC1 code path is ready but local verification is blocked by missing Ubuntu Tauri native prerequisites (`gdk-3.0`, `gdk-pixbuf-2.0`, `pango`, `atk`) on this host.
  Command summary: `npm install` PASS. `npm run build` PASS. `cargo build` BLOCKED by missing system GTK/WebKit headers. `npm run tauri dev` BLOCKED by the same host prerequisite gap after Vite started successfully.
  Next skill must read: `CONTEXT_PACKAGE.md`, `package.json`, `src/app/App.tsx`, `src/app/providers.tsx`, `src/shared/tauri/health.ts`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/health.rs`, `src-tauri/tauri.conf.json`.
- 2026-03-19 20:14:11 CDT — `implementer -> DISPATCH-005`
  Status: PASS_WITH_GAP
  Summary: Replaced the scaffold landing page with the dark Dispatch shell, added a static project switcher + runtime/status top bar, split panel tabs from overlay surfaces in the UI store, implemented mount-once lazy tab hosting for Agents/Files/History/Chat, and added mount/unmount overlays for Tasks and Settings.
  AC coverage: AC1 PASS. AC2 PASS. AC3 PASS.
  Command summary: `npm run build` PASS. `npm test` FAIL because the repo still has no Vitest files; shell/component coverage is scheduled for `DISPATCH-007`.
  Next skill must read: `src/app/App.tsx`, `src/app/TabHost.tsx`, `src/shared/components/TopBar.tsx`, `src/shared/components/TabBar.tsx`, `src/store/uiSlice.ts`, `src/styles/globals.css`, `src/features/settings/SettingsPlaceholder.tsx`.

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
  - `src-tauri/migrations/004_save_points.sql`
  - `src-tauri/src/services/history/mod.rs`
  - `src-tauri/tests/save_point_tests.rs`

### DISPATCH-029 — Implement Dispatch Ref Creation and Lifecycle Hooks
- **Phase**: Phase 6 — History v1
- **Description**: Create pre/post/manual/latest refs under the Dispatch save-point namespace and hook save-point creation into run lifecycles so agent work is recoverable without polluting branch history.
- **Acceptance Criteria**:
  - Pre-run save points are created even on clean repos.
  - Direct and orchestrated runs write project-scoped refs under `refs/dispatch/save-points/{project_id}/*` and update `refs/dispatch/save-points/{project_id}/latest`.
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
  - `src-tauri/migrations/005_chat_cache.sql`
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

### DISPATCH-049 — Skills Dropdown on Task Cards
- **Phase**: Post-v1
- **Description**: Add a skills multi-select dropdown to the task detail drawer so users can tag tasks with agent skills (e.g. `test-writer`, `review`, `brainstorm`) that get injected into the dispatch prompt. Lightweight approach: `skills_json TEXT DEFAULT '[]'` column on `tasks`, multi-select UI in TaskDetailDrawer, and interpolation in the dispatch service prompt template.
- **Acceptance Criteria**:
  - Tasks have an optional `skills` field stored as JSON array of skill name strings.
  - TaskDetailDrawer shows a multi-select dropdown for choosing skills.
  - KanbanCard displays selected skills as compact badges.
  - Dispatch service includes selected skills in the prompt sent to the agent.
  - Migration adds `skills_json` column to `tasks` table.
- **Dependencies**: None (post-v1, builds on existing task + dispatch infrastructure)
- **Estimated Hours**: 6
- **Priority**: P3
- **Key Files**:
  - `src-tauri/migrations/004_task_skills.sql`
  - `src-tauri/src/models/task.rs`
  - `src/shared/lib/tauri.ts`
  - `src/features/tasks/TaskDetailDrawer.tsx`
  - `src/features/tasks/KanbanCard.tsx`
  - `src-tauri/src/services/dispatch.rs`
