# Dispatch v1 Scope Checklist

Use this checklist to evaluate new tickets, PRs, and scope-change requests against the Phase 0A architecture lock.

## Scope Authority

- [ ] `ROADMAP.md` plus accepted ADRs are the release-scope authority when `PRD.md` still contains broader draft ideas.
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

- [ ] PTY creation happens in one place only through the Rust-owned terminal creation path.
- [ ] Direct CLI dispatch uses structured `program`, `args[]`, `env`, and `cwd`, not shell-string templates.
- [ ] Rust is the only database owner.
- [ ] Rust is the only filesystem owner.
- [ ] `agent_sessions` exists in the early foundation schema before terminal work begins.
- [ ] `chat_messages` is part of the initial Rust-owned schema even though the Chat tab lands later.
- [ ] Secrets never land in SQLite or a frontend JSON settings store.
- [ ] Save points live only under `refs/dispatch/save-points/*`.
- [ ] Every phase ships with at least one verification lane: Rust tests, component tests, or smoke scripts.

## Scope Notes

- [ ] Browser remains a deferred surface after v1 release; any later implementation is handled as a separate post-v1 lane.
- [ ] Voice input remains deferred; no microphone UI or partial transcription flow lands in v1.
- [ ] Branch-safe revert stays out of v1; restore in v1 works directly from Dispatch save points without creating a new branch commit.
- [ ] PR creation and review automation remain post-v1 even though chat and review routing are in v1.
