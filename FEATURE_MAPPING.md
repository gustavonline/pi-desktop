# Pi CLI → Pi Desktop Feature Mapping

This document maps `pi-mono/packages/coding-agent` capabilities to this Tauri desktop app (`pi-desktop`).

## 1) Foundation / Architecture

| CLI capability | Desktop mapping |
|---|---|
| `pi --mode rpc` JSON protocol | ✅ Core transport used by app (`src/rpc/bridge.ts` + Rust process manager) |
| Cross-platform binary/process execution | ✅ Tauri Rust backend discovers `pi` via dev path → bundled sidecar → PATH |
| Native-like custom frame | ✅ Custom draggable titlebar + native window controls |
| Frontend architecture for OSS scaling | ✅ React entrypoint (`src/main.tsx`) + React-rendered core surfaces (`titlebar`, `sidebar`, `settings-panel`) with remaining Lit bridge (`src/legacy-bootstrap.ts`) |
| Session files in `~/.pi/agent/sessions` | ✅ Indexed via Rust backend (`list_sessions`) for sidebar/session browser |

## 2) Chat + Agent Loop

| CLI capability | Desktop mapping |
|---|---|
| Prompting (`prompt`) | ✅ Main composer send action |
| Streaming assistant deltas (`message_update`) | ✅ Live markdown stream with cursor |
| Tool call lifecycle (`tool_execution_*`) | ✅ Collapsible per-tool blocks + streaming output |
| Thinking deltas | ✅ Collapsible thinking blocks, global toggle |
| Abort (`abort`) | ✅ Esc / Stop button |
| Message-level UX actions | ✅ Per-message copy / edit / retry hover actions |
| Auto-compaction events | ✅ Status pill + toast notifications |
| Auto-retry events | ✅ Retry status pill + error toast |

## 3) Models, Thinking, Queueing

| CLI capability | Desktop mapping |
|---|---|
| `get_available_models` + `set_model` + `cycle_model` | ✅ Model dropdown + Ctrl/Cmd+M quick cycle |
| `set_thinking_level` + `cycle_thinking_level` | ✅ Thinking dropdown + Shift+Tab cycle |
| Message queue semantics (`steer`, `follow_up`) | ✅ Enter=steer while streaming, Alt+Enter=follow-up |
| Queue mode config (`set_steering_mode`, `set_follow_up_mode`) | ✅ Settings panel controls |
| Pending queue count | ✅ Titlebar/session state indicators |

## 4) Sessions

| CLI capability | Desktop mapping |
|---|---|
| New session (`new_session`) | ✅ Toolbar + shortcut + titlebar action |
| Switch session (`switch_session`) | ✅ Sidebar project sessions + session browser |
| Session naming (`set_session_name`) | ✅ Chat toolbar “Name” action |
| Session stats (`get_session_stats`) | ✅ Live tokens/cost in titlebar |
| Fork (`get_fork_messages` + `fork`) | ✅ Fork picker UI in chat + session browser |
| Export HTML (`export_html`) | ✅ Export + open file + copy exported HTML |
| Session message history inspection (`get_messages`) | ✅ History overlay with search/filter/reveal/copy/edit |

## 5) Command/Resource Discoverability

| CLI capability | Desktop mapping |
|---|---|
| `get_commands` (extensions/prompts/skills) | ✅ Command palette with search + execute |
| Extension/prompt/skill visibility | ✅ Extensions panel grouped by source |
| Sidebar project context | ✅ Persisted projects + per-project session list |

## 5b) Package Management

| CLI capability | Desktop mapping |
|---|---|
| `pi install/remove/update/list` | ✅ Desktop package manager tab executes real CLI commands via backend (`run_pi_cli_command`) |
| Global vs local install scopes (`-l`) | ✅ Scope toggle in package manager UI |

## 6) Extension UI Protocol

| CLI capability | Desktop mapping |
|---|---|
| `extension_ui_request` dialog methods | ✅ select/confirm/input/editor overlays |
| notify/status/widget/title fire-and-forget methods | ✅ implemented in handler |
| `set_editor_text` | ✅ wired to chat composer prefill |
| `extension_ui_response` | ✅ sent via `rpc_ui_response` bridge helper |

## 7) Media / Attachments

| CLI capability | Desktop mapping |
|---|---|
| Prompt images (`images` on prompt/steer/follow_up) | ✅ Attach image button, drag-drop, clipboard paste |
| Inline attachment display in user messages | ✅ Thumbnail chips in chat |

## 8) Settings + Theming

| CLI capability | Desktop mapping |
|---|---|
| Theme switching | ✅ Dark/light runtime toggle + persisted local setting |
| Auto-compaction toggle | ✅ Settings panel |
| Auto-retry toggle | ✅ Settings panel |
| Queue mode settings | ✅ Settings panel |
| Auth/account visibility | ✅ Settings panel inspects `auth.json` + known provider env vars |
| CLI update visibility | ✅ Settings panel compares local CLI version vs npm latest and offers in-app update (PATH installs) |
| RPC compatibility verification | ✅ Startup and settings-triggered compatibility probes (`get_state` / `get_commands` / `get_available_models`) |
| RPC capability fallback messaging | ✅ Optional capability probe warnings + actionable per-feature error messages when CLI lacks support |
| Update discoverability UX | ✅ Titlebar badge/button appears when CLI update is available |

## 9) Keyboard Shortcuts (Desktop)

Implemented shortcuts include:
- `Ctrl/Cmd+N` new session
- `Ctrl/Cmd+L` focus composer
- `Esc` abort
- `Ctrl/Cmd+M` cycle model
- `Shift+Tab` cycle thinking
- `Ctrl/Cmd+T` toggle thinking blocks
- `Ctrl/Cmd+K` / `Ctrl/Cmd+P` command palette
- `Ctrl/Cmd+R` session browser
- `Ctrl/Cmd+Shift+H` session history viewer
- `Ctrl/Cmd+,` settings
- `Ctrl/Cmd+Shift+C` copy last assistant message
- `Ctrl/Cmd+E` export HTML
- `Ctrl/Cmd+Shift+E` copy exported HTML
- `Ctrl/Cmd+Shift+T` toggle theme

## 10) Known RPC-mode Limits (CLI features that require interactive TUI)

Some CLI interactive commands/components are not exposed by RPC itself (per `docs/rpc.md`), so they are not 1:1 reproducible unless implemented through custom extensions or a non-RPC embedding:
- Built-in interactive-only slash UIs like `/login`, `/settings`, `/tree` TUI selectors
- Full custom TUI component rendering from interactive mode
- Certain direct editor/TUI behaviors that rely on terminal-native primitives

The desktop app covers the RPC-exposed feature set and adds desktop-native UX on top.
