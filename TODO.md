# TODO (Issue Mirror)

## Active issue
- Issue: #10 — [P1] Remove legacy Lit bridge and finalize React-only frontend
- Branch: feat/10-react-only-frontend
- Scope summary: Remove `src/legacy-bootstrap.ts`, remove `lit` dependency, update architecture docs to React-only, and run regression validation.

## Acceptance criteria (from issue)
- [x] Legacy Lit bootstrap is removed
- [x] Lit dependency is removed
- [x] Frontend architecture docs updated
- [x] Validation and smoke checks pass

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [x] Changes committed and pushed
- [x] PR opened/updated

## Session notes
- Issue #9 closed after PR #12 merged into `dev`.
- Removed `src/legacy-bootstrap.ts` and introduced `src/bootstrap.ts` (React-hosted desktop bootstrap with no Lit renderer).
- Migrated remaining Lit-based overlays/components to React render roots: command palette, session browser, extensions panel, shortcuts panel, extension UI handler.
- Removed unused Lit-only components (`login-panel.ts`, `model-selector.ts`).
- Removed direct `lit` dependency from `package.json`.
- Updated architecture docs (`README.md`, `FEATURE_MAPPING.md`) for React-only bootstrap state.
- Validation run: `npm run check`, `npm run build:frontend`, `cargo check -q`, and `npm run tauri dev` startup smoke.
