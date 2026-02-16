# TODO (Issue Mirror)

## Active issue
- Issue: #4 — [P1] Polish minimal Apple/Codex-like UI rhythm for v1
- Branch: feat/4-ui-polish-v1
- Scope summary: spacing/typography consistency pass, micro-interaction polish, light-theme tuning, and notice/error visual consistency.

## Acceptance criteria (from issue)
- [x] Visual hierarchy is consistent across core surfaces
- [x] No rough/unintended spacing collisions in main workflows
- [x] Interaction states feel responsive and coherent

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [x] Changes committed and pushed
- [x] PR opened/updated

## Session notes
- React-only frontend baseline is complete (#9/#10/#14).
- Polished spacing/typography rhythm across titlebar/chat/composer/sidebar overlays.
- Reworked sidebar visual system to theme-token-based classes (improves dark/light consistency).
- Improved micro-interactions: hover/active/focus-visible states and button/input/select transitions.
- Unified notice/toast style language between chat notices and extension notifications.
- Added responsive guards for tighter window widths to reduce titlebar/chat toolbar collisions.
- Validation run: `npm run check`, `npm run build:frontend`, `cargo check -q`, and tauri startup smoke (`npm run tauri dev`).
