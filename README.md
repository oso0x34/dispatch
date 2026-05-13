# Dispatch

Dispatch is a Tauri v2 desktop command center for AI-assisted development work. It keeps projects, terminals, task dispatch, file browsing, and git save points in one native app.

Visual shell authority lives in [`docs/visual-rebuild-spec.md`](docs/visual-rebuild-spec.md) and the repo-local references under [`docs/reference/visual-rebuild/`](docs/reference/visual-rebuild/).

## Modes

- Standalone mode: Dispatch works without OpenClaw. It uses the Rust PTY manager to spawn local CLI tools directly, so you can open terminals and run tools like `codex`, `claude`, or `gemini` without extra infrastructure.
- OpenClaw mode: when a local OpenClaw gateway is available, Dispatch mirrors orchestrated sessions and chat/review flows through it. OpenClaw is optional and acts as an accelerator, not a requirement.

To enable the connected path, set the gateway URL in Settings -> Connection. The default gateway URL is `ws://127.0.0.1:18789`. If your gateway requires auth, store `OPENCLAW_GATEWAY_TOKEN` in Settings -> Secrets. Without OpenClaw, the Chat tab stays unavailable, but tasks, files, history, and direct terminal dispatch still work.

## Environment

Standalone mode does not require environment variables. Optional connected or agent-profile values are listed in [`.env.example`](.env.example):

| Variable | Required | Purpose |
|---|---:|---|
| `OPENCLAW_GATEWAY_URL` | No | OpenClaw gateway URL. Defaults to `ws://127.0.0.1:18789` if unset. |
| `OPENCLAW_GATEWAY_TOKEN` | No | Optional OpenClaw gateway token. Prefer Settings -> Secrets for local keychain storage. |
| `ANTHROPIC_API_KEY` | No | Optional provider credential for local agent profiles. |
| `OPENAI_API_KEY` | No | Optional provider credential for local agent profiles. |
| `GOOGLE_API_KEY` | No | Optional provider credential for local agent profiles. |

Dispatch reads these values from the process environment when it launches. Export them in your shell, `direnv`, or desktop launcher environment if needed; the app does not require a `.env` file.

## Linux Prerequisites

For local source builds on Debian or Ubuntu, install:

- `node` 22.x
- Rust stable
- `npm`
- `build-essential`
- `pkg-config`
- `libwebkit2gtk-4.1-dev`
- `libappindicator3-dev`
- `libayatana-appindicator3-dev`
- `librsvg2-dev`
- `patchelf`
- `libfuse2`

The release workflow in [`.github/workflows/release.yml`](.github/workflows/release.yml) runs on `ubuntu-22.04` and uses the same Tauri packaging dependencies.

## Build From Source

From the repo root:

```bash
npm ci
npm audit
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npx tauri dev
```

`npm run dev` starts only the Vite frontend on port `1420`. Use `npx tauri dev` for the desktop app because it starts both the frontend and the Rust/Tauri shell.

## First Run

1. Launch the desktop app with `npx tauri dev`.
2. Open Settings -> Projects and add a local git repository.
3. Use Agents -> New shell to open a terminal in that project.
4. Direct dispatch uses local CLI tools installed on your machine, such as `codex`, `claude`, or `gemini`.
5. OpenClaw features stay inactive until a gateway URL is configured and reachable.

For a packaged local build:

```bash
bash scripts/smoke/phase-10-release.sh
```

For a raw package build without the smoke gate:

```bash
npx tauri build --bundles appimage,deb --ci
```

## Packaged Install

Bundled Linux artifacts are written under `target/release/bundle/`.

### `.AppImage`

```bash
chmod +x target/release/bundle/appimage/*.AppImage
./target/release/bundle/appimage/*.AppImage
```

### `.deb`

```bash
sudo apt install ./target/release/bundle/deb/*.deb
```

## Release Smoke

Run the release gate locally with:

```bash
bash scripts/smoke/phase-10-release.sh
```

That script verifies the release config, builds `appimage` and `deb` bundles with Tauri, reruns the release smoke with artifact checks enabled, and prints the bundle paths.

## Repeatable Release Cut

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` together.
2. Run the same gates the release workflow enforces:

```bash
npm ci
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm test
bash scripts/smoke/phase-10-release.sh
```

3. Tag the release as `vX.Y.Z`, matching the package version exactly.
4. Push the tag. GitHub Actions runs [`.github/workflows/release.yml`](.github/workflows/release.yml), verifies the tag/version match, and uploads the `.AppImage` and `.deb` artifacts.
5. Install the generated package on a clean Linux box and confirm the app launches before announcing the cut.

`workflow_dispatch` is still useful for dry-run validation, but artifact publication and tag/version enforcement only happen on tag-triggered runs.

## Release Checklist

- Startup time: cold start under 2 seconds on the target Linux box.
- Idle memory: under 300 MB RSS after the app sits idle for 60 seconds with one project loaded and no active streams.
- Terminal spawn latency: direct dispatch or blank terminal spawn reaches first output in under 3 seconds.
- Save-point latency: manual or pre-dispatch save-point creation completes in under 2 seconds on a warm local repository.

These are release targets, not automated perf tests yet. The current automated release gate is [`.github/workflows/release.yml`](.github/workflows/release.yml) plus [`scripts/smoke/phase-10-release.sh`](scripts/smoke/phase-10-release.sh).

## License

Dispatch is licensed under the [MIT License](LICENSE).
