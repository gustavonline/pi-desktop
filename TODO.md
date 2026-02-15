# TODO (Issue Mirror)

## Active issue
- Issue: #9 — [P0] Migrate core UI surfaces from Lit to React (chat/sidebar/settings/titlebar)
- Branch: feat/9-react-chat-view
- Scope summary: Complete the remaining chat-view migration to React after merged titlebar/sidebar/settings migration.

## Acceptance criteria (from issue)
- [ ] Core migrated surfaces are React-based
- [ ] Feature parity with existing behavior is preserved
- [ ] `npm run check`, `npm run build:frontend`, `cargo check` pass
- [ ] tauri dev smoke tests pass for chat/session/settings/titlebar workflows

## Session checklist
- [ ] Implementation done
- [ ] `npm run check` passed
- [ ] `npm run build:frontend` passed
- [ ] `cargo check` passed
- [ ] Manual smoke checks done for changed flow
- [ ] Changes committed and pushed
- [ ] PR opened/updated

## Session notes
- Previous slice merged in PR #11: titlebar/sidebar/settings are now React-rendered.
- Remaining blocker: migrate `chat-view` from Lit templates to React rendering with full feature parity.
