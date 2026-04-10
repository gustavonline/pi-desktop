# Changelog

All notable changes to this project are documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Reworked the no-project / new-thread welcome view into a cleaner Codex-inspired centered layout with Pi Desktop branding, a project-focused dropdown, and reduced UI chrome.
- Settings navigation now lives in the main left sidebar while Settings is open, and the right pane uses simplified section-first headers with reduced chrome.
- Composer now supports terminal-style full input history traversal (`ArrowUp` / `ArrowDown`) across previously sent prompts and slash commands.
- Slash palette keyboard navigation now previews the active command directly in the composer input and keeps the active row visible while traversing.
- Command palette (`Cmd/Ctrl+K`) keyboard navigation now auto-scrolls the selected row into view for long lists.
- Content tabs are now session-only (no file tab types), with sidebar session opens auto-filling up to two default session tabs and extra session tabs created explicitly via the tabs-bar `+` action (`New tab`). File opens now keep chat visible and render in a right-side split file panel (Warp-style), so session flow remains centered while file context is side-by-side.
- Right-side file split panel is now resizable via drag handle, file header now shows directory path above filename title, and file-close affordance uses lightweight icon-only hover styling.
- File split resize is now bounded to avoid overlap with the floating chat composer, while keeping the divider full-height in the chat surface.
- Simplified content-tab trailing chrome by removing the visual divider next to the terminal button.
- Terminal UX now uses a VS Code-style bottom dock inside chat instead of opening as a standalone terminal tab/pane, with an xterm-powered shell surface and close/clear dock controls.
- Added fast docked-terminal toggles via command palette (`terminal`) and slash command (`/terminal`); keyboard shortcut parity across OS/layouts is being tracked in a dedicated follow-up.
- Composer follow-up queue UX is now minimal and docked near the composer instead of injecting speculative queued bubbles into the chat timeline.
- Welcome project dropdown now lists all projects in the current workspace and supports direct project switching (plus quick actions for add project, packages, and settings).
- Welcome heading copy now rotates between Pi-style idle phrases for a calmer ambient experience.
- Reworked assistant tool-heavy runs into a compact workflow timeline with centered duration summary, grouped repeated tool calls, and progressive disclosure for details.
- Workflow detail timeline now preserves natural interleaving of thinking and tool entries (including mid-run thinking blocks), instead of forcing thinking to the top.
- Running-state affordances now use synchronized Pi/text animation cadence, including inline Pi indicators on active workflow rows and toned-down bottom-status typography.
- Polished markdown code blocks toward a cleaner Codex-like appearance (single surface, tightened header/content spacing, smaller copy affordance, less chrome).
- Composer slash palette now shows CLI-first command groups with runtime-discovered extension/prompt/skill commands, while keeping visual chrome minimal.
- Extracted shared slash-command modules for both catalog metadata and runtime parsing/filtering (`slash-command-catalog` + `slash-command-runtime`), and aligned Command Palette + Composer to reuse the same normalization/filter logic instead of duplicating command handling.
- Moved model/provider display + `pi --list-models` parsing utilities into `src/models/model-options.ts` so model catalog logic is separated from chat view orchestration.
- Extracted provider-auth domain normalization/helpers into `src/auth/provider-auth.ts` (provider key/arg parsing, OAuth catalog normalization, provider-auth status normalization, setup-command resolution) and reduced `chat-view` auth-specific branching logic.
- Moved model selection argument resolution (`/model` provider-hint/candidate parsing) into `src/models/model-selection.ts`, keeping selection parsing as a dedicated model-domain module.
- Extracted model-picker provider grouping/auth-state derivation into `src/models/model-picker-provider-groups.ts`, reducing complex inline provider/model aggregation logic in `chat-view`.
- Extracted model-picker provider auth action/hint view-model logic into `src/models/model-picker-auth-ui.ts` to remove duplicated auth-copy/action-derivation branches from `chat-view` rendering.
- Consolidated model-picker lifecycle interactions in `chat-view` (data preloading, toggle/open/close, active-provider updates) into focused helper methods to reduce inline template event-handler duplication.
- Added shared composer-textarea sync helpers in `chat-view` and reused them across input staging/history/preview/clear flows; also extracted preferred model-picker provider resolution into `src/models/model-selection.ts` and centralized session transient-state reset helpers for project/session switches.
- Split composer UI rendering into dedicated view modules: `src/components/chat-view/composer-controls-view.ts` (model picker + send/thinking controls) and `src/components/chat-view/composer-fragments-view.ts` (queued pills, attachments, skill draft pill), reducing `chat-view` template sprawl and tightening component boundaries.
- Further split composer rendering into `src/components/chat-view/composer-slash-palette-view.ts` and `src/components/chat-view/composer-stats-view.ts`, and extracted keyboard/event orchestration to `src/components/chat-view/composer-input-events.ts` (with thin `chat-view` delegation), reducing inline template logic/coupling and keeping composer behavior modular.
- Extracted session tree parsing + tree-line prefix logic from `chat-view` into `src/components/chat-view/history-tree-utils.ts` (including role/entry mapping + active-path derivation) and removed stale fork timeline expansion internals that were no longer wired into rendering.
- Split history/fork viewer internals into dedicated modules: `history-viewer-view.ts` (overlay rendering/filter UI), `history-viewer-types.ts` (shared row/message contracts), and `history-fork-utils.ts` (fork target mapping + entry-id resolution + naming), while removing the legacy standalone fork-picker overlay path in favor of the unified history viewer flow.
- Extracted no-project welcome dashboard internals into focused modules: `welcome-dashboard-data.ts` (local inventory discovery + CLI update status aggregation) and `welcome-dashboard-view.ts` (centered welcome rendering), reducing `chat-view` responsibilities and improving decomposition around the no-project experience.
- Compaction status rendering was reduced to a minimal workflow-style row with collapsed-by-default details instead of a heavy status card.
- Auto-rename extension recommendation and desktop config bridge now target `@byteowlz/pi-auto-rename`, with dynamic command-to-package resolution for config-intent slash commands (including `/auto-rename config`) instead of hardcoded package-name routing.
- Recommended notifications extension now defaults to `pi-smart-voice-notify`, and Packages auto-migrates legacy `pi-desktop-notify` installs by installing the new package and removing the old one.
- Desktop now installs a lightweight capability-native notify bridge extension (`~/.pi/agent/extensions/pi-desktop-notify-bridge.ts`) and enforces non-Windows `pi-smart-voice-notify` host mode (`enableDesktopNotification: false`) so desktop delivery flows through `ctx.ui.notify`.
- Packages modal now includes a dedicated auto-rename settings editor (enabled/mode/model/fallback/prefix/debug + Save/Test actions) backed by `auto-rename.json`, so extension behavior can be configured directly in Desktop.
- Auto-rename settings now support explicit save target selection (global or project), including choosing among opened sidebar projects for project-scoped config writes.
- Save target controls were moved next to the Save action in auto-rename settings (instead of top-of-form) for a cleaner, less noisy flow.
- Runtime slash descriptions now include clearer extension command guidance (including `/voice-notify` action/arg hints and `/auto-rename` subcommand hints like `config`, `test`, `init`, `regen`), and `/voice-notify` with no args now opens extension settings in Desktop.
- Package settings now include explicit `/voice-notify` argument guidance (status/reload/on/off/test) directly in the settings card so command usage is visible without leaving Desktop.
- Model picker now shows provider-level auth state (including unauthenticated providers), greys out providers that still need setup, and exposes inline per-provider Login/Logout actions directly in the flyout.
- Expanded package capability docs now define explicit command contracts (`/<base>`, `/<base> config`, `/<base> config <args>`), safe default settings behavior, and extension SDK auth compatibility guidance (`getApiKeyAndHeaders` first, legacy fallback optional).
- Provider auth discovery in Desktop now uses a CLI-aligned OAuth provider catalog (built-ins + package-registered OAuth providers), so model picker and account diagnostics stay consistent with `/login` behavior.
- Settings → Account was refocused to a WIP account/product direction with lightweight diagnostics, while provider login/setup remains centered in model picker + Packages flows.
- Packages recommendations now include `pi-cursor-provider` and `pi-kilocode` as first-class recommended provider extensions.
- Packages discover-row `+` action now opens package details first (modal-driven install flow) instead of starting immediate background install.

### Fixed
- Modal/backdrop layers now preserve window corner clipping (rounded dim/blur overlay) so opening dialogs no longer introduces square edge artifacts around the app window.
- Bundled default Pi Desktop themes now emit full Pi CLI-compatible theme schema (all required color tokens) instead of a partial Desktop-only color set.
- Fixed `/scoped-models` settings-open race causing Lit `ChildPart has no parentNode` errors by removing unsupported `innerHTML` mutation paths in `SettingsPanel` render/fallback lifecycle.
- Fixed user message bubble width/wrapping regression that could squeeze short text into broken wrapping (`he j`) by correcting user-shell width constraints and wrap behavior.
- Fixed terminal usability gaps by normalizing legacy `pane: "terminal"` workspace state back to chat+dock, adding clearer disconnected/no-project terminal states, improving keyboard handling/history inside the docked terminal, and preventing terminal commands from leaking into the chat canvas timeline.
- Added bundled-theme auto-repair for legacy invalid `~/.pi/agent/themes/pi-desktop-*.json` files so existing installs stop producing CLI theme validation errors.
- Theme files created from Settings (“Create theme”) now use the full Pi theme schema, so custom exports are valid in both Desktop and CLI.
- Hardened Settings pane mounting/open flow to recover from race conditions and stale container rebinding during workspace/project transitions.
- Settings now degrade to a safe basic shell when runtime-dependent sections fail to render, instead of showing a blank pane.
- No-project Settings flow is now runtime-decoupled, so Appearance settings remain available even before RPC runtime is connected.
- Creating a new workspace now uses a true modal flow with fullscreen interaction blocking + keyboard focus trap, preventing background chat/pane interaction while the create dialog is active.
- Removed centered welcome dropdown jitter by stabilizing open/close layout behavior and avoiding no-project auto-scroll on re-render.
- Prevented active workflow dropdowns from auto-reopening after user-initiated manual collapse during ongoing tool runs.
- Removed transient blank spacing before workflow materialization by avoiding empty assistant placeholder rows during stream startup.
- Fixed repeated streamed thinking duplication by tightening partial-update merge/dedupe behavior in workflow rendering.
- Assistant message-level copy action is now suppressed for messages that are only a single fenced code block (copy remains on the code block itself).
- Fixed slash command execution regressions where `/` input could fall through to plain prompt sends; built-in commands now execute deterministically from the composer.
- Composer slash execution now treats runtime command sources more generically and supports deterministic runtime fallback execution for typed slash commands that may not yet be in the local cached menu, improving CLI-extension command parity.
- Fixed workflow summary counters to report mixed outcomes correctly (complete + failed + running) instead of over-reporting failures.
- Removed blinking assistant-body streaming cursor artifact and removed noisy composer status text beneath model controls.
- Fixed compaction timeline behavior so compaction rows stay anchored at the correct chronological position instead of drifting to the newest row.
- Fixed manual `/compact` timeout failures by using an extended RPC timeout window for compaction requests, and fixed post-compaction session stats ring staleness by treating unknown backend context usage as unknown instead of reusing stale pre-compaction fallback tokens.
- Alt+Enter in composer now surfaces explicit queued-message behavior (`followUp`) with clearer queued labeling in user bubbles.
- Extension notify delivery now stays desktop-native only (no in-app chat toasts), and notifications are emitted only when Desktop is out of focus.
- Background desktop notifications now include workspace/session context suffixes (for example `[Workspace 1] -> [session-name]`) and carry richer per-notification targeting metadata for more deterministic deep-link focus behavior.
- Desktop notification copy/branding was polished (`Pi DESK` title formatting, cleaned body text, context line layout), with richer payload metadata preserved for deterministic click-to-focus routing.
- Suppressed `smart-voice-notify` status-key output from the floating composer-status layer, so `/voice-notify reload` no longer leaves stray text near the composer.
- Notification background detection now re-checks Tauri window focus at dispatch time, and Desktop synthesizes a host-side run-end notify fallback when no extension notify was emitted for that run.
- Desktop notification permission now bootstraps from the next user gesture when permission is still `default`, and native notify dispatch falls back to a minimal payload if richer options fail validation on WebKit/macOS.
- Sidebar/session switching now avoids reusing or pruning running session tabs, preventing active runs from being interrupted when hopping to another session quickly.
- Extension runtime errors now include better source context in chat notices, and Desktop emits an explicit compatibility hint when an extension still uses deprecated `ctx.modelRegistry.getApiKey()`.
- Desktop now ensures a global compatibility extension (`~/.pi/agent/extensions/pi-desktop-sdk-compat.ts`) is installed to shim `modelRegistry.getApiKey()` via `getApiKeyAndHeaders()` for legacy extensions, restoring runtime compatibility for packages such as `@byteowlz/pi-auto-rename`.
- Auto-rename settings now correctly hydrate saved `model`/`fallbackModel` values from object-form config (`{ provider, id }`) and keep those values visible in model dropdowns (including unavailable-but-saved models).
- Suppressed internal extension status-key events (for example `oqto_title_changed`) from rendering as floating composer status text, fixing stray session-title overlays above the attach/model row.
- Git branch picker now includes both local and remote-tracking branches, supports remote-branch checkout as local tracking branches, prevents accidental new-branch creation when a matching remote exists, and adds an inline `Fetch` action for refreshing remotes.
- Fixed Packages-page horizontal overflow during long install/output status updates by constraining x-overflow and wrapping diagnostics/banner text.
- Uninstalling an extension from its package modal now closes the modal immediately to avoid stale-context interaction during background removal.

## [0.1.8] - 2026-03-23

### Changed
- Rebranded the app icon to the new **Pi DESK** mark (Pi monogram + pixel `DESK` wordmark) with a handcrafted SVG source.
- Regenerated all bundle icon artifacts from the new source across macOS, Windows, Linux, iOS, and Android targets (`src-tauri/icons/**`).
- Updated branding references in README and icon workflow documentation (`docs/ICONS.md`).

## [0.1.7] - 2026-03-22

### Added
- Moved the workspace switcher from top chrome to the sidebar near global controls/settings (Zen/Arc-style IA direction).
- Expanded sidebar-first workspace management, including rename support and reorder flows in the redesigned workspace surface.
- Added two-finger workspace swipe navigation in empty sidebar areas.
- Packages now expose a per-installed-package **settings gear** with a modal configuration overlay.
- Package settings actions use UX-native **Save/Apply** controls while still executing through runtime command flow.
- Added `docs/PACKAGE_CAPABILITY_TEMPLATE.md` playbook for extension/package UX implementation and added the same checklist to `.github/pull_request_template.md`.
- Added `docs/ISSUE_IMPLEMENTATION_LOG_2026-03-22.md` for consolidated release-cycle implementation tracking.
- Added icon workflow documentation at `docs/ICONS.md` (source of truth + regeneration + validation checklist).
- Session context menu now includes **Mark unread** to re-flag a previously read session tab.

### Fixed
- Hardened workspace swipe gestures (direction, overshoot, stale-load cancellation, and gesture-lock consistency).
- Improved rapid workspace/session switching stability by decoupling hydration and guarding stale switch work.
- Provider/runtime callback errors now surface inline in the chat timeline (CLI parity), including assistant `stopReason: "error"` + `errorMessage` mapping and stderr/stdout fallback parsing.
- Expanded Windows missing-CLI discovery/onboarding handling for common npm/node/nvm/scoop install locations and spawn error patterns.
- Session/workspace switching flow now includes preload/cache + stale-load guards to reduce wrong-content flashes during rapid switching.

### Changed
- Package-specific config was removed from global Settings and moved into the Packages capability surface.
- Package configuration UX is command/capability-driven and package-agnostic, with no package-name hardcoding in desktop core.
- Native traffic-light controls now reveal `× / − / +` glyphs on hover/focus with a calmer default state.
- Icon source switched to official Pi geometry from `https://pi.dev/logo.svg`; final icon is black/white-only with a larger uniform pixel-`D` desktop badge.
- Regenerated all platform icon assets in `src-tauri/icons/**`.

### Notes
- Windows follow-up issue #44 remains open for real Windows first-run onboarding smoke validation.
- macOS unsigned workaround (if needed): `xattr -cr /Applications/Pi\ Desktop.app`

## [0.1.6] - 2026-03-20

### Added
- Chat now shows a “Latest” jump button when auto-follow is unlocked, so you can scroll up during streaming and relock to the live tail on demand.
- Settings now include an auto-rename model picker that writes `~/.pi/agent/extensions/pi-session-auto-rename.json` from currently available authenticated models.
- Sidebar session context menu now includes **Fork from message…** which opens message history for the selected session.
- Fork history now provides a direct **Fork** action on timeline entries (assistant entries fork from their preceding user prompt).

### Fixed
- Improved reasoning/thinking rendering compatibility by accepting both `thinking` and `reasoning` payload shapes during streaming updates and backend hydration.
- Thinking dropdown text no longer starts with template-introduced leading whitespace.
- Tool cards now hydrate outputs reliably from both tool execution events and streamed `toolResult` messages, with fallback matching for provider-specific tool call ids.
- Extension notify handling now suppresses foreground notifications and throttles duplicate/burst notifications to reduce Control Center spam.
- Extension method normalization now accepts `set_title`, `set_status`, and `set_widget`, and `setTitle` now attempts to persist session rename via RPC.

### Changed
- Slowed the working-status animation cadence, phrase rotation, and typewriter speed so each status line stays visible longer.
- Working indicator now appears only before assistant text starts, and its Pi glyph style/animation matches the sidebar running Pi indicator.
- Refined chat affordances: the “Latest” button is now a centered icon-only circle, and thinking previews use a calmer italic click-to-toggle presentation without a background panel plus a per-letter sweep animation while reasoning streams.
- Thinking toggle interactions now preserve reading context better by storing/restoring scroll position and unlocking auto-follow on manual expand/collapse.
- Fork browsing now opens in a tighter focused history mode that shows user + assistant context with a timeline-style list and minimal fork-only actions.
- Fork timeline now keeps tool/thinking subentries scoped to assistant rows, collapses long tool lists behind an inline expand control, and lets you expand long message previews before choosing where to fork.
- Fork actions now only appear on user entries and assistant entries with actual assistant text (tool-only assistant activity rows are no longer forkable).
- Forked sessions are now auto-renamed to `fork-<source-session-name>` so they no longer appear as ambiguous duplicates in the sidebar list.

## [0.1.5] - 2026-03-19

### Fixed
- Hardened RPC bridge listener initialization to avoid duplicate event subscriptions under concurrent setup.
- Prevented duplicate tool-call cards by de-duplicating `toolCall` ids in both streaming updates and backend message hydration.

### Changed
- Composer now shows RPC/binding status inline and blocks send/actions while a session is still loading or reconnecting.
- Release template/checklists now include the unsigned macOS Gatekeeper workaround command (`xattr -cr /Applications/Pi\ Desktop.app`).

## [0.1.4] - 2026-03-19

### Added
- In-app desktop update flow: checks latest GitHub release, surfaces update availability in sidebar/settings, and opens a matching installer download from Settings.

### Changed
- Release documentation now includes in-app desktop update behavior and release-page fallback logic.

## [0.1.3] - 2026-03-19

### Fixed
- Restored native window dragging across custom top chrome by enabling drag regions on non-interactive top-bar surfaces while keeping controls and tabs clickable.
- Prevented duplicate streaming token rendering and stale `steer` mode after run completion.

### Added
- Explicit capability-host contract handling for extension UI requests, including normalized request validation and explicit unsupported-method responses.

### Changed
- Release smoke criteria now includes a regression check for duplicate streaming deltas and stuck streaming/steer state.

## [0.1.2] - 2026-03-18

### Added
- Open-source project docs (`CONTRIBUTING`, `SECURITY`, architecture/package/release docs).
- GitHub Actions CI workflow.
- Cross-platform GitHub release workflow (macOS + Windows + Linux).
- Issue and PR templates.

### Changed
- UI polish toward neutral/minimal design language.
- Stats ring percent now defaults to `0%` in fresh sessions.
- README expanded with architecture and release guidance.
- Release pipeline now includes explicit Tauri icon set and bundle icon config for cross-platform packaging.

## [0.1.0] - 2026-03-18

Initial public open-source release.
