# Pi Desktop

A native-feeling desktop shell for the **Pi Coding Agent** CLI (`pi --mode rpc`).

<p align="left">
  <a href="https://github.com/gustavonline/pi-desktop/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gustavonline/pi-desktop/ci.yml?branch=main&style=for-the-badge" /></a>
  <a href="https://github.com/gustavonline/pi-desktop/releases"><img alt="Release" src="https://img.shields.io/github/v/release/gustavonline/pi-desktop?include_prereleases&style=for-the-badge" /></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-6b7280?style=for-the-badge" /></a>
</p>

<p align="left">
  <img src="./assets/branding/pi-desktop-icon.svg" alt="Pi DESK app icon" width="120" />
</p>

Pi Desktop is intentionally **minimal** and **extension-first**:
- the desktop app is the host/shell,
- the `pi` CLI is the runtime,
- packages/extensions provide optional behavior.

<img width="1227" height="869" alt="Screenshot 2026-03-28 at 23 28 39" src="https://github.com/user-attachments/assets/0c15a79f-870c-44a0-9489-4b0d2d577e76" />




---

## Why Pi Desktop exists

Pi Desktop gives you a stable desktop UX for Pi without hardcoding product logic into the app.

### Core philosophy

1. **Host boundary first**
   - Desktop app handles windows, panes, files, tabs, notifications, and native UX.
2. **Agent behavior stays in Pi + packages**
   - Workflows/policies should be extension-driven where possible.
3. **Multi-session reliability over gimmicks**
   - Runtime isolation, generation-safe switching, and persistence matter most.
4. **Calm UI**
   - Minimal visuals, neutral colors, low noise, and predictable controls.

### Current development direction

- **Core app focus:** UI polish, interaction quality, and performance (lighter/faster desktop shell).
- **Capability growth:** packages/extensions should drive optional workflows and policies.
- **Hardcoding rule:** avoid embedding project-specific automation/policy logic in app core.
- **Architecture intent:** Pi Desktop is a capability host for extensions, not a monolithic workflow engine.

### Recent highlights (v1.0.0)

- Codex-inspired UI polish across chat timeline, composer, and no-project welcome/dashboard flows.
- Composer slash behavior is deterministic, and `/skill:<name>` now stages a skill pill before send.
- Settings UX is more resilient (including no-project mode) with sidebar-integrated navigation while Settings is open.
- Terminal now runs as a docked bottom panel in chat, with reduced timeline noise.
- Desktop auto-refreshes runtime auth state when `~/.pi/agent/auth.json` changes after login/logout.
- Bundled/default themes now conform to full Pi CLI theme schema, with legacy-theme auto-repair.
- Cross-platform `v1.0.0` artifacts are published for macOS, Windows, and Linux.

---

## Features

### Feature snapshot (short)

- Multi-workspace, project-aware desktop shell for Pi
- Session-first chat workflow with streaming, tools, and thinking timeline
- Docked terminal, right-side file split, and command palette
- Deterministic slash commands + runtime-discovered extension/skill/prompt commands
- Package/resource management (`pi install/remove/update/list`) in-app
- Model/provider picker with auth actions and diagnostics
- Robust settings, updates, and no-project-safe UX

### Built-in features (technical)

- **Workspace/session architecture**
  - Workspace + project sidebar with pin/reorder semantics
  - Session-first tabs (chat-centered), session browser/history/fork flows
  - Session context actions (including **Mark unread**)

- **Chat + composer**
  - Streaming chat UI with compact workflow/tool/thinking timeline
  - Composer slash palette with deterministic slash execution
  - Full input history (`ArrowUp` / `ArrowDown`), queued follow-ups, and message actions

- **Commands + shortcuts**
  - Built-in slash commands for settings/model/import/export/share/tree/fork/resume/compact/reload/quit
  - Command palette + shortcuts panel

- **Model/provider/auth**
  - Model picker with provider grouping + login/logout actions
  - Account diagnostics + auth status visibility
  - Auto-refresh of auth state when `~/.pi/agent/auth.json` changes

- **Terminal + files**
  - Docked xterm terminal panel in chat
  - Right-side file split panel with resize
  - Drag/drop attachments and file reference pills in composer

- **Packages/resources/themes**
  - Package manager pane (`pi install/remove/update/list`)
  - Recommended package + skill catalogs
  - Package settings modal with capability-driven Save/Apply UX
  - Bundled desktop themes + CLI-schema-compatible theme handling

- **Settings + updates + reliability**
  - Simplified Settings IA with no-project-safe behavior
  - **Manual CLI binary path override** in Settings (all OS) for environments where PATH discovery is unreliable
  - First-run CLI onboarding when `pi` is missing
  - In-app desktop + CLI update checks/actions
  - Inline runtime/provider error visibility in chat timeline
  - Native notifications via extension UI boundary (`ctx.ui.notify`)

Detailed capability map: [`FEATURE_MAPPING.md`](./FEATURE_MAPPING.md)

---

## Download

Go to **[Releases](https://github.com/gustavonline/pi-desktop/releases)** and download:
- macOS: `.dmg` + app bundle archive (`.app.tar.gz`)
- Windows: `.exe` (NSIS installer) and/or `.msi`
- Linux: `.AppImage` and `.deb`

Latest stable release: **[`v1.0.0`](https://github.com/gustavonline/pi-desktop/releases/tag/v1.0.0)** (2026-04-13).

If no release is available yet, follow **Build from source** below.

### Unsigned build notes

#### macOS (Gatekeeper)
Until notarized signing is configured, macOS may block downloaded builds with messages like “app is damaged”.

Use one of these options:

1. Terminal workaround:

```bash
xattr -cr /Applications/Pi\ Desktop.app
```

2. System Settings workaround:
   - Open **System Settings → Privacy & Security**
   - Find the blocked Pi Desktop warning
   - Click **Open Anyway** and confirm

#### Windows (SmartScreen)
If SmartScreen appears:
- Click **More info**
- Click **Run anyway**

#### Linux (AppImage)
If needed:

```bash
chmod +x Pi.Desktop_<version>_amd64.AppImage
```

---

## First run

On launch, Pi Desktop checks for the `pi` CLI.

If it is missing, the app shows an onboarding card with install instructions:

```bash
npm install -g @mariozechner/pi-coding-agent
```

Notes:
- This installs a **public npm package** (`@mariozechner/pi-coding-agent`), so no npm auth token is required for normal users.
- Pi Desktop itself is distributed via **GitHub Releases** (not npm).

Then click **Retry** in-app.

---

## Build from source

### Prerequisites

- Node.js >= 22
- Rust toolchain
- Platform build dependencies for Tauri 2

### Dev

```bash
npm install
npm run tauri dev
```

### Production build

```bash
npm run check
npm run build:frontend
npm run tauri build
```

Artifacts are generated under:

`src-tauri/target/release/bundle/`

---

## Architecture

See:
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)**
- **[`docs/CAPABILITY_MODEL.md`](./docs/CAPABILITY_MODEL.md)**

Short version:
- **Frontend (Lit/TypeScript)**: UI shell, panes, interactions
- **Tauri backend (Rust)**: native bridge, CLI process management, filesystem/window commands
- **Pi RPC bridge**: typed JSON-RPC-style line protocol over stdin/stdout
- **Packages/extensions**: opt-in behavior and UI integrations through the extension UI protocol

> Stack note: this project uses **Lit**, not React.

---

## Packages and extension model

See: **[`docs/PACKAGES.md`](./docs/PACKAGES.md)**

Pi Desktop treats packages as first-class building blocks:
- install globally or per project,
- surface loaded resources in-app,
- keep policy/automation outside the shell when possible.

---

## Security and permissions

See: **[`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)**

Tauri capabilities currently include filesystem and shell permissions needed to run Pi and manage project resources. Review before deploying in restricted environments.

---

## Releases

See: **[`docs/RELEASES.md`](./docs/RELEASES.md)**

Release-related docs:
- [`docs/RELEASES.md`](./docs/RELEASES.md)
- [`docs/ICONS.md`](./docs/ICONS.md) (icon source + regeneration + validation)

GitHub Actions workflows are set up for:
- CI validation
- tagged cross-platform release builds (macOS + Windows + Linux)

---

## Contributing

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Open an issue before large changes
- Keep changes aligned with extension-first architecture and minimal UX goals

---

## License

MIT — see [`LICENSE`](./LICENSE)

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=gustavonline/pi-desktop&type=Date)](https://www.star-history.com/#gustavonline/pi-desktop&Date)
