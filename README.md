# Pi Desktop

A native-feeling, cross-platform desktop client for the **pi coding agent** CLI, built with **Tauri 2 + Rust + React**.

Pi Desktop uses `pi --mode rpc` under the hood and maps core CLI capabilities into a desktop UI.

## Highlights

- Native window shell (custom titlebar, mac-like minimal controls)
- Project sidebar with persisted folders + per-project sessions
- Streaming chat with tool-call blocks, thinking blocks, and live status pills
- Full RPC model controls (model switch, thinking levels, queue modes, compaction, retry)
- Message queue UX (steer + follow-up)
- Session workflows (new, resume, fork picker, history viewer, rename, export HTML)
- Message-level actions (copy/edit/retry) with hover affordances
- Command palette for extension commands, prompt templates, and skills
- Built-in package manager panel (`pi install/remove/update/list`, global or project-local scope)
- Settings account status panel (auth.json + env-provider detection)
- In-app CLI runtime check (current vs latest version, RPC compatibility probe, one-click npm update for PATH installs)
- Titlebar “Update CLI” badge when a newer PATH-installed CLI is available
- Extension UI protocol support (select/confirm/input/editor/notify/status/widget/title/set_editor_text)
- Image attachments (button, drag/drop, clipboard paste)

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

During desktop dev, the debug binary is produced at:

`src-tauri/target/debug/pi-desktop.exe` (Windows)

---

## Build / Bundle

```bash
npm run build      # runs tauri build
# or: npm run tauri build
```

After a successful build:

- release executable (Windows):
  - `src-tauri/target/release/pi-desktop.exe`
- bundled installer artifacts:
  - `src-tauri/target/release/bundle/`
  - (subfolder depends on target/bundler, e.g. `nsis/`, `msi/`, etc.)

---

## Architecture

- **Frontend**: React-first/React-rendered desktop UI + Tailwind CSS utilities + custom CSS
- **Backend**: Rust (Tauri command bridge + package command runner)
- **Protocol**: JSON-lines RPC over stdin/stdout to `pi --mode rpc`

Key files:

- `src/main.tsx` — React entrypoint
- `src/bootstrap.ts` — desktop orchestration/bootstrap (no Lit bridge)
- `src/rpc/bridge.ts` — typed RPC client
- `src/components/chat-view.tsx` — chat, streaming, tools, queueing, attachments
- `src/components/sidebar.tsx` — projects + sessions
- `src/components/settings-panel.tsx` — runtime config + auth/runtime diagnostics
- `src/components/titlebar.tsx` — window controls + model/session status
- `src-tauri/src/lib.rs` — process manager + session indexing

---

## Frontend architecture status

The desktop frontend is now **React-only**.

Completed migration/cleanup issues:
- Foundation: **#7** ✅
- Core surface migration: **#9** ✅
- React-only bootstrap cleanup: **#10** ✅
- mini-lit/lit dependency removal: **#14** ✅

---

## Notes

RPC mode does not expose every interactive TUI-only CLI command directly. Pi Desktop implements the RPC-exposed core feature set and desktop-native workflows around it.

Runtime discovery order for the `pi` process is:
1. explicit dev CLI path (if provided)
2. bundled sidecar binary (if present)
3. `pi` found on PATH

### Windows build-script policy errors

If `cargo check` / `tauri dev` fails with:

`An Application Control policy has blocked this file. (os error 4551)`

this is an OS policy issue (build-script/proc-macro execution), not an app code error.

Typical fixes:
- run from a trusted development location (not a restricted folder)
- remove enterprise/AppLocker/WDAC restrictions for Rust build artifacts
- clear and rebuild target dir after policy changes (`cargo clean`)
