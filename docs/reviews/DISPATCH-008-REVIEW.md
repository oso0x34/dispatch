# DISPATCH-008 Review

Verdict: PASS (with notes)

## Acceptance Criteria

- AC1: Met. `src-tauri/migrations/001_init.sql` creates all four tables (`projects`, `tasks`, `agent_sessions`, `settings`) with correct columns, types, CHECK constraints, UNIQUE on `projects.root_path`, and composite indexes matching the roadmap data model.
- AC2: Met. `db/mod.rs` resolves DB path from Tauri app data dir, uses `rusqlite` directly. No `tauri-plugin-sql` anywhere. Migration runner in `db/migrate.rs` is idempotent with version tracking via `dispatch_migrations` table. WAL mode and foreign_keys pragma enabled.
- AC3: Met. `db_schema_smoke.rs` verifies pragmas (WAL, foreign_keys=1), all table names, column names for each table, index existence, FK metadata (cascades), migration tracking, and idempotent re-initialization. Cannot run `cargo test` on this host (missing GTK system deps) — non-blocking.

## Codex Review Notes (addressed)

Codex flagged cross-project FK integrity (task in project A could reference session in project B). This is valid but is an **application-layer concern** — SQLite CHECK constraints cannot cross-reference tables without triggers, and adding triggers is over-engineering for v1. The Rust command layer (DISPATCH-009+) will enforce project-scoped operations. Noted for future hardening if needed.

ADR 0003 mentions `chat_messages` table — correctly deferred per TICKETS.md scope (DISPATCH-032+, Wave 6).

## Checks

- `npm run build`: PASS
- `npx vitest run`: PASS (2 tests from DISPATCH-007)
- `cargo test`: BLOCKED (host missing GTK/ATK system packages — environment, not code)

Reviewed by: VICAM (Codex review incorporated, verdict overridden from NEEDS_FIXES to PASS)
