# Issue implementation log (2026-03-31)

This log summarizes the current `feat/66-theme-schema-cli-compat` cycle covering theme schema compatibility, Settings stability, and no-project welcome/dashboard UX.

## #66 — Theme schema / CLI compatibility

Status: **Implemented on feature branch (pending PR merge to `dev`)**

Implemented:
- Bundled Pi Desktop themes now emit full Pi CLI schema-compatible theme documents.
- Added default-theme install/repair path for legacy `~/.pi/agent/themes/pi-desktop-*.json` files.
- Added schema compatibility validation + rewrite behavior for invalid bundled theme files.
- Settings “Create theme” export now writes full schema-compatible theme JSON.

Primary commits:
- `b40572c`

## #69 — Settings pane blank/failed render hardening

Status: **Implemented on feature branch (pending PR merge to `dev`)**

Implemented:
- Rebind/reuse Settings panel container safely after shell re-renders.
- Added pane-open recovery guards and anti-race handling for pane transitions.
- Hardened open/mount flow for no-project, project-switch, and post-reset states.
- Added fail-safe fallback shell so settings no longer collapse to a blank pane when advanced runtime sections fail.
- Decoupled no-project settings from runtime-dependent sections (Appearance remains available without active RPC runtime).

Primary commits:
- `26295e0`
- `87c3ab3`
- `c50d551`
- `b43a2d1`
- `524218a`
- `53005aa`
- `45c985c`
- `1b4d30e`

## #63 — Codex-inspired frontend parity (welcome/dashboard scope in this cycle)

Status: **Partially implemented (welcome/dashboard slice complete for this branch)**

Implemented in this cycle:
- Reworked no-project / new-thread welcome into a centered Codex-inspired layout.
- Switched to official Pi Desktop icon in welcome lockup.
- Added project-focused dropdown interaction with cleaner scale and reduced visual noise.
- Added workspace-project listing and direct project switching from the centered welcome dropdown.
- Stabilized dropdown open behavior (removed layout jitter/hop) and refined responsive sizing.
- Added rotating Pi-style idle headline copy.

Primary commits:
- `20d06a3`
- `ae46e36`
- `5b7185b`
- `ad02f84`
- `1baf104`
- `d3d02ad`
- `4b475f3`
- `663a841`
- `97db931`
- `e44166c`
- `7b3da5f`
- `25872e3`
- `dba891d`

## Remaining follow-up suggestions

- Add search field inside welcome project dropdown to match Codex-style project picker more closely.
- Continue #63 parity phases (chat canvas rhythm, markdown/code polish, packages/skills layout consistency).
- Run final native smoke pass before release cut.
