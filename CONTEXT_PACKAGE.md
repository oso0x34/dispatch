# Context Package

## Repo: dispatch
Generated: 2026-03-19 20:02:24 CDT

## Runtime & Package Manager
| Item | Version | Confidence |
|------|---------|------------|
| Node | 22.22.0 | HIGH |
| npm | 10.9.4 | HIGH |
| rustc | 1.94.0 | HIGH |
| cargo | 1.94.0 | HIGH |
| Package manager | npm | HIGH |

## Quickstart
```bash
npm install
npm run build
cargo build
npm run tauri dev
```

Linux note:
`cargo build` and `npm run tauri dev` require the Ubuntu Tauri desktop prerequisites on this host:

```bash
sudo apt update
sudo apt install -y \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  librsvg2-dev \
  libayatana-appindicator3-dev \
  build-essential \
  pkg-config
```

## Repo Map
```text
/
├── docs/
├── scripts/
│   └── smoke/
├── src/
│   ├── app/
│   ├── features/
│   ├── shared/
│   ├── store/
│   └── styles/
├── src-tauri/
│   ├── capabilities/
│   ├── migrations/
│   ├── src/
│   │   ├── commands/
│   │   ├── db/
│   │   ├── models/
│   │   ├── services/
│   │   ├── app_state.rs
│   │   ├── error.rs
│   │   ├── logging.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   └── tests/
├── Cargo.toml
└── package.json
```

### Key Entrypoints
- Frontend: `src/main.tsx`
- Frontend providers: `src/app/providers.tsx`
- Frontend typed Tauri wrapper: `src/shared/tauri/health.ts`
- Backend boot: `src-tauri/src/main.rs`
- Backend builder and commands: `src-tauri/src/lib.rs`

## Test Inventory
| Type | Location | Framework | Command |
|------|----------|-----------|---------|
| React build sanity | `src/**` | TypeScript + Vite | `npm run build` |
| Rust integration lane (planned) | `src-tauri/tests/**` | cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` |
| React component lane (planned) | `src/**/__tests__/**` | Vitest + Testing Library | `npm run test -- <path>` |
| Shell smoke lane (planned) | `scripts/smoke/**` | bash | `bash scripts/smoke/<script>.sh` |

## Environment Requirements
| Requirement | Purpose | Confidence |
|-------------|---------|------------|
| GTK3/WebKit2GTK development packages | Native Tauri desktop build on Ubuntu | HIGH |

## Confidence Summary
| Section | Confidence |
|---------|------------|
| Runtime | HIGH |
| Commands | HIGH |
| Repo Map | HIGH |
| Tests | MEDIUM |
| Environment | HIGH |
