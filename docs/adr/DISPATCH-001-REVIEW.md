# DISPATCH-001 Review

**Verdict**: PASS

**Acceptance Criteria Checklist**

- [x] `docs/adr/0001-runtime-boundaries.md` explicitly assigns SQLite, secrets, filesystem, PTYs, and OpenClaw connectivity to Rust, while limiting frontend state to UI concerns.
  Evidence: the ownership table assigns projects/tasks/session storage, secrets, filesystem read/search/watch, PTY lifecycle/transport, and OpenClaw connectivity to the Rust backend; frontend state is limited to UI-only Zustand state and other non-authoritative view state.
- [x] `docs/adr/0002-terminal-lifecycle.md` states that `create_terminal_session()` is the only PTY creation path and `GET /ws/terminal/:session_id` only attaches.
  Evidence: the lifecycle invariants state `create_terminal_session()` is the single PTY creation path, `dispatch_agent()` delegates into it, and `GET /ws/terminal/:session_id` never spawns, recreates, or inserts a session.
- [x] Disconnect, reconnect, and shutdown behavior for PTY-backed sessions is documented with no unresolved TODOs.
  Evidence: websocket disconnect is detach-only, reconnect reattaches to the same live PTY, shutdown drains owned PTYs in Rust, user kill is defined, natural exit is defined, and crash recovery marks stale running sessions `abandoned`. A direct `TODO`/`TBD`/`FIXME` scan of both ADRs returned no unresolved markers.

**Issues Found**

1. Severity: none. No blocking issues found. The ADRs are consistent with the ROADMAP locked decisions and non-negotiables: Rust owns SQLite/secrets/filesystem/PTYs/OpenClaw, frontend state remains UI-only, websocket attach is not a spawn path, shell-string interpolation is rejected, arbitrary frontend filesystem access is rejected, and PTY cleanup/reconciliation ownership remains in Rust. The terminal lifecycle is complete for create, attach, detach, reconnect, kill, shutdown, and crash recovery.

**Suggestions**

1. Minor: add one sentence to `docs/adr/0002-terminal-lifecycle.md` defining the failure-path semantics if the session row is persisted but PTY spawn fails, so later implementation does not need to infer whether that row is marked failed, cleaned up, or retained with terminal error metadata.
2. Minor: clarify whether more than one websocket client may attach to the same `session_id` concurrently, and if so, how stdin ownership or conflict is handled. The ADR is clear on reattach semantics but silent on concurrent attach policy.

Ready to commit and advance to DISPATCH-002.
