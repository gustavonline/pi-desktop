# TODO (State Consolidation + Dev Release Pass)

## Context
- Repo: `C:\Users\gusta\downloads\pi-desktop`
- Active branch: `feat/5-distribution-pipeline`
- Related issue: #5 — **[P1] Distribution pipeline for Windows + macOS (post-v1 stabilization)**
- Session goal: consolidate current state, align docs, verify build/check, update issue, and merge verified work into `dev`.

## Task checklist
- [x] 1) Audit current codebase status (done/stable, partial, risks, priorities)
- [x] 2) Update markdown docs to match current reality
- [x] 3) Post concise GitHub issue progress update + next steps
- [x] 4) Run validation (`npm run check`, `npm run tauri build`) and fix real breakages
- [ ] 5) Commit, push, merge into `dev`, push `dev`

## Verification log
- [x] `npm run check` (pass)
- [x] `npm run tauri build` (pass)

## Notes
- Session audit reads: `src/main.tsx`, `src/components/sidebar.tsx`, `src/components/chat-view.tsx`, `src/components/titlebar.tsx`, `src/components/settings-panel.tsx`, `src/rpc/bridge.ts`, `src-tauri/src/lib.rs`.
- Docs aligned: `README.md`, `FEATURE_MAPPING.md`, `RELEASE_CRITERIA.md`, `ROADMAP_V1.md`, `TODO.md`.
- Issue update posted: https://github.com/gustavonline/pi-desktop/issues/5#issuecomment-3914584289
