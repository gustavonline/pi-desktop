# TODO — V1/V1.1 release cleanup plan

## Session update (2026-04-04) — Issue #70

Status: **In progress, near completion**

Done in this session:
- [x] Replaced hardcoded slash “Actions” with CLI-aligned command handling + runtime command discovery (`extension`/`prompt`/`skill`).
- [x] Fixed slash execution reliability (`/compact`, `/settings`, `/model`, etc.) so slash input no longer falls back to sending plain `/` prompts.
- [x] Added deterministic slash selection behavior (exact match / active menu item) and unknown-command handling.
- [x] Removed command echo noise in chat canvas for desktop-mapped slash actions.
- [x] Reworked compaction UX to minimal workflow-style row (no heavy card), with collapsed-by-default details and timeline-stable insertion.
- [x] Fixed workflow summary counts to report combined outcomes (e.g. complete + failed + running).
- [x] Removed blinking streaming cursor from assistant message body.
- [x] Removed composer status line noise beneath model picker.

Remaining before closing #70:
- [ ] Final command-by-command QA matrix pass and polish (especially less-used built-ins and extension-config command mappings).
  - [x] Composer history polish complete (`ArrowUp`/`ArrowDown` traverses full message/command history terminal-style).
  - [x] Slash palette keyboard UX polish complete (active row visibility + live composer command preview while navigating).
  - [x] Command palette keyboard visibility polish complete (selected command row auto-scrolls into view).
  - [x] User message bubble width/render regression fixed (no more squeezed `he j` wrapping artifacts on short messages).
  - [x] `/name` parity pass complete (inline sidebar rename when no arg, shared rename pipeline when arg provided).
  - [x] `/new` parity pass complete (reuses sidebar fresh-session flow via `startFreshSessionTab()`).
  - [x] `/import` parity pass complete (supports native file picker when no path arg is provided).
  - [x] `/export` parity pass complete (supports native save picker when no path arg is provided).
  - [x] `/reload` parity pass complete (restarts active runtime bridge, then refreshes state/models/commands).
  - [x] `/session` parity pass complete (renders detailed session info block in timeline, not just a toast).
  - [x] `/share` parity pass complete (CLI-aligned secret gist flow via `gh`, exported as `session.html`, minimal clickable output).
  - [x] `/tree` UX polish pass complete (supports prefilled `/tree <query>`, full JSONL-backed session-tree browse across branches, terminal-like inline tree connectors, active-path markers, and quick fork actions).
  - [x] `/scoped-models` native Settings implementation complete (searchable model scope editor with provider toggles + persisted `enabledModels` save path).
  - [x] `/login` + `/logout` polish pass complete (terminal-only guidance with compact auth row; no misleading settings mapping).
  - [x] `/changelog` parity pass complete (loads Pi Coding Agent changelog from CLI package; shows latest sections in collapsible/scrollable row with `/changelog all` option).
  - [x] `/fork` parity pass updated (`/fork <query>` pre-fills user-message fork selector, aligned with CLI user-only fork model).
  - [x] `/resume` UX polish pass complete (`/resume <query>` pre-fills session-browser search).
  - [x] `/model` UX polish pass complete (non-exact args open picker with provider-aware hinting; no noisy mismatch toast).
- [ ] Update issue comments/changelog with final verified behavior and close #70 only after smoke checks.
- [ ] Keep `/tree` + `/fork` minor UI polish out of #70 close criteria and track in dedicated follow-up issue (`issues/tree-fork-polish-followup.md`).

## Chat interface sweep plan (new branch)

Branch: `feat/chat-interface-issue-sweep` (based on `origin/dev`)

Scope (deduped): **#49, #50, #52, #53, #54, #55, #63, #70, #72**

Latest session recap (chat sweep):
- [x] Workflow dropdown state stabilized (manual collapse override respected during active runs).
- [x] Thinking/tool timeline ordering and streaming dedupe hardened.
- [x] Code-block UX polished and assistant-level duplicate copy action removed for pure fenced-block replies.
- [ ] Remaining: slash action audit/cleanup (#70) and final PR packaging/issue closure notes.

### A) Markdown/code rendering integrity + readability
Issues: #49, #50, #54

- [x] #49 Ensure fenced code blocks always render in chat and file markdown contexts.
  - [x] Verify `CodeBlock` component registration/import in all markdown hosts.
  - [ ] Add regression check for language-tagged and plain fenced blocks.
- [x] #50 Make code-block copy actions hover/focus-only (keyboard accessible).
  - [x] No layout jump when action appears.
  - [x] Keep inline code behavior unchanged.
- [x] #54 Remove chat-level horizontal overflow for normal text flow.
  - [x] Add robust wrapping (`overflow-wrap`) for long tokens/pasted formatted text.
  - [x] Preserve horizontal scroll only inside code blocks.

Acceptance gate:
- [ ] No missing code blocks
- [ ] No chat-level horizontal scrollbar for normal messages
- [ ] Copy action UX matches hover/focus behavior

### B) Chat canvas tool/compaction noise reduction
Issues: #52, #55, #72

- [x] #52 Compact tool rows by default with meaningful action preview text.
  - [x] Progressive disclosure for full details.
  - [x] Group repeated consecutive same-tool runs (`tool × N`).
- [x] #55 Use a single collapsible compaction status element per cycle.
  - [x] State transitions in-place (`running -> done -> error`) with no duplicate blocks.
- [x] #72 Investigate/fix weird tool result rows after steer message.
  - [x] Reproduce from screenshot scenario.
  - [x] Add guard/normalization for post-steer tool event/result mapping.

Acceptance gate:
- [ ] Assistant text remains dominant in tool-heavy runs
- [ ] No duplicate compaction/tool status boxes
- [ ] Steer flow no longer produces malformed tool entries

### C) Composer/scroll/actions behavior
Issues: #53, #70

- [x] #53 Dynamic composer offset so latest content is always visible.
  - [x] Measure composer with `ResizeObserver`.
  - [x] Drive chat bottom padding and jump-to-latest offset via CSS variable.
- [ ] #70 Audit slash actions (`/`) and keep only meaningful chat-surface actions.
  - [ ] Verify `/compact` and other supported actions are functional.
  - [x] Remove/disable slash actions already covered by better UX entrypoints.

Acceptance gate:
- [ ] Bottom-most assistant content never hidden by tall composer
- [ ] Slash action list is reliable and intentionally curated

### D) Roadmap alignment / parity integration
Issue: #63 (umbrella)

- [ ] Keep #63 open as umbrella and close sub-issues via implementation PRs.
- [ ] Track completed slices in issue comments + changelog after each merge.
- [ ] Ensure clean-room parity guardrails remain documented in PR descriptions.

### Execution order (recommended PR slicing)

- [x] PR-1: Rendering integrity baseline (#49, #54)
- [x] PR-2: Code block UX polish (#50)
- [x] PR-3: Composer offset + scroll correctness (#53)
- [x] PR-4: Tool/compaction timeline cleanup (#52, #55, #72)
- [ ] PR-5: Slash action audit/cleanup (#70)
- [ ] PR-6: #63 rollout summary + visual QA pass

### Test matrix (must pass before closing issues)

- [ ] Long markdown/code responses (tagged + untagged fenced blocks)
- [ ] Large pasted formatted text (no chat horizontal overflow)
- [ ] Tall composer + attachments + long streaming response
- [ ] Steer/follow-up runs with multiple tool calls
- [ ] Slash command smoke (`/compact`, curated list)
- [ ] Dark/light visual regression snapshots

## Active issue (current session)
- [x] #33 RPC reliability: fix duplicate tool cards + loading/reconnect UX
  - [x] Make RPC bridge listener setup idempotent under concurrent `ensureListeners()` calls
  - [x] De-dup tool cards by `toolCall.id` (live events + backend hydration)
  - [x] Disable composer send while RPC binding/reconnecting and surface status inline
  - [x] Add unsigned macOS workaround command to release template
  - [x] Validate: `npm run check`, `npm run build:frontend`, `cargo check --manifest-path src-tauri/Cargo.toml`

## Goal
Ship Pi Desktop as a **minimal native desktop host for Pi**:
- strong desktop shell / UX
- correct multi-session RPC architecture
- native OS capabilities
- clean support for Pi packages, extensions, skills, prompts, and themes
- extension-driven agent behavior instead of hardcoded product logic

---

## 1) Product boundary: keep in app vs move out

### Keep hardcoded in the desktop app
These are the host/shell responsibilities and should stay native/app-owned.

- [x] Workspace shell (top bar, drag, pin, emoji, rename, close)
- [x] Sidebar, pane navigation, content tabs, no-project dashboard
- [x] File/chat/terminal/packages panes
- [x] Multi-session / multi-runtime RPC orchestration
- [x] Per-tab session isolation and generation-safe runtime lifecycle
- [x] Native window / focus / filesystem / open-in-editor integration
- [x] Extension UI host surface:
  - [x] `select`
  - [x] `confirm`
  - [x] `input`
  - [x] `editor`
  - [x] `notify`
  - [x] `setStatus`
  - [x] `setWidget`
  - [x] `setTitle`
  - [x] `set_editor_text`
- [x] Native notification capability plumbing (Tauri notification plugin)

### Move out of app / keep extension-driven
These should be packages/extensions/skills unless there is a very strong reason otherwise.

- [ ] Notification policy (`agent_end` => notify, errors, approvals, etc.)
- [ ] Workflow behaviors (plan mode, auto-rename, repo policies, guards)
- [ ] Optional agent automations and integrations
- [ ] Project/team conventions and special commands
- [ ] “Smart default” agent behaviors that are not shell responsibilities

---

## 2) Resource/package architecture cleanup

### Done in this pass
- [x] Reset `TODO.md` from historical issue log to a focused release cleanup plan
- [x] Promote the main `Packages` pane into the primary packages/resources surface
- [x] Add manual package source input to `Packages` pane:
  - [x] npm
  - [x] git
  - [x] URL
  - [x] local path
- [x] Add package actions directly in `Packages` pane:
  - [x] Install
  - [x] Remove
  - [x] Update
  - [x] List
- [x] Add in-pane command activity log for package actions
- [x] Add loaded resource view inside `Packages` pane for command-backed resources:
  - [x] Extensions
  - [x] Prompt templates
  - [x] Skills
- [x] Make command palette `packages` action open the workspace `Packages` pane instead of the legacy overlay
- [x] Stop instantiating the old `ExtensionsPanel` overlay from `main.ts`
- [x] Make global package commands cwd-neutral (`/`) so app-repo cwd does not pollute global package state
- [x] Make package listing use a neutral cwd for user/global package discovery

### Still to clean up
- [x] Remove the now-unused legacy `src/components/extensions-panel.ts` file and dead CSS tied only to that overlay
- [ ] Replace the current command-backed resource view with a fuller resource model when Pi exposes/permits it cleanly:
  - [ ] installed packages
  - [ ] loaded extensions
  - [ ] loaded skills
  - [ ] loaded prompts
  - [ ] loaded themes
  - [ ] origin/source metadata
  - [ ] scope metadata
- [x] Add first-class “recommended packages” section
- [x] Make recommended packages external-sourced (`npm` / `git` / `url`) instead of bundling behavior packages into the app
- [x] Keep global install as the default in the UI, with project install as an explicit/manual choice
- [x] Add richer package metadata in the pane:
  - [x] source badges (`npm`, `git`, `local`)
  - [x] better project/global scoping cues
  - [x] simplify the Packages pane into a more minimalist list/row layout with less repeated chrome/text
  - [x] remove manual source install bar from the top-level flow; keep install action on package rows
  - [x] diagnostics/load errors where possible
- [ ] Add proper per-resource enable/disable UX
  - [ ] do **not** shell users into the interactive `pi config` TUI
  - [ ] prefer direct config/settings-driven desktop UX

---

## 3) Notification boundary cleanup

### Keep in app
- [x] Native macOS/Tauri notification support exists in the app host
- [x] App can detect background/focus state
- [x] App can focus/show the window from notification action

### Still to do
- [x] Remove hardcoded app-level “agent finished => notify” policy from `src/main.ts`
- [x] Route desktop notifications through the generic extension UI host boundary instead
- [x] Treat extension/package `notify` calls as the primary policy mechanism
- [x] Build or adopt a **desktop-safe** notification package/extension
  - [x] use `ctx.ui.notify(...)`
  - [x] do **not** rely on terminal OSC escape sequences in RPC desktop mode
- [ ] Evaluate whether the default release experience should ship with:
  - [ ] no default notification package
  - [x] external/recommended notification package
  - [ ] opt-in first-run “Enable notifications” flow
- [ ] Ensure upstream `pi-desktop-notify` release is RPC-desktop-safe (`ctx.ui.notify`) without terminal-focus/stdout side effects (current npm v1.0.1 needed a local hotfix during testing)

### Important note
- [x] Verified: `pi-notify` is real and useful for terminal-hosted Pi
- [x] Verified: it is **not** the right primitive to rely on directly inside RPC-based Pi Desktop because it writes terminal notification escape sequences / terminal-host-specific output

---

## 4) Desktop support for the Pi ecosystem
The app should feel native while still reflecting Pi’s actual resource model.

### Must support well
- [x] Packages via `pi install/remove/update/list`
- [x] Global vs project package scope
- [x] Skills as a first-class concept in the UI
- [x] Extensions as a first-class concept in the UI
- [x] Prompt templates as a first-class concept in the UI
- [ ] Themes as a first-class concept in the UI (currently not enumerated via RPC in the pane)
- [ ] Local resource sources from settings (`extensions`, `skills`, `prompts`, `themes` arrays)
- [ ] External skill dirs (e.g. `~/.claude/skills`, `~/.codex/skills`) surfaced clearly when loaded
- [ ] Resource origin transparency (package vs user dir vs project dir vs custom settings path)

### UX direction
- [x] One main Packages/Resources surface is preferred over multiple overlapping management UIs
- [ ] Add a cleaner information architecture for the pane, likely around:
  - [x] Explore (always-visible in-app catalog with direct install actions)
  - [x] Installed (flat list with per-row scope)
  - [ ] Loaded resources (moved out of top-level flow; still needs final diagnostics/resource model pass)
  - [x] Recommended

---

## 5) Remaining host/runtime cleanup before release

### Core runtime / UX
- [ ] Finish explicit `ChatView.bindRuntime(runtime | null)` / `unbindRuntime()` cleanup to reduce reliance on proxy-style active bridge assumptions
- [ ] Surface runtime activation phases in the UI (`starting`, `switching`, `ready`, `failed`) instead of only debug traces/internal state
- [x] Harden RPC JSON line parsing against ANSI/control-sequence prefixes so first responses don’t get dropped
- [x] Simplify the no-project welcome/dashboard state into a lighter single-flow layout with less duplicate summary content
- [x] Move workspace switching from the top strip into the left sidebar (dropdown list + new workspace action)
- [x] Restore sidebar collapse/expand access after workspace strip removal
- [x] Add workspace switcher polish: old emoji-picker UX + drag-to-reorder in the sidebar menu
- [x] Rework workspace drag reorder to pointer-driven behavior for stable Tauri/WebKit interaction
- [x] Add sidebar workspace context actions (pin/unpin, rename, delete)
- [x] Add pinned/unpinned visual separator in the sidebar workspace list
- [x] Align sidebar workspace header height with content tabs top row
- [x] Add content-tab pin/unpin + drag reorder with pinned divider semantics
- [x] Replace project marker dots/pins with emoji + picker
- [x] Add project pin-group reorder (drag within pinned/unpinned groups + divider)
- [x] Remove top action glyphs in sidebar buttons (text-first "New session/New file" + "Packages")
- [x] Remove animated/dot unread styling; keep static unread emphasis (bold + italic)
- [x] Add first-run onboarding card when Pi CLI is missing (install + copy command + retry)
- [x] Add in-app Pi CLI update signaling (startup + daily reminder + sidebar hint + settings update path)
- [x] Harden settings pane open/render lifecycle across no-project + project-switch states (#69)
- [x] Rework Settings IA: move section navigation into the main app sidebar while Settings content becomes cleaner/simpler in the right pane (no-project-safe section fallback retained).
- [x] Refine no-project/new-thread welcome dashboard toward clean Codex-inspired centered flow (#63, partial)
- [ ] Final new-file draft UX polish pass
- [ ] Final session delete/select stability polish pass

### Manual smoke tests that still matter
- [ ] Parallel runs in separate session tabs with different models
- [ ] Legacy session restore / old session reopen after restart
- [x] Remove all projects => immediate clean no-project dashboard
- [ ] Packages pane navigation from no-project state
- [ ] Package install/remove/update/list flow in real Tauri app
- [ ] Command-backed resources actually reflect installed extensions/skills/prompts on machine
- [ ] Native background notification end-to-end after the notification boundary cleanup

---

## 6) Release decision

### V1 if these are true
- [ ] No known P0 runtime/disconnect regressions remain
- [ ] Packages/resources surface is coherent enough for normal users
- [ ] Notification story is architecturally clean enough (even if default package ships later)
- [ ] Manual smoke pass is green on the affected flows
- [x] `npm run check` green
- [x] `npm run build:frontend` green
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` green
- [x] `npm run tauri build` green

### Otherwise ship as v1.1 milestone instead
- [ ] If notification boundary cleanup or resource architecture still feels half-finished, call this the v1.1 cleanup track instead of forcing a premature v1 label

---

## 7) Immediate next implementation steps
- [x] Remove legacy `ExtensionsPanel` file and dead overlay styles
- [x] Refactor notification flow so package/extension policy drives host notification delivery
- [x] Decide and implement the default desktop-safe notification package story
- [ ] Do the final scoped smoke test pass
- [ ] Cut release branch / tag once clean
