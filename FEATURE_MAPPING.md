# Pi CLI → Pi Desktop Feature Mapping

This document maps `pi` CLI capabilities to this Tauri desktop app (`pi-desktop`).

## Current Status Snapshot (2026-02-17)

### Stable / shipped
- React-only desktop UI architecture
- RPC process lifecycle (discover + start/stop + command bridge)
- Project-centric sidebar with persisted projects and per-project session lists
- Session metadata surfacing (tokens/cost/age) from real session files
- Streaming chat UX with tool blocks, thinking blocks, queue controls, and image attachments
- Settings runtime diagnostics (auth status, CLI version checks, compatibility probes)

### Partial / still being hardened
- Release/distribution pipeline hardening (issue #5): reproducible Windows/macOS packaging, signing/notarization playbooks
- Release automation depth (currently manual verification workflow)

### Known limits
- Interactive TUI-only workflows not exposed by RPC remain out of scope (see section 10)

## 1) Foundation / Architecture

| CLI capability | Desktop mapping |
|---|---|
| `pi --mode rpc` JSON protocol | ✅ Core transport used by app (`src/rpc/bridge.ts` + Rust process manager) |
| Cross-platform process execution | ✅ Tauri backend discovery: dev path → sidecar search → PATH binary |
| Native-like custom frame | ✅ Custom draggable titlebar + native window controls |
| Frontend architecture for OSS scaling | ✅ React entrypoint (`src/main.tsx`) + React orchestration (`src/bootstrap.ts`) |
| Session files in `~/.pi/agent/sessions` | ✅ Indexed via Rust backend (`list_sessions`) |

## 2) Chat + Agent Loop

| CLI capability | Desktop mapping |
|---|---|
| Prompting (`prompt`) | ✅ Main composer send action |
| Streaming assistant deltas (`message_update`) | ✅ Live markdown stream with cursor |
| Tool call lifecycle (`tool_execution_*`) | ✅ Collapsible per-tool blocks + streaming output |
| Thinking deltas | ✅ Collapsible thinking blocks + global toggle |
| Abort (`abort`) | ✅ Esc + Stop button |
| Message-level UX actions | ✅ Per-message copy/edit/retry |
| Auto-compaction events | ✅ Status pill + toast notifications |
| Auto-retry events | ✅ Retry status pill + error toast |

## 3) Models, Thinking, Queueing

| CLI capability | Desktop mapping |
|---|---|
| `get_available_models` + `set_model` + `cycle_model` | ✅ Model dropdown + Ctrl/Cmd+M quick cycle |
| `set_thinking_level` + `cycle_thinking_level` | ✅ Thinking dropdown + Shift+Tab cycle |
| Queue semantics (`steer`, `follow_up`) | ✅ Enter=steer while streaming, Alt+Enter=follow-up |
| Queue mode config (`set_steering_mode`, `set_follow_up_mode`) | ✅ Settings panel controls |
| Pending queue count | ✅ Titlebar and chat metadata indicators |

## 4) Projects + Sessions

| CLI capability | Desktop mapping |
|---|---|
| Project context switching | ✅ Sidebar project selection triggers RPC cwd switch + chat/model refresh |
| Per-project session listing | ✅ Sidebar groups sessions by `cwd` (with fallback path heuristics) |
| Session metadata | ✅ tokens/cost/modified surfaced in sidebar/session browser |
| New session (`new_session`) | ✅ Toolbar + shortcut + titlebar + project-row action |
| Switch session (`switch_session`) | ✅ Sidebar + session browser (`sessionPath` payload key) |
| Session naming (`set_session_name`) | ✅ Chat toolbar “Name” action |
| Session stats (`get_session_stats`) | ✅ Live tokens/cost in titlebar |
| Fork (`get_fork_messages` + `fork`) | ✅ Fork picker in chat + session browser mode |
| Export HTML (`export_html`) | ✅ Export + open file + copy exported HTML |
| Session message history (`get_messages`) | ✅ History overlay with search/filter/reveal/copy/edit |

## 5) Command + Resource Discoverability

| CLI capability | Desktop mapping |
|---|---|
| `get_commands` (extensions/prompts/skills) | ✅ Command palette with search + execute |
| Extension/prompt/skill visibility | ✅ Extensions panel grouped by source |
| Sidebar project persistence | ✅ LocalStorage-backed project list |

## 6) Package Management

| CLI capability | Desktop mapping |
|---|---|
| `pi install/remove/update/list` | ✅ Package manager tab executes real CLI commands via backend (`run_pi_cli_command`) |
| Global vs local scope (`-l`) | ✅ Scope toggle in package manager UI |

## 7) Extension UI Protocol

| CLI capability | Desktop mapping |
|---|---|
| `extension_ui_request` dialog methods | ✅ `select` / `confirm` / `input` / `editor` overlays |
| notify/status/widget/title fire-and-forget methods | ✅ Implemented in handler |
| `set_editor_text` | ✅ Composer prefill wiring |
| `extension_ui_response` | ✅ Sent via `rpc_ui_response` bridge helper |

## 8) Media / Attachments

| CLI capability | Desktop mapping |
|---|---|
| Prompt images (`images` on prompt/steer/follow_up) | ✅ Attach button, drag-drop, clipboard paste |
| Inline attachment display in user messages | ✅ Thumbnail chips in chat |

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

## 10) Known RPC-mode Limits

Some CLI interactive commands/components are not exposed by RPC, so they are not 1:1 reproducible unless implemented through custom extensions or non-RPC embedding:
- Interactive-only slash UIs (for example `/login`, `/settings`, `/tree` selectors)
- Full custom TUI component rendering from interactive mode
- Editor/TUI behaviors that depend on terminal-native primitives

Pi Desktop covers the RPC-exposed surface and adds desktop-native workflows on top.

## Next Steps

- Close distribution/release hardening gap (issue #5)
- Keep compatibility messaging strict and actionable across CLI versions
- Add CI enforcement around `npm run check` + `npm run tauri build`
