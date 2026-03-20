# DISPATCH-005 Review

Verdict: NEEDS_FIXES

## Findings

1. P2 Accessibility: the overlay dialog is not keyboard-contained or focus-managed. [src/app/App.tsx:91](/home/oso0x/projects/dispatch/src/app/App.tsx#L91)
   The dialog sets `role="dialog"` and `aria-modal="true"`, but focus is never moved into it, focus is not restored to the opener on close, and the obscured shell remains tabbable behind the backdrop. That breaks keyboard navigation and does not match modal expectations for assistive tech. Fix by capturing the opener, focusing the dialog or close button on mount, containing `Tab` while the overlay is open, and restoring focus when it closes.

2. P3 Accessibility: the project switcher is rendered as an enabled button with no behavior. [src/shared/components/TopBar.tsx:53](/home/oso0x/projects/dispatch/src/shared/components/TopBar.tsx#L53)
   Keyboard and screen-reader users are presented with a control that looks actionable but does nothing on `Enter` or `Space`. Either wire a real placeholder action with the right ARIA semantics, or make this a non-interactive container / disabled button until the switcher exists.

3. P3 Design system: `TopBar` bypasses the shared Dispatch styling tokens with one-off colors. [src/shared/components/TopBar.tsx:58](/home/oso0x/projects/dispatch/src/shared/components/TopBar.tsx#L58) [src/shared/components/TopBar.tsx:73](/home/oso0x/projects/dispatch/src/shared/components/TopBar.tsx#L73) [src/shared/components/TopBar.tsx:93](/home/oso0x/projects/dispatch/src/shared/components/TopBar.tsx#L93) [src/shared/components/TopBar.tsx:98](/home/oso0x/projects/dispatch/src/shared/components/TopBar.tsx#L98)
   The new shell work introduces `dispatch-*` classes and `--accent-*` variables in [src/styles/globals.css](/home/oso0x/projects/dispatch/src/styles/globals.css), but these icon colors still use hard-coded Tailwind hex utilities. Move those accents into the shared CSS variable / class layer so the shell stays consistent with the design system.

4. P3 Ticket ledger accuracy: the new worklog entry is tagged to the wrong tickets. [TICKETS.md:110](/home/oso0x/projects/dispatch/TICKETS.md#L110)
   The summary and AC references describe the DISPATCH-005 shell work, but the ledger entry is labeled `implementer -> DISPATCH-006 / DISPATCH-007`. Fix the ticket IDs or split the note so the recorded implementation history stays trustworthy.

## Acceptance Criteria

- AC1: Met. The dark top bar and tab shell are in place.
- AC2: Met. `agents`, `files`, `history`, and `chat` now lazy-mount once and remain mounted after first open.
- AC3: Met. `tasks` and `settings` are overlay-only and unmount when closed.

## Checks

- `npm run build`: PASS
- `npm test`: FAIL (`vitest` reports `No test files found`; expected until DISPATCH-007 adds shell tests)
- `git diff --check`: PASS

## Notes

- Reviewed all modified files in the working tree, including `TICKETS.md`.
- TypeScript compiled cleanly and I did not find new `any` or `unknown` leaks in the changed code.
