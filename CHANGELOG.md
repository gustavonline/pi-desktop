# Changelog

All notable changes to this project are documented in this file.

The format is inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Chat surface now shows a persistent Pi status indicator during active runs (including tool phases and initial wait), with rotating typewriter-style status text, icon-only calm animation, transparent styling, and automatic bottom-follow while the conversation streams.

### Fixed
- Improved reasoning/thinking rendering compatibility by accepting both `thinking` and `reasoning` payload shapes during streaming updates and backend hydration.

### Changed
- Slowed the working-status animation cadence and phrase rotation so each status line remains visible longer.

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
