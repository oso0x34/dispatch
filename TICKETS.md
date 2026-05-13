# Dispatch Public Notes

This file replaces the pre-release implementation ledger that was used while the
project was being built. The public repository keeps only the current readiness
state and contributor-facing commands here.

## Current Status

- Standalone desktop mode is the primary supported local path.
- OpenClaw integration is optional. If no gateway is configured, local projects,
  terminals, tasks, files, history, and direct dispatch still work.
- Browser preview remains experimental and is constrained to localhost targets.

## Verification

Use the root README for setup and run commands. The public readiness gate is:

```bash
npm ci
npm audit
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npx tauri build --bundles appimage,deb --ci
```
