# TODO (Issue Mirror)

## Active issue
- Issue: #9 — [P0] Migrate core UI surfaces from Lit to React (chat/sidebar/settings/titlebar)
- Branch: feat/9-react-chat-view
- Scope summary: Complete the remaining chat-view migration to React after merged titlebar/sidebar/settings migration.

## Acceptance criteria (from issue)
- [x] Core migrated surfaces are React-based
- [x] Feature parity with existing behavior is preserved
- [x] `npm run check`, `npm run build:frontend`, `cargo check` pass
- [x] tauri dev smoke tests pass for chat/session/settings/titlebar workflows

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [ ] Changes committed and pushed
- [ ] PR opened/updated

## Session notes
- Previous slice merged in PR #11: titlebar/sidebar/settings are now React-rendered.
- `chat-view` migrated from Lit templates to React rendering in `src/components/chat-view.tsx` with parity for toolbar, message actions, tool calls, composer/image attachments, fork picker, history viewer, notices, and streaming state UX.
- Validation run: `npm run check`, `npm run build:frontend`, `cargo check -q`, and `npm run tauri dev` startup smoke (after clearing stale port 1420 process).
