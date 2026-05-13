---
title: "Dispatch Visual Rebuild Spec"
type: design-spec
status: active
date: 2026-03-20
owners:
  - product
  - design
  - implementation
---

# Dispatch Visual Rebuild Spec

## Why This Exists

Dispatch was previously implemented from roadmap and ticket text that described architecture and feature scope well, but did not carry the actual visual source of truth. That caused the shell to drift into a competent utility UI instead of the product shown in the reference captures.

This document fixes that. It makes the real visual target explicit, repo-local, and binding for future shell work.

## Authority

- For shell, navigation, naming, spacing, density, hierarchy, and surface composition, this document is authoritative.
- If `ROADMAP-v2.md`, `TICKETS.md`, or any older planning artifact conflicts with this document on visual design, this document wins.
- `ROADMAP-v2.md` still governs architecture, ownership, persistence, release scope, and verification. It does not define the final product shell.
- The files `old-v.png` and `old-v-2.png` are historical only. They must not be used as implementation targets.

## Canonical References

These files are the current visual source of truth and are checked into the repo:

| File | Purpose |
| --- | --- |
| `docs/reference/visual-rebuild/files-main.png` | Files tab shell, explorer density, preview/editor split |
| `docs/reference/visual-rebuild/agents-main.png` | Agents tab shell, left rail width, overall density |
| `docs/reference/visual-rebuild/agents-terminal.png` | Agents terminal composition and terminal-forward feel |
| `docs/reference/visual-rebuild/agents-diff.png` | Agents terminal/diff output treatment |
| `docs/reference/visual-rebuild/browser.png` | Browser tab shell and embedded browser-row treatment |

Behavioral context was also derived from pre-release research notes that are
not part of the public repository.

The screenshots above are the binding visual references. The research notes are
supporting product context, not a substitute for the screenshots.

## Product Definition

Dispatch should feel like a calm native workspace for orchestrating software work across a repo. It is not a dashboard, not a settings-heavy admin tool, and not a marketing surface.

The default impression should be:

- native desktop app
- low chrome
- work-first layout
- terminal/editor density where appropriate
- clear project context
- minimal decorative framing

## Core Principles

### 1. Work Starts Immediately

The user should land inside work, not inside explanation. Surfaces should not begin with large hero cards, product copy, or stacked status banners.

### 2. Native, Not Dashboard

The app should read like an Electron/Tauri workspace, not like a web SaaS panel. Favor thin separators, low-contrast surfaces, compact controls, and titlebar-like navigation.

### 3. One Shell, Many Workspaces

There is one compact top strip. Tabs switch workspaces inside that shell. The shell should not reframe itself dramatically between tabs.

### 4. Information Density Matters

The references are denser than the current implementation. Controls should be compact, labels should do only necessary work, and content should dominate chrome.

### 5. Screenshots Beat Guesswork

If there is a choice between "what seems reasonable" and "what the reference shows," follow the reference.

## Global Shell Contract

### Top Strip

The top strip is a single integrated row with:

- app mark
- compact project/folder selector
- top tabs inline
- only lightweight utility actions on the right

Rules:

- no standalone `Projects` workspace tab
- `Settings` remains an overlay, not a primary tab
- tabs are compact and quiet, not pill-heavy or oversized
- top-right utilities stay minimal
- no large status area in the header

### Primary Tabs

Primary tabs are:

1. `Orchestrate`
2. `Tasks`
3. `Agents`
4. `Files`
5. `History`
6. `Browser`

If release scope temporarily hides `Browser`, that is a feature flag question, not a visual-language question. When visible, `Browser` must use the same shell contract as the other tabs.

## Surface Specs

### Orchestrate

Purpose:

- default control surface for the project
- transcript-first working area
- input dock for prompts and task creation

Must be:

- compact at the top
- transcript-dominant
- free of large intro/hero panels
- light on duplicated badges and status chips

Must not be:

- a feature demo
- a documentation panel
- a card stack with redundant metadata

### Tasks

Purpose:

- real main workspace, not an overlay-first feature

Must be:

- a full tab
- board-first or board-plus-detail workspace
- visually consistent with the rest of the shell

Must not be:

- hidden behind a modal-first flow
- visually louder than Agents or Files

### Agents

Purpose:

- primary terminal/orchestration workspace

Must be:

- terminal-forward
- thin-rail on the left
- visually flat
- dense and calm

Must not be:

- over-carded
- heavily boxed-in
- dominated by toolbar chrome

### Files

Purpose:

- explorer plus preview/editor split

Must be:

- simple
- low-chrome
- split-view oriented
- easy to scan

Must not be:

- a search dashboard
- dominated by oversized search controls
- overly boxed in the preview pane

### History

Purpose:

- save points, summaries, diffs, restore actions

Must be:

- visually consistent with the same low-chrome shell
- readable and utility-first

When exact visual detail is not fully shown in the references, follow the shell language established by Agents, Files, and Browser.

### Browser

Purpose:

- embedded local preview surface

Must be:

- a real browser-like workspace
- compact address/navigation row
- large preview canvas
- treated like a native tool surface

Must not be:

- two stacked marketing cards
- explanation-heavy
- dominated by policy text

## Reuse vs Rebuild

### Reuse

These parts are valuable and should be treated as reusable infrastructure:

- Rust backend ownership and commands
- SQLite schema and migrations
- PTY/session plumbing
- file/history/task backend behavior
- OpenClaw integration primitives
- most test intent

### Rebuild

These parts should not be preserved just because they already exist:

- app shell composition
- top-level information architecture where it conflicts with references
- tab interiors that still carry dashboard structure
- layout primitives that force extra chrome
- labels or flows created only to support the older shell

## Rebuild Process

The rebuild should happen in this order:

1. Freeze reference assets in repo.
2. Lock the shell contract from this document.
3. Rebuild the top strip and tab framing first.
4. Rebuild `Agents`, `Files`, and `Orchestrate` against the reference captures.
5. Refit `Tasks`, `History`, and `Browser` into the same visual system.
6. Do a final density and polish pass only after the structure is right.

Do not continue infinite local tweaks against the current shell if the current shell is still structurally wrong.

## Acceptance Criteria

Visual work is not done unless all of the following are true:

- each changed surface is compared directly against one of the canonical screenshots in `docs/reference/visual-rebuild/`
- no implementation decision relies on `old-v.png` or `old-v-2.png`
- shell/UI decisions reference this document when they are made
- the result feels closer because structure changed, not just because spacing changed
- `npm test` and `npm run build` still pass

## Guardrails

- No new shell or tab redesign work should start from roadmap prose alone.
- No visual "cleanup" PR should merge without checking against the canonical screenshots.
- If better screenshots replace the current ones, add the new dated assets to `docs/reference/visual-rebuild/` and update this document in the same change.
- If a surface is not clearly shown in the references, inherit the global shell language instead of inventing a new one.

## Current Decision

The current implementation contains reusable product infrastructure, but the shell should still be treated as rebuild-in-progress rather than canonical UI.
