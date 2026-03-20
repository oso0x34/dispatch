# ADR 0004: Project-Scoped History Save Points on Dispatch Refs

- Status: Accepted
- Date: 2026-03-19
- Deciders: Dispatch Phase 0A architecture lock
- Related: `ROADMAP.md`, `PRD.md`, `TICKETS.md`, `docs/adr/0001-runtime-boundaries.md`, `docs/adr/0002-terminal-lifecycle.md`, `docs/adr/0003-data-model.md`

## Context

Dispatch needs a recoverable history model for agent work, but it cannot pollute a user's branch layout or depend on shelling out to the git CLI. The product needs three save-point entry paths:

- automatic pre-agent save points
- automatic post-agent save points
- manual user-created save points

Earlier planning notes still described a provisional `refs/dispatch/runs/*` layout. The ticket for this turn requires a project-scoped `refs/dispatch/save-points/*` namespace instead. The PRD also describes save points in user-facing language such as "auto-commits before every agent run," which needed to be translated into a safer git contract that preserves recoverability without creating visible working branches.

This ADR freezes the save-point namespace, trigger rules, identity rules, and branch-pollution constraints before the history implementation starts.

## Decision

Dispatch creates save points as synthetic git commits referenced only through Dispatch-managed refs. History v1 uses `git2 0.20.4` for save-point creation, lookup, diffing, and restore flows.

### Namespace

The canonical save-point namespace is:

`refs/dispatch/save-points/{project_id}/{timestamp}-{label}`

The project-local "latest" ref is:

`refs/dispatch/save-points/{project_id}/latest`

Rules:

1. `{project_id}` is the stable Dispatch project id, not the filesystem path, repo name, or active branch name.
2. `{timestamp}` is the UTC Unix epoch second at creation time.
3. `{label}` is a normalized ASCII slug that is safe for a git ref path segment.
4. `latest` is a ref alias owned by Dispatch and always points to the most recently created save point for that project, regardless of whether the save point was automatic or manual.

Example refs:

- `refs/dispatch/save-points/proj_01/1773966900-pre-agent-sess_01`
- `refs/dispatch/save-points/proj_01/1773967128-post-agent-sess_01`
- `refs/dispatch/save-points/proj_01/1773967201-manual-before-refactor`
- `refs/dispatch/save-points/proj_01/latest`

### Save-Point Creation Rules

Dispatch creates save points in three ways.

#### Automatic pre-agent save points

- created immediately before a direct or orchestrated agent run begins
- required for both task-linked and freeform agent sessions
- created even when the repository is clean
- used as the recovery anchor if the agent run produces undesired changes

#### Automatic post-agent save points

- created after the agent session reaches a terminal state
- apply to successful, failed, canceled, and otherwise completed runs
- capture the post-run repository snapshot for diffing and restore operations

#### Manual save points

- created only from explicit user action
- use the same namespace as automatic save points
- use a normalized user-supplied label, or `manual` when no label is provided

### Label Policy

Dispatch owns label normalization.

Rules:

- labels are lowercased
- spaces become `-`
- unsupported characters are stripped or replaced before ref creation
- automatic labels use stable stage-oriented prefixes such as `pre-agent-...` and `post-agent-...`
- when a generated ref would collide within the same second, Dispatch appends a deterministic numeric suffix

The ref path is the canonical name. UI display labels may be richer, but they are derived data and do not change the stored ref name.

### Latest Ref Rule

`refs/dispatch/save-points/{project_id}/latest` is updated on every successful save-point creation and always points to the newest save point for that project.

Rules:

- `latest` is never repurposed for a branch or tag
- `latest` is project-scoped; there is no cross-project global latest ref
- if save-point creation fails, `latest` is left unchanged rather than moved to a partial result

### Git Identity Rule

Dispatch always writes synthetic author and committer identities:

- name: `Dispatch`
- email: `dispatch@local`

Rules:

- Dispatch never uses the user's configured git author identity for save-point commits
- both author and committer are set to the synthetic Dispatch signature
- commit messages may be user-facing, but the identity is always synthetic

### Branch-Pollution Rule

Dispatch never creates branches for save points.

Rules:

- save points are stored only as refs under `refs/dispatch/save-points/*`
- Dispatch does not create branch-per-run refs
- Dispatch does not create temporary visible feature branches as part of history v1
- restore flows resolve selected Dispatch refs directly; they do not create a recovery branch unless a future ADR explicitly introduces that behavior

### Activation Rule

History v1 activates only for projects whose root resolves to an existing git repository.

Rules:

- non-git projects do not trigger implicit `git init`
- save-point creation returns a typed unsupported state for non-git projects
- history support is project-scoped, not globally assumed

### Cleanup and Retention Rules

Save points are retained until a user removes them or the project itself is removed from Dispatch. History v1 does not run background age-based pruning.

Rules:

- users may delete an individual save point or run a project-scoped prune action to remove older save points in bulk
- project removal deletes Dispatch-owned save-point refs and related metadata for that project, but never deletes the repository itself
- when a save point is deleted or pruned, Dispatch must delete both the git ref and the matching Dispatch metadata row as one logical cleanup operation
- if ref deletion succeeds but metadata cleanup fails, or the reverse, the save point is treated as cleanup-incomplete and must be retried on next startup before it is shown as settled
- `latest` is derived, not independently retained: after any delete, prune, or project removal, Dispatch recomputes the newest remaining save point for that project and repoints `refs/dispatch/save-points/{project_id}/latest`
- if no save points remain for a project, Dispatch deletes `refs/dispatch/save-points/{project_id}/latest` instead of leaving a dangling alias

## Rationale

- Project-scoped refs make it obvious which Dispatch project produced a save point and avoid mixing histories in a multi-project desktop app.
- Using dedicated refs instead of branches keeps user branch history clean and avoids training users to think Dispatch has modified their branch model.
- Mandatory pre-agent save points, even on clean repositories, provide a deterministic rollback anchor before any automation touches the working tree.
- Post-agent save points make diffs and restore flows symmetrical: one anchor before work, one after.
- A synthetic committer makes Dispatch-generated history auditable without impersonating the user.
- `git2 0.20.4` keeps history operations in Rust with typed APIs and no shell-string escaping risk.

## Consequences

### Positive

- The History tab can list save points by a single canonical namespace.
- Users keep a clean branch list while still getting recoverable snapshots.
- Agent-run history becomes deterministic across direct CLI and orchestrated execution paths.
- Multi-project histories stay separated without relying on repo path parsing in the ref name.

### Costs

- Dispatch must maintain ref normalization, collision handling, and `latest` updates itself.
- Save-point commits still add objects to the repository database even though they do not appear as user branches.
- Restore and diff tooling must understand Dispatch refs explicitly rather than assuming standard branch names.

### Follow-on Constraints

- Later metadata tables may index save-point refs, but the ref namespace in this ADR remains the source of truth.
- Any future branch-based recovery feature must be introduced by a new ADR; v1 history is strictly ref-based.
- If the locked `git2-rs` version changes later, that change needs an explicit dependency update rather than silent drift.
