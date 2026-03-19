# ADR 0001: Runtime Boundaries

- Status: Accepted
- Date: 2026-03-19
- Deciders: Dispatch Phase 0A architecture lock
- Related: `ROADMAP.md`, `PRD.md`, `TICKETS.md`

## Context

Dispatch is a Tauri v2 desktop application with a React frontend and a Rust backend. The product requires local persistence, project-scoped filesystem access, PTY-backed agent execution, and optional OpenClaw connectivity. Those capabilities touch the OS, secrets, network sockets, and long-lived background processes.

Without an explicit ownership contract, the app would drift into split authority:

- React stores would become a second source of truth for project, task, or session data.
- Frontend code would start reaching for direct filesystem or settings plugins.
- PTY and socket lifecycle would become coupled to component mount state.
- Secrets or OpenClaw credentials could leak into browser-visible state.

This ADR freezes the runtime boundary before implementation so every later ticket builds against one authority model.

## Decision

Dispatch uses Rust as the authoritative owner for all persistent, privileged, and OS-facing domains. React owns presentation state only.

### Ownership Contract

| Domain | Canonical owner | Frontend role | Notes |
| --- | --- | --- | --- |
| Projects, tasks, agent sessions, chat cache, non-secret settings | Rust backend | Render returned DTOs; hold temporary view-model copies only | Stored in SQLite via `rusqlite 0.39.0` and migrations under `src-tauri/migrations/` |
| Secrets | Rust backend | Submit set/clear requests; display presence/status only | Stored via `keyring 3.6.3`; if keychain persistence is unavailable, Rust may read inherited env vars but must not persist the secret anywhere else |
| Filesystem read/search/watch | Rust backend | Request project-scoped operations and render results | Implemented with `notify 8.2.0`, `ignore 0.4.25`, `grep-searcher 0.1.16`, `grep-regex 0.1.14` |
| PTY lifecycle and transport | Rust backend | Render terminal output and collect user input through attach channels | Implemented with `portable-pty 0.9.0` and an `axum 0.8.8` websocket attach server |
| OpenClaw connectivity | Rust backend | Display normalized connection/session state and issue typed actions | Implemented with `tokio-tungstenite 0.28.0` and `reqwest 0.12.28` |
| Frontend state | React + Zustand | Own UI-only state | Tabs, panel layout, selection, draft form input, transient filters, terminal viewport preferences, and optimistic loading state |

### Boundary Rules

1. Rust is the only system of record for durable data.
   Project data, task data, session metadata, chat cache, and persisted settings are never authored directly in React stores.

2. Rust is the only holder of privileged capabilities.
   Secrets, filesystem access, PTY handles, OpenClaw auth, and long-lived OS resources do not cross into browser-managed memory except as redacted status or typed results.

3. The frontend may cache data for rendering, but that cache is non-authoritative.
   Any React or Zustand copy is disposable and must be reconstructible from Rust-owned commands, events, or websocket streams.

4. All frontend-to-backend crossings use explicit typed interfaces.
   The frontend talks to Rust through Tauri commands, app events, and attach-only websocket endpoints. No direct browser-side database, filesystem, or credential APIs are part of v1.

5. Filesystem access is project-root scoped.
   Frontend code submits `project_id` plus relative path or query intent. Rust canonicalizes paths and rejects traversal, symlink escape, or access outside a registered project root.

6. PTY and background-process ownership stays in Rust.
   React components may attach, detach, render, resize, and send input, but they never create, own, or clean up PTY child processes directly.

7. OpenClaw connectivity is a backend concern.
   Connection setup, retry policy, auth token lookup, socket lifecycle, and event normalization belong to Rust. The frontend consumes derived state and issues typed actions such as connect, disconnect, spawn, list, or kill.

8. New privileged capabilities default to Rust ownership unless a later ADR explicitly says otherwise.
   This includes future OS integrations, file mutation flows, save-point orchestration, background watchers, and external service clients.

### Locked Non-Negotiables

- No `tauri-plugin-sql` in v1.
- No `tauri-plugin-store` in v1.
- No `tauri-plugin-fs` in v1.
- No arbitrary filesystem access from the frontend.
- No shell-string interpolation for agent dispatch.
- No background process without cleanup ownership in Rust.

## Runtime Boundary Diagram

```text
+-----------------------------------------------------------+
| React frontend                                            |
|-----------------------------------------------------------|
| UI-only Zustand state                                     |
| - selected project, active tab, filters, drafts           |
| - panel sizes, scroll position, terminal viewport state   |
| - temporary optimistic/loading state                      |
+-----------------------------+-----------------------------+
                              |
                              | typed Tauri commands
                              | app events
                              | attach-only websocket sessions
                              v
+-----------------------------------------------------------+
| Rust backend                                              |
|-----------------------------------------------------------|
| Canonical services                                        |
| - SQLite models and migrations                            |
| - keyring/env secret resolution                           |
| - filesystem read/search/watch + path guards              |
| - PTY creation, supervision, logs, cleanup                |
| - OpenClaw REST/WS clients and reconnect logic            |
+-----------------------------------------------------------+
```

## Rationale

- Security: Secrets, filesystem access, process handles, and external sockets stay outside browser-visible code paths.
- Single source of truth: SQLite-backed project, task, and session data cannot diverge from frontend caches.
- Lifecycle safety: PTYs, watchers, and OpenClaw sockets need explicit cleanup ownership that component lifecycles cannot provide.
- Standalone and connected mode parity: Both direct CLI execution and OpenClaw integration converge through one backend authority model.
- Testability: Backend behavior can be covered with Rust unit and integration tests while React tests stay focused on rendering and interaction.

## Consequences

### Positive

- The architecture stays consistent across all later phases.
- React remains focused on UX rather than persistence, OS integration, or secret handling.
- Path safety, session cleanup, and reconnect behavior can be verified in Rust without depending on UI timing.
- Adding a second UI surface later still preserves one backend system of record.

### Costs

- More typed command/event design work is required up front in Rust.
- Some UX flows will need round-trips to Rust instead of ad hoc browser-side mutation.
- Frontend contributors cannot bypass backend contracts for convenience.

## Rejected Alternatives

### Store durable settings or records directly in the frontend

Rejected because it creates split authority and conflicts with the roadmap's single-owner SQLite decision.

### Expose arbitrary filesystem access to React

Rejected because it breaks project-root containment and would require trusting browser-side path validation.

### Let the frontend connect directly to OpenClaw

Rejected because auth, retry policy, and session normalization are backend concerns and must behave consistently in standalone and connected modes.

### Let React or xterm own PTY creation

Rejected because PTY handles are OS resources with shutdown and crash-recovery responsibilities that belong in Rust.
