# Pi Desktop Release Criteria (V1)

## Branch model
- `main`: stable, releasable only.
- `dev`: integration branch for validated work.
- `feat/<issue-id>-<slug>`: one issue/focus area per branch.

## Current Gate Status (2026-02-17)
- ✅ `npm run check` passes
- ✅ `npm run tauri build` passes
- ✅ Core v1 product/stability issues already merged into `dev` (#2/#3/#4/#7/#9/#10/#14)
- ⚠️ Remaining open v1 child issue: **#5** (distribution pipeline for Windows/macOS + signing/notarization docs)
- ❌ `dev -> main` promotion gate is **not** open yet

## Issue model
Every work item should have a GitHub issue with:
- clear acceptance criteria
- priority (`priority:p0` / `priority:p1`)
- type (`type:bug` / `type:feature` / `type:roadmap`)
- area (`area:rpc`, `area:ui`, `area:release`, etc.)

`TODO.md` should track the active session’s scope, verification commands, and completion state.

## Frontend architecture guardrails
- React is the active frontend entrypoint (`src/main.tsx`) and bootstrap (`src/bootstrap.ts`).
- New UI work should remain React-based; do not reintroduce Lit/mini-lit surfaces.
- For markdown/theming changes, preserve chat rendering parity and run standard checks.

## Per-issue workflow (required)
1. Pick/open issue on GitHub.
2. Create branch from `dev`:
   - `git checkout dev && git pull`
   - `git checkout -b feat/<issue-id>-<slug>`
3. Implement only issue scope.
4. Validate locally:
   - `npm run check`
   - `npm run build:frontend`
   - `cargo check`
   - smoke test affected UX flow in `npm run tauri dev`
5. Update `TODO.md` and relevant docs.
6. Commit with message including issue id/context.
7. Push branch and open/update PR into `dev`.
8. Merge only after checks + manual smoke pass.

## Dev -> Main promotion gate
Promote `dev` to `main` only when:
- no open P0 issues
- all accepted V1 acceptance criteria are met
- release smoke tests pass end-to-end
- no known crash loops/disconnect regressions

## V1 smoke tests (must pass)
1. App starts once (no process/window spawn loop).
2. Open project A, switch to project B, open sessions in both.
3. Send prompt, verify stream + tool output + abort.
4. Switch model and thinking level.
5. Fork/history/export workflow works.
6. Settings shows auth + CLI runtime info.
7. CLI update check runs; update action behaves correctly for PATH installs.
8. Command palette and key shortcuts operate correctly.

## Release cut checklist
- [ ] `dev` fully green and smoke-tested
- [ ] Issue #5 distribution pipeline acceptance criteria complete
- [ ] Merge `dev` -> `main`
- [ ] Tag release candidate (`v1.0.0-rcX`) then stable (`v1.0.0`)
- [ ] Publish release notes with known limitations
