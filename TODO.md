# TODO (Issue Mirror)

## Active issue
- Issue: #9 — [P0] Migrate core UI surfaces from Lit to React (chat/sidebar/settings/titlebar)
- Branch: feat/9-react-core-surfaces
- Scope summary: Migrate high-change core surfaces to React while preserving parity.

## Acceptance criteria (from issue)
- [ ] Core migrated surfaces are React-based
- [ ] Feature parity with existing behavior is preserved
- [x] `npm run check`, `npm run build:frontend`, `cargo check` pass
- [x] tauri dev startup smoke pass for migrated flows

## Session checklist
- [x] Implementation done (partial: titlebar/sidebar/settings migrated)
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [ ] Changes committed and pushed
- [ ] PR opened/updated

## Session notes
- Migrated `titlebar`, `sidebar`, and `settings-panel` components from Lit rendering to React rendering while preserving class APIs.
- Added `.tsx` React implementations and removed legacy `.ts` Lit versions for those surfaces.
- `chat-view` remains Lit-based and is still pending under this issue scope.
