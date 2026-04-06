# Commands development log (#70)

Last updated: 2026-04-06 (post-UX polish)

## Goal
Bring all composer slash commands to a stable, desktop-native behavior model where commands reuse existing UI/flows instead of ad-hoc implementations.

## Status summary
- ✅ Implemented: **17 / 20**
- 🟡 Partial / placeholder: **3 / 20** (`/tree`, `/login`, `/logout`)
- 🔴 Not implemented: **0 / 20**
- 📝 Deferred follow-up polish: `/tree` + `/fork` visual/interaction cleanup tracked separately (`issues/tree-fork-polish-followup.md`).

## Current implementation snapshot

| Command | Current behavior | Reuse quality | Notes |
|---|---|---:|---|
| `/settings` | Opens Desktop Settings pane | ✅ | Reuses same path as settings gear / app settings entry (`requestOpenSettingsPanel`). |
| `/model` | No arg opens picker. Exact arg sets model; non-exact arg opens picker with provider-aware hinting. | ✅ | Reuses existing model picker + `setModel`, avoids noisy no-match toasts while staying deterministic. |
| `/scoped-models` | Opens native Settings scoped-models editor (model enable/disable for Ctrl+P cycle) with search, provider toggles, save, and refresh. | ✅ | Persists to Pi global settings (`enabledModels`) and keeps Desktop behavior aligned with CLI model scope semantics. |
| `/export` | With arg: exports to provided path. Without arg: opens native save dialog and exports to chosen location. | ✅ | Reuses existing RPC `exportHtml`; adds desktop-native save picker for no-arg flow. |
| `/import` | With arg: imports from path. Without arg: opens native file picker, then imports selected session. | ✅ | Reuses existing RPC `switchSession` flow; adds desktop-native picker UX when no path is provided. |
| `/share` | Exports to `session.html`, creates a secret GitHub gist, then shows minimal clickable links (pi.dev + gist). | ✅ | CLI-aligned `gh gist create --public=false` flow via desktop host command (avoids chat bash-noise and keeps share output minimal). |
| `/copy` | Copies last assistant message | ✅ | Reuses existing copy path. |
| `/name` | With arg: renames through shared sidebar/main rename pipeline. Without arg: attempts inline sidebar rename editor, then falls back to prompt. | ✅ | Reuses same workspace/session rename path as sidebar context rename. |
| `/session` | Appends a detailed session info block to timeline (name/file/id/model, message + token stats). | ✅ | Mirrors CLI intent with richer in-chat output instead of a short toast. |
| `/changelog` | Shows latest changelog sections in a collapsed, scrollable chat row (`/changelog all` for full file, `/changelog refresh` to reload). | ✅ | Uses CLI discovery + package changelog resolution, then presents minimal in-canvas output (no browser URL dependency). |
| `/hotkeys` | Opens shortcuts panel | ✅ | Reuses shortcuts overlay. |
| `/fork` | Opens user-message fork selector (CLI-style); `/fork <query>` pre-fills user-message search. | ✅ | Uses RPC `get_fork_messages` directly, matching CLI behavior (select user turn to fork from). |
| `/tree` | Opens full session-tree viewer from JSONL with terminal-like inline connectors (`│ ├─ └─`), role-prefixed lines (`user:`/`assistant:`/`[tool:]`), active-path markers, query prefill, and quick Fork on user nodes. | 🟡 | Stronger CLI-style tree UX/readability, but still not full branch-switch navigation (`navigateTree`) parity in Desktop. |
| `/login` | Shows terminal guidance (`pi` then `/login [provider]`) with compact in-chat auth row. | 🟡 | Deterministic non-misleading placeholder until native Desktop OAuth flow exists. |
| `/logout` | Shows terminal guidance (`pi` then `/logout [provider]`) with compact in-chat auth row. | 🟡 | Deterministic non-misleading placeholder until native Desktop OAuth flow exists. |
| `/new` | Starts a fresh session tab using the same workspace flow as sidebar “New session”. | ✅ | Reuses `startFreshSessionTab()` path via chat callback; falls back to runtime `newSession()` only if callback is unavailable. |
| `/compact` | Runs compact with minimal compaction timeline row | ✅ | Implemented + polished in this session. |
| `/resume` | Opens session browser; `/resume <query>` pre-fills session search. | ✅ | Reuses existing session browser and filtering state (no new backend behavior). |
| `/reload` | Performs a runtime reload pass for active workspace/session (bridge restart + state/models/commands refresh). | ✅ | Reuses existing runtime orchestration (`ensureRuntimeForSessionTab`) instead of ad-hoc reload logic. |
| `/quit` | Closes app window | ✅ | Native app behavior. |

## Recent UX polish (2026-04-06)

- Composer now supports terminal-style full input history traversal with `ArrowUp` / `ArrowDown` (not only the last message).
- Slash palette keyboard navigation now keeps the highlighted row reliably visible when traversing long command lists.
- Slash palette keyboard highlight now previews the selected slash command directly in the composer input (`/mod` -> `Arrow` to `/model` updates the input live).
- Command Palette (`Cmd/Ctrl+K`) now auto-scrolls selected rows into view during keyboard navigation.

## Runtime commands
Runtime-discovered commands (`extension` / `prompt` / `skill`) come from `get_commands`.

- Extension `*-config` commands can be mapped to Desktop config UI.
- Current mapping implemented: `name-ai-config` -> opens package config modal for `pi-session-auto-rename`.

## Plan (step-by-step)
1. Validate `/name` parity smoke checks (with arg + no arg inline edit path).
2. Validate command-by-command smoke checks (project and runtime states).
3. Keep `/tree` + `/fork` behavior parity locked and ship minor UI polish via follow-up issue (post-#70).
4. Decide login/logout desktop OAuth scope vs explicit “terminal required” behavior.
5. Final #70 QA and closure notes.
