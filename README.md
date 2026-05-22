<div align="center">

<img src="src-tauri/icons/128x128.png" alt="Dispatch" width="96" />

# Dispatch

**A native desktop command center for AI-assisted development.**

Projects, terminals, task dispatch, file browsing, and git save points — in one place, with no browser tab tax.

[![Release](https://img.shields.io/github/v/release/oso0x34/dispatch?include_prereleases&sort=semver)](https://github.com/oso0x34/dispatch/releases)
[![Build](https://github.com/oso0x34/dispatch/actions/workflows/release.yml/badge.svg)](https://github.com/oso0x34/dispatch/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux-blue)](#install)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24C8DB)](https://tauri.app/)

</div>

---

## What it does

Dispatch is a [Tauri v2](https://tauri.app/) desktop app that brings the way you actually work with AI development tools into one native shell. Spawn `codex`, `claude`, `gemini`, or any other CLI directly from a kanban-style task board. Watch sessions, track file changes, and create git save points without leaving the window.

The Rust backend owns everything that touches your machine — PTYs, filesystem, secrets, and the SQLite store. The React frontend never talks to disk directly. That isolation is the whole point: no shell-string interpolation, no rogue paths, no surprises.

## Features

- **Multi-project workspace** — switch between local git repos in one click
- **Native terminals** — Rust-backed PTYs, single-owner lifecycle, websocket attach for reconnects
- **Direct CLI dispatch** — structured `program` + `args[]` + `env` + `cwd`; zero shell parsing
- **Kanban task board** — 5 workflow columns (Draft → Planning → In Progress → Review → Done) with markdown export to `<project>/dispatch/tasks/`
- **Files tab** — Rust-owned tree, search, and watching with `.gitignore` filtering
- **History v1** — git save points on `refs/dispatch/*`. Never pollutes your branch history. Pre-run save points fire even when the repo is clean.
- **OpenClaw integration (optional)** — mirror orchestrated chat/review through a local gateway when one is available
- **Standalone mode** — works without OpenClaw, no extra infrastructure needed

## Modes

| Mode | Requires | What you get |
|---|---|---|
| **Standalone** | Just Dispatch | Local projects, terminals, tasks, files, history, direct CLI dispatch |
| **Connected** | Local OpenClaw gateway | Everything above + orchestrated Chat tab and review loop |

To turn on connected mode, set the gateway URL in **Settings → Connection** (default: `ws://127.0.0.1:18789`). If the gateway needs auth, store `OPENCLAW_GATEWAY_TOKEN` in **Settings → Secrets** (Linux keychain).

## Install

Pre-built Linux bundles for every release are attached to the [Releases page](https://github.com/oso0x34/dispatch/releases). Pick your format:

### `.AppImage` (portable)

```bash
chmod +x Dispatch_*.AppImage
./Dispatch_*.AppImage
```

### `.deb` (Debian / Ubuntu)

```bash
sudo apt install ./Dispatch_*.deb
```

## Build from source

<details>
<summary><strong>Linux prerequisites</strong></summary>

Tested on Debian and Ubuntu (22.04+). Install:

- `node` 22.x
- Rust stable (via `rustup`)
- `npm`
- `build-essential`
- `pkg-config`
- `libwebkit2gtk-4.1-dev`
- `libayatana-appindicator3-dev`
- `librsvg2-dev`
- `patchelf`
- `libfuse2`

The release workflow runs on `ubuntu-22.04` with the same packaging dependencies.

</details>

From the repo root:

```bash
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npx tauri dev
```

`npm run dev` starts only the Vite frontend on port `1420`. Use `npx tauri dev` for the full desktop app — it spawns both the frontend and the Rust shell.

### First run

1. Launch with `npx tauri dev`
2. Open **Settings → Projects** and add a local git repository
3. Use **Agents → New shell** to open a terminal in that project
4. Dispatch will use whichever CLI tools (`codex`, `claude`, `gemini`, etc.) you already have installed
5. OpenClaw features stay dormant until a reachable gateway URL is configured

## Environment

Standalone mode does **not** require any environment variables. The optional ones, for connected mode or pre-loaded agent profiles, live in [`.env.example`](.env.example):

| Variable | Required | Purpose |
|---|---:|---|
| `OPENCLAW_GATEWAY_URL` | No | OpenClaw gateway URL. Defaults to `ws://127.0.0.1:18789`. |
| `OPENCLAW_GATEWAY_TOKEN` | No | Optional gateway token. Prefer Settings → Secrets for keychain storage. |
| `ANTHROPIC_API_KEY` | No | Optional credential for local Anthropic-backed agent profiles. |
| `OPENAI_API_KEY` | No | Optional credential for local OpenAI-backed agent profiles. |
| `GOOGLE_API_KEY` | No | Optional credential for local Google-backed agent profiles. |

Dispatch reads these from the process environment at launch. Export them in your shell, `direnv`, or your desktop launcher — no `.env` file required.

## Architecture, in one paragraph

Rust owns SQLite (via `rusqlite`), the filesystem (`notify`, `ignore`, `grep-searcher`), PTYs (`portable-pty`), secrets (`keyring` → OS keychain), and OpenClaw transport (`tokio-tungstenite`). The React frontend keeps **only UI state** in Zustand and talks to the backend through typed Tauri commands. PTYs are created in exactly one place (`create_terminal_session()`); websocket routes attach to existing sessions, never spawn new ones. Save points live on `refs/dispatch/*` so they never collide with your real branch history. Full architectural lockdown in [`ROADMAP-v2.md`](ROADMAP-v2.md).

## Releasing (maintainers)

<details>
<summary><strong>Cutting a release</strong></summary>

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` — all three must match.
2. Run the gates locally:
   ```bash
   npm ci
   npm test
   cargo test --locked --manifest-path src-tauri/Cargo.toml
   bash scripts/smoke/phase-10-release.sh
   ```
3. Commit and push.
4. Tag and push the tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
5. GitHub Actions runs [`release.yml`](.github/workflows/release.yml), verifies the tag matches `package.json`, runs all tests, builds the `.AppImage` and `.deb`, and publishes a GitHub Release with both attached.
6. Install the generated bundle on a clean Linux box and confirm the app launches before announcing.

`workflow_dispatch` is still useful for dry-run validation, but artifact publication is tag-triggered only.

</details>

<details>
<summary><strong>Release-readiness targets</strong></summary>

These are not automated perf gates yet — they're the targets the release smoke is designed to protect:

- Cold start under **2 seconds** on the target Linux box
- Idle memory under **300 MB RSS** after the app sits idle for 60 seconds with one project loaded and no active streams
- Terminal spawn latency under **3 seconds** (direct dispatch or blank shell)
- Save-point creation under **2 seconds** on a warm local repo

</details>

## License

[MIT](LICENSE)
