# Pi Desktop

A native-feeling, cross-platform desktop client for the **pi coding agent** CLI, built with **Tauri 2 + Rust + React** (with legacy Lit components during migration).

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
npm run tauri dev
```

---

## Build

```bash
npm run build:frontend
npm run tauri build
```

App bundles land in:

`src-tauri/target/release/bundle/`

---

## Architecture

- **Frontend**: React (entrypoint/app shell) + Tailwind CSS utilities + custom CSS
- **UI migration state**: legacy Lit component surfaces are currently hosted via a React bridge and being migrated incrementally
- **Backend**: Rust (Tauri command bridge + package command runner)
- **Protocol**: JSON-lines RPC over stdin/stdout to `pi --mode rpc`

Key files:

- `src/main.tsx` — React entrypoint and app host
- `src/legacy-bootstrap.ts` — legacy Lit bootstrap hosted by React during migration
- `src/rpc/bridge.ts` — typed RPC client
- `src/components/chat-view.ts` — chat, streaming, tools, queueing, attachments
- `src/components/sidebar.ts` — projects + sessions
- `src/components/settings-panel.ts` — runtime config
- `src-tauri/src/lib.rs` — process manager + session indexing

---

## Frontend migration status

The project is now **React-first at the entrypoint level** (`src/main.tsx`) to support ecosystem/contributor scaling.

Current status:
- React hosts the desktop shell mount point
- Existing Lit components are still active through `src/legacy-bootstrap.ts`
- Active migration tracking issue: **#7**

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
