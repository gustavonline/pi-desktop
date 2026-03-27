# Issue implementation log (2026-03-22)

This note summarizes issue work completed in this development cycle, including shipped behavior, commit references, and remaining follow-ups.

## #20 — Performance: session switching preload/cache

Status: **Closed**

Implemented:
- Session-switch preload/cache strategy for better hot-switch latency.
- Reduced loading flashes/noise during fast navigation.
- Stale-load/race guards to avoid wrong-content rendering during rapid switching.
- Re-aligned model/session behavior with CLI semantics after regressions found during optimization.

Relevant commits in this cycle:
- `914e7fe`, `a8326ef` and surrounding sidebar/session switch hardening commits

## #42 — Provider/runtime callback errors missing in desktop UI

Status: **Closed**

Implemented:
- Inline timeline rendering for runtime/provider errors (not only notices/toasts).
- Assistant `stopReason: "error"` + `errorMessage` mapping into chat timeline.
- RPC stderr/stdout non-JSON text fallback normalization into structured UI errors.
- Retry/compaction lifecycle visibility improvements.

Relevant commits:
- `b7a82b7`, `dbe35c9`, `85dbd84`, `a9d4cf4`, `d2d9b3b`
- merged via `0fb46d9`

## #44 — Windows missing CLI onboarding/path parity

Status: **Open (implementation merged, awaiting real Windows smoke validation)**

Implemented:
- Expanded Windows CLI discovery in Tauri backend.
- Expanded missing-CLI error normalization in frontend runtime/onboarding handling.

Relevant commits:
- `1c618a7`
- merged via `bae0de1`

Remaining:
- Validate full first-run + retry onboarding flow on an actual Windows machine.

## #40 — Pi rename package settings/capability integration

Status: **Closed**

Implemented:
- Removed package-specific config from global Settings.
- Added package settings entrypoint in Installed Packages (gear icon).
- Package settings now open in modal overlay (reduced Packages-page clutter).
- Config actions are command/capability-driven and package-agnostic.
- User-facing actions now use Save/Apply UX labels (not slash-command labels).
- Added model-picker form flow for model-config commands while preserving runtime as write path.

Relevant commits:
- `d56cbf5`
- merged via `896e9e1`

## #43 — Mark unread from session context menu

Status: **Closed**

Implemented:
- Added context menu action to mark a session unread again.
- Final copy updated to exact label: **"Mark unread"**.
- Action updates tab attention state and sync/persist behavior.

Relevant commits:
- `e46ae41`, `9dd9935`
- merged via `896e9e1`

## #41 — Capability implementation template/playbook

Status: **Closed**

Implemented:
- Added `docs/PACKAGE_CAPABILITY_TEMPLATE.md` as implementation playbook.
- Linked the template from architecture/capability/packages docs.
- Added checklist section to PR template to enforce consistency.

Relevant commits:
- `d56cbf5`
- merged via `896e9e1`

## #19 — Titlebar traffic-light native glyph affordance

Status: **Closed**

Implemented:
- Added `× / − / +` glyph affordances for traffic-light controls.
- Glyphs are hidden by default and shown only on hover/focus.
- Applied to both workspace top chrome controls and sidebar window controls.
- Existing click behavior remains unchanged.

Relevant commits:
- `d5e9db3`

## #23 — Desktop app icon finalization

Status: **Closed**

Implemented:
- Added source artwork at `assets/branding/pi-desktop-icon.svg`.
- Switched icon to official Pi geometry from `https://pi.dev/logo.svg`.
- Refined icon to black/white only with larger uniform pixel `D` desktop badge.
- Regenerated Tauri platform icon outputs under `src-tauri/icons/**`.
- Added icon workflow/playbook doc at `docs/ICONS.md`.
- Added release-checklist reference to icon workflow in `RELEASE_CRITERIA.md`.

Relevant commits:
- `9a3b994`, `4663f74`, `2bca6ae`

## #25 — Resources/prompts/skills UX + default creatorskill policy

Status: **Closed**

Implemented:
- Removed forced package/setup nudges and “recommended auto-install” behavior.
- Kept only `creatorskill` as first-run default resource.
- Bundled `creatorskill` in app assets and install/copy flow on first native run.
- Reworked Packages pane IA and visuals toward minimal list layout (skills + extensions in unified installed view).
- Improved skill/extension details modal UX, including cleaner content rendering and lower visual noise.
- Added explicit initial loading state (`Loading packages…`) to reduce flicker/jump during async RPC/package discovery.

Notes:
- Creatorskill remains uninstallable by users.
- No additional default package auto-install was introduced.

## #40 — Package settings/config UX follow-up (model picker persistence)

Status: **Closed**

Implemented follow-up:
- Fixed extension config hydration from disk for model-picker commands.
- Added robust JSON discovery for extension/package config files (including canonical `~/.pi/agent/extensions/<package>.json`).
- Added provider/id-to-`provider/model` normalization for extension configs such as `pi-session-auto-rename`.
- Fixed select binding edge cases where UI could still show “Use package default” despite loaded config.
- Preserved runtime command execution while persisting config updates back to disk.

Notes:
- Extension-specific config formats vary; generalized support will continue incrementally as more packages land.

## Next queued issues

After this cycle, planned follow-up targets:
- #37 — tree-style session navigation + sidebar fork lineage
- #32 — desktop self-updater step 2 (download/install/relaunch)
