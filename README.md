# Pi Desktop

A native-feeling, cross-platform desktop client for the **pi coding agent** CLI, built with **Tauri 2 + Rust + React**.

Pi Desktop uses `pi --mode rpc` under the hood and maps core CLI capabilities into a desktop UX.

## Current Status (2026-02-17)

- ✅ **Core app UX is stable on `dev`** (React-only frontend, project-centric navigation, streaming chat, settings/runtime diagnostics).
- ✅ **Recent UI/flow work is integrated** (minimal Codex-like polish, project sidebar + persisted projects, per-project sessions, composer model/thinking controls, switch refresh fixes).
- ✅ **Backend session indexing is wired to real pi data** (`~/.pi/agent/sessions`, with cwd/tokens/cost metadata).
- ✅ **Validation pass green**: `npm run check` and `npm run tauri build` both pass.
- ⚠️ **Main remaining v1-adjacent gap**: issue **#5** (distribution pipeline/reproducible Windows+macOS release packaging + signing/notarization documentation).

## Highlights

- Native window shell with custom titlebar and desktop controls
- Minimal dark-first visual system (Apple/Codex-inspired)
- Project-centric sidebar:
  - persisted projects
  - colored project dots
  - expand/collapse project groups
  - per-project “new session” action
  - recent session metadata (tokens/cost/age)
- Streaming chat with:
  - tool-call cards
  - thinking blocks
  - queue/retry/compaction indicators
  - image attachments (button, drag/drop, clipboard paste)
- Composer runtime controls:
  - model dropdown
  - thinking dropdown
  - steer/follow-up actions while streaming
- Session workflows:
  - new/resume/switch/rename/fork/export
  - history viewer with search/filter/jump
  - message-level copy/edit/retry
- Command palette for built-ins + discovered extension/prompt/skill commands
- Settings runtime panel:
  - auth status (`auth.json` + env providers)
  - CLI update check/action (PATH installs)
  - RPC compatibility probe + fallback messaging

Detailed capability matrix: **[`FEATURE_MAPPING.md`](./FEATURE_MAPPING.md)**

Execution docs:
- **[`ROADMAP_V1.md`](./ROADMAP_V1.md)**
- **[`RELEASE_CRITERIA.md`](./RELEASE_CRITERIA.md)**

---

## Prerequisites

- Node.js >= 20
- Rust >= 1.70
- `pi` CLI available on PATH

Install CLI:

```bash
npm install -g @mariozechner/pi-coding-agent
pi --version
```

---

## Development

```bash
npm install
npm run check
npm run tauri dev
```

Useful variants:

```bash
npm run dev        # frontend only (Vite)
npm run tauri dev  # full desktop app (frontend + Tauri backend)
```

---

## Build / Bundle

```bash
npm run tauri build
```

After a successful build:

- release executable (Windows):
  - `src-tauri/target/release/pi-desktop.exe`
- bundled installer artifacts:
  - `src-tauri/target/release/bundle/`

> Distribution pipeline hardening and cross-platform reproducibility/signing docs are tracked in issue #5.

---

## Architecture

- **Frontend**: React entrypoint + TSX components + shared CSS tokens/utilities
- **Backend**: Rust (Tauri command bridge, RPC process manager, session indexing, CLI command runner)
- **Protocol**: JSON-lines RPC over stdin/stdout to `pi --mode rpc`

Key files:

- `src/main.tsx` — React entrypoint
- `src/bootstrap.ts` — desktop orchestration/bootstrap
- `src/rpc/bridge.ts` — typed RPC client
- `src/components/chat-view.tsx` — chat, streaming, tools, queueing, attachments
- `src/components/sidebar.tsx` — project + session navigation
- `src/components/settings-panel.tsx` — runtime config + auth/runtime diagnostics
- `src/components/titlebar.tsx` — window controls + model/session status
- `src-tauri/src/lib.rs` — process manager + session indexing + CLI helpers

---

## Next Steps

1. Close issue #5 (distribution pipeline): reproducible Windows/macOS release flow + signing/notarization guidance.
2. Add CI-level build/check guardrails for pre-merge and release candidate branches.
3. Run final release smoke matrix from `RELEASE_CRITERIA.md` before `dev -> main` promotion.
