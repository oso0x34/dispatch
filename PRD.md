# Dispatch — Product Requirements Document

> **Product Name:** Dispatch
> **Status:** Draft v1.2
> **Date:** 2026-03-19
> **Repo Target:** this repository

---

## 1. Vision

Dispatch is a **desktop command center** for AI-orchestrated software development. It gives a non-developer founder full visibility and control over multiple projects and AI agents from a single native app — without ever needing to open a browser tab, switch between terminals, or context-switch between tools.

**One app. All projects. All agents. Full control.**

### Two Audiences

1. **Connected mode** — OpenClaw is running. Dispatch connects to it for orchestrated dispatch, chat, and multi-model session management.
2. **Standalone mode** — No OpenClaw. Dispatch works as a standalone app with direct CLI spawning. Open a terminal, run `codex`, `claude`, `gemini`, or another local tool. Kanban, file browser, git save points, terminal tabs all function independently.

**OpenClaw is a supercharger, not a requirement.**

### Why This Exists

People building with AI agents today are juggling terminal windows, browser tabs, chat apps, and git CLIs. There's no single place to manage projects, dispatch tasks to agents, and watch them work — especially for non-developers who aren't comfortable living in a terminal.

Dispatch is that place.

### Why Not Orchestrate / Conductor / Vibe Kanban?

| Tool | Limitation |
|------|-----------|
| **Orchestrate** (Chris/Melty) | Mac-only, Electron (200MB+), Claude Agents SDK dependency, single-project, waitlist/closed source |
| **Conductor OSS** | CLI-first, no native desktop app, solo-dev project, limited agent model support |
| **Vibe Kanban** | No orchestration layer, no chat/AI dispatch, kanban-only |
| **Browser-based local tools** | Not native desktop apps and often require more context switching |

Dispatch takes the best ideas from all of these. When paired with OpenClaw, it gains orchestrated multi-model dispatch, persistent AI chat, and memory. Without it, it's still a fully functional project command center with terminals and task management.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | **Tauri v2** | Rust backend, system webview, ~5-10MB binary vs Electron's 200MB. Native performance, native OS integration. |
| **Backend** | **Rust + Axum** | Git operations, filesystem access, process management, PTY spawning, SQLite queries. Compiles to single binary. |
| **Frontend** | **React 19 + TypeScript** | Fast iteration, huge ecosystem, non-devs can follow along. Vite for bundling. |
| **Database** | **SQLite** (via `rusqlite`) | Local-first. Tasks, project configs, save points metadata, session history cache. |
| **Agent Layer (optional)** | **OpenClaw API** | When available: WebSocket streaming, session spawn/steer/kill, chat, multi-model dispatch. When absent: Dispatch dispatches agents directly via PTY. |
| **Agent Layer (standalone)** | **Rust PTY Manager** | Spawns CLI tools (Codex, Claude Code, Gemini CLI, etc.) directly in pseudo-terminals. No middleware needed. |
| **Styling** | **Tailwind CSS v4** | Utility-first, dark theme native, fast prototyping. |
| **State Management** | **Zustand** | Lightweight, no boilerplate, works great with React. |
| **Terminal** | **xterm.js** | Battle-tested terminal emulator for the web. PTY via Tauri Rust backend. |
| **Git** | **git2-rs** (libgit2 bindings) | Native git operations without shelling out. Diffs, history, revert, restore. |

### Why Tauri Over Electron

Chris used Electron because Claude Agents SDK is Node.js-native. We don't need the SDK — OpenClaw handles orchestration. Tauri gives us:
- **~5-10MB** app vs ~200MB Electron
- **Native Rust backend** — git, filesystem, process management are fast and safe
- **System webview** — no bundled Chromium
- **Better OS integration** — system tray, native menus, file associations
- **Lower memory footprint** — critical on a dev machine already running multiple agents

---

## 3. Architecture

```
┌──────────────────────────────────────────────────┐
│                      Dispatch                   │
│               (Tauri v2 Desktop App)              │
├──────────────────────────────────────────────────┤
│                                                   │
│   React Frontend (system webview)                 │
│   ┌──────┬──────┬──────┬──────┬──────┬─────────┐ │
│   │ Chat │Tasks │Agents│Files │History│ Browser │ │
│   └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴────┬────┘ │
│      │      │      │      │      │        │       │
├──────┴──────┴──────┴──────┴──────┴────────┴──────┤
│                                                   │
│   Tauri IPC Bridge                                │
│                                                   │
├──────────────────────────────────────────────────┤
│                                                   │
│   Rust Backend (Axum)                             │
│   ┌────────────┬────────────┬──────────────┐      │
│   │ GitManager │ PtyManager │ FileWatcher  │      │
│   ├────────────┼────────────┼──────────────┤      │
│   │ TaskStore  │ ProjectMgr │ SavePoints   │      │
│   ├────────────┼────────────┼──────────────┤      │
│   │ AgentRegistry (CLI configs per model)  │      │
│   └────────────┴────────────┴──────────────┘      │
│                                                   │
├──────────────────────────────────────────────────┤
│                                                   │
│   External Integrations                           │
│   ┌──────────────────┬──────────────────────┐     │
│   │ OpenClaw Gateway │  Direct CLI Spawning │     │
│   │ (WS + REST)      │  (PTY: codex, claude │     │
│   │ [OPTIONAL]       │   gemini, grok, etc) │     │
│   ├──────────────────┼──────────────────────┤     │
│   │       SQLite (local state — always)     │     │
│   └──────────────────┴──────────────────────┘     │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Dual Dispatch Model

Dispatch has **two ways to send work to agents:**

#### Path A: Orchestrated (OpenClaw connected)
1. Task card → "Send to Agent" → **Dispatch** button
2. Dispatch calls OpenClaw `sessions_spawn` with model + prompt
3. OpenClaw spawns the agent, monitors quality, can steer/kill
4. Output streams back via WebSocket → rendered in Agents tab
5. OpenClaw (AI) is in the loop — can auto-review, flag issues, redirect

#### Path B: Direct CLI (Standalone — works without OpenClaw)
1. Task card → "Send to Agent" → **Open in Terminal** button
2. Dispatch's Rust PTY manager spawns the CLI directly:
   - `codex exec -C /path/to/project "fix the auth bug"`
   - `claude --print "implement the login page"`
   - `gemini "review this codebase"`
   - Or any arbitrary command
3. Real PTY, rendered in xterm.js — full terminal, you can type into it
4. No middleware. No AI orchestrator. Just you and the CLI.

#### Path C: Raw Terminal (always available)
- "+ New Terminal" in Agents sidebar → blank shell
- Run anything: `codex`, `claude`, `python`, `htop`, `git`, whatever
- Not tied to a task card — it's just a terminal

**The Agents tab is a unified view** — orchestrated sessions and direct CLI sessions both appear in the same sidebar. The only difference is the icon/badge (🔗 orchestrated vs 💻 direct).

### Agent Registry

Dispatch maintains a local config of known CLI agents:

```json
{
  "agents": {
    "codex": {
      "command": "codex exec --dangerously-bypass-approvals-and-sandbox -C {project_dir} \"{prompt}\"",
      "name": "Codex (GPT 5.2)",
      "icon": "🟢"
    },
    "claude": {
      "command": "claude --permission-mode bypassPermissions --print \"{prompt}\"",
      "name": "Claude Code (Opus 4.6)",
      "icon": "🟠"
    },
    "gemini": {
      "command": "gemini \"{prompt}\"",
      "name": "Gemini CLI",
      "icon": "🔵"
    },
    "custom": {
      "command": "",
      "name": "Custom Command",
      "icon": "⚙️"
    }
  }
}
```

Users can add/edit agents in Settings. When dispatching a task, the "Send to Agent" modal shows the registry as a dropdown. Select an agent → Dispatch fills in the command template → spawns the PTY.

This means **your buddy who doesn't use OpenClaw** can still:
- Add projects
- Create task cards
- Click "Send to Agent" → pick Codex/Claude/Gemini from the dropdown
- Watch it work in a real terminal
- Use git save points, file browser, everything

OpenClaw just adds the AI orchestration layer on top.

### Data Flow

**With OpenClaw:**
1. **Chat** → WebSocket to OpenClaw Gateway → OpenClaw processes → response streams back
2. **Orchestrated dispatch** → Dispatch calls OpenClaw `sessions_spawn` → agent starts → stream in Agents tab
3. **Agent monitoring** → OpenClaw WebSocket pushes session events → Cockpit renders live output

**Without OpenClaw (standalone):**
1. **Chat tab** → disabled or shows "Connect OpenClaw for AI chat" placeholder
2. **Direct dispatch** → Dispatch's Rust PTY manager spawns CLI → output in Agents tab terminal
3. **Agent monitoring** → PTY output streams directly to xterm.js

**Always (both modes):**
4. **Git operations** → Rust backend uses git2-rs directly → no shell dependency
5. **File operations** → Rust backend watches filesystem → frontend updates reactively
6. **Task management** → SQLite, fully local, no external dependency

### Multi-Project Support

Unlike Orchestrate (single project), Dispatch manages multiple projects:

```
┌─ Project Switcher (top-left dropdown or sidebar) ─┐
│                                                     │
│  TX Flows          ~/Documents/StablebooksV1/       │
│  ProbableWatch     ~/Documents/probablewatch/       │
│  Autoresearch      ~/Documents/autoresearch/        │
│  Dispatch          repo-root/     │
│                                                     │
│  + Add Project                                      │
└─────────────────────────────────────────────────────┘
```

Each project has its own:
- Task board (kanban state)
- File tree
- Git history / save points
- Agent sessions scoped to that project

Chat (OpenClaw) is **global** — it knows all projects and can work across them.

---

## 4. Feature Tabs

### 4.1 Chat (Orchestrate)

**Purpose:** Talk to OpenClaw directly from the app. The primary command interface.

| Feature | Description |
|---------|-------------|
| **Message stream** | Scrollable chat history with markdown rendering |
| **Input bar** | Text input + send button, bottom-fixed |
| **Quick actions** | "Create task" button next to input |
| **Model selector** | Dropdown to override model for next message |
| **Context awareness** | OpenClaw knows which project is selected, can reference files/tasks |
| **Voice input** | Post-v1; no microphone UI or transcription flow ships in the current public release |
| **Code blocks** | Syntax-highlighted, copy button, collapsible for long output |

**Data source:** OpenClaw WebSocket (main session)

### 4.2 Tasks (Kanban)

**Purpose:** Visual task management with one-click agent dispatch.

| Feature | Description |
|---------|-------------|
| **Columns** | Draft → Planning → In Progress → Review → Done |
| **Cards** | Title, description (markdown), priority, assignee (agent/model), created date |
| **Drag & drop** | Move cards between columns |
| **"Send to Agent" button** | Per-card. Click → picks model → spawns agent → card moves to In Progress |
| **Agent assignment** | Choose model/agent per task (Opus, Codex, Gemini, etc.) or let OpenClaw auto-pick |
| **Subtasks** | Checkbox list within a card |
| **Labels/tags** | Color-coded categorization |
| **Filters** | By status, label, assignee, project |

**Storage:** SQLite (local) + optional markdown export (Conductor-style compatibility)

**Dispatch flow:**
1. Card in "Planning" column
2. Click "Send to Agent" → modal: select model, confirm prompt/instructions
3. Dispatch calls OpenClaw `sessions_spawn` with task description
4. Card auto-moves to "In Progress" with agent session ID linked
5. When agent completes → card moves to "Review"
6. OpenClaw reviews output → card moves to "Done" or back to "In Progress" with feedback

### 4.3 Agents

**Purpose:** Live view of all running agent sessions + embedded terminal. The nerve center.

**Layout:** Vertical sidebar (left) + main panel (right) — inspired by Orchestrate v2's terminal sidebar redesign.

**Left sidebar:**
| Element | Description |
|---------|-------------|
| **Session list** | Each running agent: name, model icon, status badge (running 🟢 / done ✅ / error 🔴), elapsed time |
| **Session type badge** | 🔗 = orchestrated (via OpenClaw), 💻 = direct CLI (PTY) |
| **+ New terminal** | Spawn a blank shell — run anything |
| **Click to select** | Shows that session's output in main panel |

**Main panel — two modes (toggle button in top-right):**

| Mode | Description |
|------|-------------|
| **Stream view** | Clean, filtered output from OpenClaw session. Markdown-rendered. Progress indicators. Less noise. *(Only available for orchestrated sessions)* |
| **Terminal view** (default for direct CLI) | Full xterm.js PTY. Raw terminal access. Can type commands directly. This IS the agent running — real terminal, real input. |

**Actions per session:**
- **Steer** — Send a message to redirect the agent mid-run *(orchestrated sessions only)*
- **Kill** — Terminate the session (works for both types — sends SIGTERM to PTY)
- **View task** — Jump to the linked kanban card (if dispatched from a task)
- **Copy output** — Copy session output to clipboard
- **Full-screen** — Expand terminal to full panel (hide sidebar)

**Dispatch modal (from "Send to Agent" on a task card):**
```
┌─────────────────────────────────────────┐
│  Send to Agent                          │
│                                         │
│  Agent: [Codex (GPT 5.2)         ▾]    │
│  Project: [TX Flows               ▾]    │
│  Prompt: [________________________]     │
│          [________________________]     │
│                                         │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ Dispatch  │    │ Open in Terminal │   │
│  │ (via OpenClaw)│   │ (direct CLI)    │   │
│  └──────────┘    └──────────────────┘   │
│                                         │
│  ℹ️ Dispatch sends through OpenClaw     │
│     for AI-monitored orchestration.     │
│     Terminal opens a live CLI session.  │
└─────────────────────────────────────────┘
```

**Without OpenClaw:** "Dispatch" button is grayed out. "Open in Terminal" is always available.

**Data source:** OpenClaw WebSocket (orchestrated sessions) + Rust PTY manager (direct CLI + raw terminals)

### 4.4 Files

**Purpose:** Project file browser with preview.

**Layout:** Two-panel (tree left, preview right)

| Feature | Description |
|---------|-------------|
| **File tree** | Collapsible directory structure, icons by file type |
| **Markdown preview** | Rendered markdown for .md files |
| **Syntax highlighting** | Code files with language detection |
| **Search** | File name search + full-text search (ripgrep via Rust) |
| **Open in editor** | Button to open file in system editor (VSCode, etc.) |
| **gitignore-aware** | Respects .gitignore, hides node_modules etc. |

**Data source:** Rust filesystem watcher (notify-rs), scoped to selected project directory

### 4.5 History (Save Points)

**Purpose:** Visual git history with one-click revert/restore. No git knowledge required.

| Feature | Description |
|---------|-------------|
| **Save point list** | Reverse chronological. Commit message, timestamp, files changed, +/- line counts |
| **Search** | Filter save points by message text |
| **Diff viewer** | Click a save point → see file-by-file diffs (split or unified) |
| **Revert** | Undo a specific save point (git revert) |
| **Restore** | Reset to a specific save point (git reset --hard, with confirmation) |
| **Auto save points** | Dispatch auto-commits before every agent run ("Pre-agent save point") |
| **Manual save** | "Create save point" button with custom message |
| **Branch indicator** | Shows current branch, but no complex branch management (keep it simple) |

**Data source:** git2-rs (Rust libgit2 bindings)

### 4.6 Browser

**Purpose:** Preview running dev servers without leaving the app.

| Feature | Description |
|---------|-------------|
| **URL bar** | Enter any localhost URL |
| **Webview** | Renders the page using system webview |
| **Refresh** | Manual refresh button |
| **DevTools** | Optional toggle to open devtools panel |
| **Auto-detect** | If a dev server starts in terminal, offer to open it in Browser tab |
| **Multiple tabs** | Tab bar for multiple preview URLs |

**Data source:** Tauri webview (separate from the app's own webview)

---

## 5. Global UI Elements

### 5.1 Top Bar

```
┌──────────────────────────────────────────────────────────┐
│ [⚡ OpenClaw]  [Project: TX Flows ▾]   Chat│Tasks│Agents│Files│History│Browser   [⚙] │
└──────────────────────────────────────────────────────────┘
```

- **App icon + name** (left)
- **Project switcher** dropdown (left-center)
- **Tab navigation** (center) — pill/segment style, active tab highlighted
- **Settings gear** (right) — opens settings panel

### 5.2 System Tray

- Dispatch icon lives in system tray
- Quick actions: open app, show notifications, quit
- Badge/indicator when agents are running

### 5.3 Notifications

- Desktop notifications when:
  - Agent completes a task
  - Agent encounters an error
  - OpenClaw has a message/update
  - Build/dev server status changes

### 5.4 Settings Panel

| Setting | Description |
|---------|-------------|
| **OpenClaw connection** | Gateway URL, port, auth |
| **Projects** | Add/remove/edit project paths |
| **Default model** | Which model to use when no override specified |
| **Theme** | Dark (default), light (if we feel generous), system |
| **Terminal** | Font, font size, shell path |
| **Notifications** | Toggle per notification type |
| **Keyboard shortcuts** | Customizable hotkeys |

---

## 6. Design Language

### Theme: Dark Minimal

| Element | Value |
|---------|-------|
| **Background** | Near-black (`#0a0a0a` to `#121212`) |
| **Surface** | Slightly lighter (`#1a1a1a` to `#1e1e1e`) |
| **Border** | Subtle (`#2a2a2a`) |
| **Text primary** | Off-white (`#e5e5e5`) |
| **Text secondary** | Muted gray (`#888888`) |
| **Accent** | Electric blue (`#3b82f6`) — OpenClaw's energy |
| **Success** | Green (`#22c55e`) |
| **Warning** | Amber (`#f59e0b`) |
| **Error** | Red (`#ef4444`) |
| **Cards** | Low-contrast on surface, subtle border, no shadows |
| **Font** | Inter (UI), JetBrains Mono (code/terminal) |

### Principles

1. **Dense but not cluttered** — maximize information density, minimize chrome
2. **No rounded-everything** — subtle rounding (4-6px), not bubbly
3. **Monochrome base, color for meaning** — color = status, not decoration
4. **Motion: functional only** — tab switches, card drags, panel resizes. No gratuitous animation
5. **Linux-native feel** — no Mac traffic lights, proper window controls, system tray

---

## 7. OpenClaw Integration (Optional)

Dispatch works **standalone** out of the box. OpenClaw is an optional integration that unlocks orchestrated dispatch, AI chat, and memory.

### Without OpenClaw (Standalone Mode)

Everything except Chat and orchestrated dispatch works:
- ✅ Tasks (kanban, full CRUD)
- ✅ Agents (direct CLI spawn via PTY — Codex, Claude Code, Gemini, any CLI)
- ✅ Raw terminals (+ New Terminal)
- ✅ Files (browser, preview, search)
- ✅ History (git save points, revert, restore)
- ✅ Browser (embedded webview)
- ⬚ Chat tab shows "Connect to OpenClaw for AI chat" placeholder
- ⬚ "Dispatch" button grayed out (use "Open in Terminal" instead)

### With OpenClaw (Enhanced Mode)

Everything above, plus:
- ✅ Chat with OpenClaw (or whatever AI persona the user configures)
- ✅ Orchestrated dispatch — AI monitors, steers, and quality-checks agent work
- ✅ Stream view for agent sessions (clean markdown output)
- ✅ Multi-model routing through a single interface
- ✅ Session memory and context awareness

### API Surface Used (when connected)

| OpenClaw Feature | Dispatch Usage |
|-----------------|---------------|
| `sessions_spawn` | Orchestrated agent dispatch |
| `sessions_send` | Steer running agents |
| `sessions_list` | Populate agent panel (orchestrated sessions) |
| `sessions_history` | Load chat history |
| `subagents` (list/steer/kill) | Agent management |
| WebSocket stream | Real-time agent output, chat messages |
| `cron` | Scheduled tasks, reminders |
| `memory_search` / `memory_get` | Context for chat responses |

### Connection

- **Auto-detect:** On startup, Dispatch checks `localhost:18789` (default OpenClaw port). If reachable → enhanced mode. If not → standalone mode. Status indicator in top bar.
- **Manual config:** Settings → OpenClaw → enter gateway URL + optional auth token
- **Reconnection:** If gateway goes down mid-session, Dispatch gracefully degrades to standalone. Orchestrated sessions show "disconnected" badge. Direct CLI sessions unaffected.

---

## 8. Build Phases

### Phase 0: Scaffold + Shell (Week 1)
- [ ] Initialize Tauri v2 project with React + TypeScript
- [ ] Set up Rust backend skeleton (Axum router)
- [ ] Configure SQLite with initial schema (projects, tasks)
- [ ] Implement top bar with project switcher (static)
- [ ] Tab navigation (empty panels)
- [ ] Dark theme foundation (Tailwind config)
- [ ] Build and run on Linux — verify Tauri basics work

### Phase 1: Chat Tab (Week 1-2)
- [ ] WebSocket connection to OpenClaw gateway
- [ ] Message send/receive
- [ ] Markdown rendering in chat bubbles
- [ ] Code block syntax highlighting
- [ ] Auto-scroll, scroll-to-bottom button
- [ ] Model selector dropdown
- [ ] Chat history persistence (SQLite cache)

### Phase 2: Tasks Tab (Week 2-3)
- [ ] Kanban board with 5 columns
- [ ] Card CRUD (create, edit, delete)
- [ ] Drag and drop between columns
- [ ] SQLite persistence for tasks
- [ ] "Send to Agent" button (calls OpenClaw sessions_spawn)
- [ ] Auto-move cards on agent status changes
- [ ] Labels, priority, assignee fields

### Phase 3: Agents Tab (Week 3-4)
- [ ] Agent session list (sidebar) from OpenClaw sessions_list
- [ ] WebSocket streaming of agent output
- [ ] Stream view (clean, markdown-rendered)
- [ ] xterm.js terminal integration
- [ ] PTY spawning from Rust backend
- [ ] Toggle between stream/terminal view
- [ ] Steer and kill actions
- [ ] "+ New terminal" for raw shell access

### Phase 4: Files Tab (Week 4)
- [ ] File tree component (recursive directory listing)
- [ ] File content preview (markdown + syntax highlighting)
- [ ] Filesystem watcher (auto-refresh on changes)
- [ ] Search (filename + full-text via ripgrep)
- [ ] "Open in editor" action
- [ ] .gitignore awareness

### Phase 5: History Tab (Week 4-5)
- [ ] Git log listing via git2-rs
- [ ] Diff viewer (unified format)
- [ ] Revert action (git revert)
- [ ] Restore action (git reset with confirmation dialog)
- [ ] Auto save points before agent runs
- [ ] Manual "Create save point" button
- [ ] Search/filter save points

### Phase 6: Browser Tab (Week 5)
- [ ] Embedded webview with URL bar
- [ ] Tab management (multiple URLs)
- [ ] Refresh, back, forward
- [ ] Auto-detect dev server ports
- [ ] DevTools toggle

### Phase 7: Polish + Integration (Week 5-6)
- [ ] System tray integration
- [ ] Desktop notifications
- [ ] Keyboard shortcuts
- [ ] Settings panel
- [ ] Multi-project switching (full flow)
- [ ] Error handling + reconnection logic
- [ ] Performance optimization
- [ ] Package for Linux (.deb, .AppImage)

---

## 9. Non-Goals (v1)

- **No mobile version** — desktop only
- **No cloud sync** — local-first, no account needed
- **No built-in code editor** — use "Open in editor" to launch VSCode/etc.
- **No complex git workflows** — no merge, no rebase, no branch management beyond indicator
- **No multi-user** — single user, single machine
- **No plugin system** — not yet, keep it focused
- **No built-in AI model** — Dispatch doesn't embed or call AI models directly. It either routes through OpenClaw (if connected) or spawns CLI tools that have their own auth/API keys. Dispatch is a command center, not a model host.
- **No account/login** — no SaaS, no cloud, no auth. Download, run, done.

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| **App startup time** | < 2 seconds |
| **Binary size** | < 15MB |
| **Memory usage** | < 150MB idle, < 300MB with 5 agents streaming |
| **Agent dispatch** | Task → agent running in < 3 seconds |
| **Daily usage** | The user uses Dispatch instead of Telegram for agent work |

---

## 11. Inspiration & References

| Source | What We Took |
|--------|-------------|
| **Orchestrate** (Chris/Melty) | Tab layout, kanban → agent dispatch flow, save points concept, overall dark minimal vibe |
| **Conductor OSS** | Automated dispatch queue, markdown-native tasks, session recovery |
| **Vibe Kanban** | Diff review UI, PR creation flow |
| **Linear** | Card density, keyboard-first interaction |
| **Warp terminal** | Terminal UX, command palette |
| **Zed** | Performance bar, minimal chrome |

---

## 12. Decisions Log (formerly Open Questions)

| # | Question | Decision | Date |
|---|----------|----------|------|
| 1 | **Product name** | **Dispatch** — clean, standalone brand. | 2026-03-19 |
| 2 | **Kanban markdown export** | **Yes** — tasks export as `.md` files in project folder. Git-trackable, portable. | 2026-03-19 |
| 3 | **Agent auto-pick** | **Auto-pick as a dropdown option** — agent selector shows "Auto (let OpenClaw pick)" at the top of the list alongside manual choices. In standalone mode, defaults to last-used agent. | 2026-03-19 |
| 4 | **PR integration** | **Post-v1** — current release includes OpenClaw review routing, not GitHub PR creation/review automation. | 2026-03-19 |
| 5 | **Voice input** | **Post-v1** — no microphone UI or partial transcription flow ships in the current release. | 2026-03-19 |
| 6 | **Multi-display** | **Responsive shell** — current release supports responsive panels; detachable windows are post-v1 if needed. | 2026-03-19 |
| 7 | **Packaging** | **Open source, MIT license.** Current verified packages are `.AppImage` and `.deb` for Linux. macOS `.dmg` and Flatpak are post-v1. GitHub Releases are the distribution path. | 2026-03-19 |
| 8 | **API key management** | **Yes** — Settings screen for API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, etc.). Falls back to shell env if not set in app. Secrets are stored locally in the OS keychain. | 2026-03-19 |
| 9 | **Branding** | **Dispatch** is the brand. Own identity, own logo, separate from OpenClaw. OpenClaw is the AI persona inside Dispatch when OpenClaw is connected — but Dispatch stands alone. | 2026-03-19 |

## 13. Open Questions (Remaining)

1. **Logo/icon** — Dispatch needs its own icon for taskbar/system tray. Design direction?
2. **Landing page / website** — dispatch.dev? dispatch.build? getdispatch.app?
3. **Onboarding flow** — first-run wizard to add first project + configure agents?

---

*This PRD is a living document. Update as decisions are made.*
