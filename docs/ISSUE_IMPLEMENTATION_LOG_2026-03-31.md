# Issue implementation log (2026-03-31)

This log now covers both implementation tracks completed/advanced on 2026-03-31:

1. **Theme/settings/welcome track** on `feat/66-theme-schema-cli-compat` (merged to `dev` via PR #73)
2. **Chat interface sweep track** on `feat/chat-interface-issue-sweep` (pushed branch, PR creation pending)

---

## Status by affected issue

- **#49** Markdown code-block render integrity — **Implemented (chat sweep branch)**
- **#50** Code-block copy UX polish — **Implemented (chat sweep branch)**
- **#52** Tool-call compact workflow timeline — **Implemented (chat sweep branch)**
- **#53** Composer offset + scroll correctness — **Implemented (chat sweep branch)**
- **#54** Chat overflow/wrapping robustness — **Implemented (chat sweep branch)**
- **#55** Single compaction-cycle UI — **Implemented (chat sweep branch)**
- **#63** Codex parity umbrella — **Partially implemented** (welcome slice merged; chat slice implemented on sweep branch)
- **#66** Theme schema / CLI compatibility — **Merged to dev (PR #73)**
- **#69** Settings pane render hardening — **Merged to dev (PR #73)**
- **#70** Slash action audit/cleanup — **In progress (major implementation complete, final QA/polish pending)**
- **#72** Tool-result/steer timeline anomalies — **Implemented (chat sweep branch)**

---

## #66 — Theme schema / CLI compatibility

Status: **Merged to `dev` via PR #73**

Implemented:
- Bundled themes now emit full Pi CLI-compatible schema documents (required tokens + schema URL).
- Legacy invalid bundled theme files in `~/.pi/agent/themes/pi-desktop-*.json` are auto-repaired on install/restore.
- Settings “Create theme” now exports full schema-compatible documents.

---

## #69 — Settings pane blank/failed render hardening

Status: **Merged to `dev` via PR #73**

Implemented:
- Deterministic pane open/mount handling with race/rebind guards.
- Safe fallback settings shell when runtime-dependent sections fail.
- No-project settings flow decoupled from runtime-dependent rendering.
- Codex-style Settings information architecture: section navigation now lives in the main Desktop left sidebar (replacing project/session list while Settings is open), with right-side contextual panel rendering per section.
- Runtime-gated sections (`General`, `Account`) now gracefully disable/fallback in no-project or disconnected runtime states while `Appearance` and update visibility remain usable.

---

## #63 — Codex-inspired parity umbrella

Status: **Partial (split across tracks)**

Implemented in merged track (`feat/66...`):
- Centered no-project/new-thread welcome/dashboard redesign.
- Project-focused dropdown with workspace project listing + direct switching.

Implemented in chat sweep branch (`feat/chat-interface-issue-sweep`):
- Compact Codex-style tool workflow summaries.
- Reduced tool chrome with grouped rows and progressive disclosure.
- Improved markdown/code block visual polish and calmer minimalist hierarchy.

---

## Chat interface sweep details (`feat/chat-interface-issue-sweep`)

### #49 / #50 / #54 — Markdown and code rendering + UX

Implemented:
- Ensured fenced code blocks render reliably in chat/file markdown hosts.
- Refined code-block copy affordance (hover/focus behavior, reduced visual noise).
- Suppressed assistant-level copy action when a message is only a fenced code block (copy stays on the code block itself).
- Removed “card-in-card” feel in code blocks; tightened spacing and icon proportions.
- Hardened wrapping and overflow rules to avoid chat-level horizontal overflow for normal prose.

### #52 / #55 / #72 — Tool workflow and compaction timeline stabilization

Implemented:
- Single compact workflow summary per assistant run with duration-centered header.
- Grouped repeated consecutive tool runs; single-open tool detail behavior preserved.
- Compaction updates consolidated into one in-place cycle block.
- Manual-collapse override respected during active runs (no unwanted auto-reopen).
- Collapse behavior now defers to final assistant handoff instead of individual tool completion.
- Removed transient blank placeholder row generation that caused pre-workflow spacing jumps.
- Thinking/tool timeline now supports interleaving order from stream events (not forced top-only).
- Added stronger dedupe for repeated streamed thinking content.
- Improved handling for concurrent running tool groups and inline running indicators.

### #53 — Composer/scroll behavior

Implemented:
- Dynamic composer-aware bottom spacing with `ResizeObserver` and CSS offset variable.
- Maintained “latest” visibility behavior while streaming.

### #70 — Slash actions

Status: **In progress, near completion**

Progress (2026-04-04 follow-up):
- Replaced hardcoded slash action list with CLI-aligned built-in command handling plus runtime-discovered commands (`extension` / `prompt` / `skill`).
- Fixed slash reliability so composer `/` input executes commands deterministically instead of falling back to plain prompt sends.
- Desktop-mapped commands now execute host actions directly (e.g. settings/model/session browser flows) without chat-canvas command spam.
- Added extension config bridge hook for `name-ai-config` to open the Desktop Packages extension-config modal.
- Reworked compaction UX into a minimal workflow-style row with collapsed-by-default details and stable timeline placement.
- Removed assistant streaming cursor artifact and cleaned workflow status aggregation (`complete` + `failed` + `running`).

Additional UX hardening (2026-04-06 follow-up):
- Settings open flow hardened for `/scoped-models`: removed unsupported `innerHTML` mutation paths in `SettingsPanel` to avoid Lit `ChildPart has no parentNode` render failures during async section refreshes.
- Settings visual cleanup completed: sidebar-hosted settings navigation, workspace header hidden in settings shell, and simplified settings top chrome.
- Composer now supports terminal-style full history navigation via `ArrowUp`/`ArrowDown` for prior user prompts and slash commands.
- Slash keyboard navigation now previews selected command text directly in composer and keeps highlighted rows visible.
- Command palette keyboard navigation now auto-scrolls selected rows into view.
- Extension config routing is now dynamic (command-metadata based) instead of hardcoded to `name-ai-config`/`pi-session-auto-rename`, and Desktop now routes config-intent commands like `/auto-rename config` to the owning package modal.
- Auto-rename package recommendation switched to `@byteowlz/pi-auto-rename` (legacy `pi-session-auto-rename` kept as alias for compatibility).
- Added dedicated auto-rename settings editor in Packages modal (mode/model/fallback/prefix/debug + save/test) so users can configure behavior without memorizing command args.
- Added extension-error compatibility hinting in chat for deprecated `ctx.modelRegistry.getApiKey()` usage (actionable guidance toward `getApiKeyAndHeaders`).
- Desktop now ensures a global compatibility extension (`~/.pi/agent/extensions/pi-desktop-sdk-compat.ts`) that shims legacy `modelRegistry.getApiKey()` via `getApiKeyAndHeaders()` for older extensions (including current `@byteowlz/pi-auto-rename` versions), preventing runtime crashes.
- Expanded capability docs (`docs/PACKAGE_CAPABILITY_TEMPLATE.md`, `docs/CAPABILITY_MODEL.md`) with explicit command/default-behavior contracts and SDK compatibility requirements for extension authors.
- Extension `notify` responses now surface in-app while Desktop is foregrounded, so extension command feedback is visible without requiring background notifications.
- Internal extension status keys used for title-sync (e.g. `oqto_title_changed`) are now suppressed from visible status overlays, preventing stray session-title text from appearing above the composer controls.
- User message bubble width/wrapping regression fixed (`he j` squeeze artifact removed).

Remaining:
- Final command-by-command QA matrix pass for lower-frequency built-ins and extension command mappings.
  - Completed in follow-up pass: `/name` (sidebar-inline parity), `/new` (fresh-session sidebar parity), `/import` (native picker fallback when no arg), `/export` (native save picker when no arg), `/reload` (runtime restart + full desktop refresh pass), `/session` (detailed timeline info block parity), `/share` (CLI-aligned secret gist flow via `gh`, `session.html` export, minimal clickable output + compact left-aligned row), `/tree` (query-aware full session-tree viewer from JSONL across branches with terminal-like inline connectors and active-path markers, plus quick fork actions), `/fork` (query-aware user-message selector aligned with CLI fork behavior), `/resume` (query-aware session browser open via `/resume <query>`), `/model` (provider-aware picker hinting when arg is non-exact), `/scoped-models` (native Settings scoped-models editor with search/provider toggles and persisted `enabledModels` saves), `/login` + `/logout` (terminal-only guidance rows, no misleading settings routing), `/changelog` (Pi Coding Agent changelog from CLI package, latest sections by default in collapsed scrollable row, `all/refresh` options).
- Close #70 only after targeted smoke validation across project/no-project and streaming/non-streaming contexts.
- Minor tree/fork UI polish (spacing/readability/keybind-level UX) is intentionally tracked as post-#70 follow-up (`issues/tree-fork-polish-followup.md`).

---

## Notable chat-sweep commits (latest)

- `9824044` feat(chat): compact workflow timeline + markdown/composer hardening
- `3412b61` fix(chat): running workflows expanded behavior stabilization
- `3c7df3c` fix(chat): active dropdown stability + truncation improvements
- `9ce8d56` refactor(chat): restore workflow thinking + minimal running treatment
- `fe5f925` fix(chat): keep pre-tool thinking inside workflow + sync animation state
- `bfabdfa` refine(chat): manual collapse persistence + inline Pi affordance
- `4553916` refine(chat): code-block polish + interleaved timeline behavior
- `f36e29f` fix(chat): avoid empty assistant placeholder row generation
- `211db6f` fix(chat): dedupe repeated streamed thinking in workflow timeline

---

## Remaining follow-up before merge

- Open PR for `feat/chat-interface-issue-sweep` with issue mapping and validation notes.
- Complete #70 slash-action audit/cleanup and update status in issue + changelog.
- Final native smoke pass (streaming, parallel tools, long markdown/code, dark/light visual checks).
