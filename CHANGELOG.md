# Changelog

All notable changes to this project are documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
