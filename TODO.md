# TODO (Issue Mirror)

## Active issue
- Issue: #14 — [P1] Remove mini-lit dependency (React markdown + local theme tokens)
- Branch: feat/14-remove-mini-lit
- Scope summary: replace mini-lit markdown/theme usage with React-native markdown rendering + local Tailwind token mapping, then remove mini-lit/lit dependency path.

## Acceptance criteria (from issue)
- [x] No `mini-lit` imports in `src`
- [x] No `lit` or `@mariozechner/mini-lit` dependency in `package.json`
- [x] `npm run check`, `npm run build:frontend`, `cargo check`, and tauri startup smoke pass
- [x] Markdown rendering parity is preserved for core chat usage (paragraphs, code fences, inline code, lists, links)

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [x] Changes committed and pushed
- [x] PR opened/updated

## Session notes
- #9 and #10 were completed and merged to `dev`.
- Replaced mini-lit markdown usage in chat with `react-markdown` + `remark-gfm`.
- Replaced mini-lit theme import with local Tailwind token mapping in `src/styles/app.css`.
- Removed `@mariozechner/mini-lit` dependency path; `npm ls lit` now resolves empty.
- Validation run: `npm run check`, `npm run build:frontend`, `cargo check -q`, `npm run tauri dev` startup smoke.
