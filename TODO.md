# TODO (Issue Mirror)

## Active issue
- Issue: #7 — [RFC] Evaluate migration from Lit to React for frontend ecosystem leverage
- Branch: feat/7-react-foundation
- Scope summary: Prioritized execution of React-first frontend foundation before deeper feature work.

## Acceptance criteria (from issue)
- [x] Frontend boots through React entrypoint
- [x] Existing functionality still works in tauri dev smoke flow
- [x] Docs clearly describe transition status and next migration steps
- [x] Follow-up migration tasks tracked in issues/PRs

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [x] Manual smoke checks done for changed flow
- [ ] Changes committed and pushed
- [ ] PR opened/updated

## Session notes
- Added React + ReactDOM + Vite React plugin and switched entrypoint to `src/main.tsx`.
- Moved previous Lit bootstrap to `src/legacy-bootstrap.ts` and mounted it from React host.
- Updated roadmap/release/docs to reflect React-first transition and migration guardrails.
