# ADR 0002: Terminal Session Lifecycle and Attach-Only WebSocket Transport

- Status: Accepted
- Date: 2026-03-19
- Deciders: Dispatch Phase 0A architecture lock
- Related: `ROADMAP.md`, `PRD.md`, `TICKETS.md`

## Context

Dispatch has to support three user-visible terminal behaviors:

- a raw "New Terminal" shell
- a direct CLI agent run started from task or agent controls
- durable terminal tabs that survive React remounts and websocket reconnects

The failure mode to avoid is accidental PTY duplication. If a websocket endpoint, React mount, or reconnect path can spawn a process, the app will create ghost sessions, race session metadata, and leak background processes.

This ADR freezes PTY creation, websocket attach semantics, disconnect behavior, reconnect behavior, and shutdown ownership before any terminal code is written.

## Decision

Dispatch treats PTY sessions as Rust-owned resources with one creation path and a separate attach path.

### Lifecycle Invariants

1. `create_terminal_session()` is the only PTY creation path.
   Every PTY-backed session, including raw shells and dispatch-launched agent runs, is created through this function.

2. `dispatch_agent()` does not spawn independently.
   It resolves `program`, `args[]`, `env`, and `cwd`, then delegates to `create_terminal_session()` so dispatch and manual terminals share the same persistence and supervision path.

3. PTY-backed sessions are persisted before any websocket attach occurs.
   `agent_sessions` must contain the session record before the frontend is allowed to open `GET /ws/terminal/:session_id`.

4. `GET /ws/terminal/:session_id` only attaches.
   The websocket endpoint loads an existing session, verifies that it is attachable, and binds transport streams. It never spawns a process, recreates a process, or inserts a new session row.

5. Websocket connectivity is not session ownership.
   A websocket disconnect detaches the client transport only. It does not terminate the PTY, delete session metadata, or change the session identifier.

6. Reconnects reattach.
   If the PTY is still alive, a later websocket connection to the same `session_id` attaches to that same running session. Reconnect never creates a second PTY for the same session.

7. Shutdown cleanup belongs to Rust.
   When the app shuts down, Rust drains all owned PTY sessions, waits for graceful exit, escalates if required, records final session state, and closes websocket transports as a consequence of process shutdown.

8. Crash recovery never respawns silently.
   If the app exits before cleanup finishes, the next startup reconciles stale sessions. Sessions that were previously marked running but no longer have a live owned child are marked `abandoned`; they are not auto-recreated.

### Attachability Rules

`GET /ws/terminal/:session_id` may attach only when all of the following are true:

- the session exists in `agent_sessions`
- the session was created as a PTY-backed session
- the PTY child is still running and owned by the current backend process
- the terminal websocket server has finished binding and is ready to accept attachments

The endpoint rejects:

- unknown session ids
- finished sessions
- abandoned or otherwise non-running sessions
- requests that arrive before terminal websocket readiness is reported

Historical output replay is not part of attach semantics. A reconnect resumes live I/O on the existing PTY; missed output during a disconnect belongs to session logs or later history surfaces, not to implicit respawn behavior.

## Lifecycle Sequence

```text
Create path
-----------
React action
  -> Tauri command / typed backend call
  -> Rust create_terminal_session()
  -> persist agent_sessions row
  -> spawn PTY and register supervisor ownership
  -> return session metadata + attach info
  -> frontend opens GET /ws/terminal/:session_id

Attach path
-----------
frontend websocket connect
  -> GET /ws/terminal/:session_id
  -> Rust loads existing session
  -> if running, bind stdin/stdout/resize transport
  -> if missing or finished, reject

Reconnect path
--------------
frontend websocket disconnect
  -> PTY keeps running
later frontend reconnect
  -> GET /ws/terminal/:session_id
  -> Rust reattaches to the same live PTY
```

## Event Semantics

| Event | PTY process | Session record | Websocket behavior |
| --- | --- | --- | --- |
| `create_terminal_session()` succeeds | Spawn exactly once | Inserted immediately, then updated as runtime metadata becomes available | No socket yet; attach happens afterward |
| Initial attach succeeds | Already running | Unchanged except transient attachment bookkeeping | Live stdin/stdout/resize channel is bound |
| Websocket disconnect | Keeps running | Remains the same running session | Transport closes only |
| Websocket reconnect | Same PTY reused | Same `session_id`; no duplicate row | New transport attaches to the existing session |
| User kill action | Graceful terminate first, force-kill after timeout if needed | Marked finished with final metadata | Active sockets close because the session ended |
| Natural child exit | Process ends once | Exit metadata recorded; future attach rejected | Stream closes when process ends |
| App shutdown | Supervisor drains all live PTYs | Final state recorded before shutdown completes when possible | Attachments end as the backend terminates |
| Startup after prior crash/forced exit | No implicit respawn | Stale "running" sessions become `abandoned` if no owned child exists | Attach rejected until a new session is explicitly created |

## Rationale

- Single creation eliminates PTY duplication and metadata races.
- Persist-before-attach gives the frontend a durable identifier that survives component remounts and reconnects.
- Attach-only websocket semantics keep transport concerns separate from process creation.
- Detach-without-kill matches the product requirement that terminals remain alive while users switch tabs or reconnect.
- Explicit shutdown and crash-recovery rules satisfy the roadmap rule that no background process exists without cleanup ownership.

## Consequences

### Positive

- React can freely remount xterm components without risking extra child processes.
- Terminal sessions become durable application objects rather than websocket side effects.
- Direct dispatch and raw terminals share one supervision, persistence, and cleanup model.
- Later features such as session logs, task linkage, and multi-session sidebars build on a stable session identity.

### Costs

- The backend must maintain a PTY registry and startup reconciliation path.
- The frontend must respect a two-step flow: create first, then attach.
- Reconnect handling requires clear session-status checks instead of optimistic respawn shortcuts.

## Rejected Alternatives

### Spawn on websocket connect

Rejected because reconnects, remounts, or duplicate clients would create extra processes and break single-session identity.

### Tie PTY lifetime to xterm component lifetime

Rejected because tab switches, window refreshes, and websocket drops are UI concerns, not process lifecycle events.

### Kill the PTY whenever the websocket disconnects

Rejected because it would make terminal sessions fragile, break tab switching, and violate the requirement that reconnects attach rather than respawn.
