# Pi Desktop Release Criteria (V1)

## Branch model
- `main`: stable, releasable only.
- `dev`: integration branch for validated work.
- `feat/<issue-id>-<slug>`: one issue per branch.

## Issue model
Every work item must have a GitHub issue with:
- clear acceptance criteria
- priority (`priority:p0` / `priority:p1`)
- type (`type:bug` / `type:feature` / `type:roadmap`)
- area (`area:rpc`, `area:ui`, `area:release`, etc.)

`TODO.md` should mirror only the **currently active issue** for the session.

## Frontend migration guardrails
- React is the active frontend entrypoint (`src/main.tsx`).
- During migration, legacy Lit surfaces may remain, but **new UI work should be React-first** unless explicitly scoped as legacy maintenance.
- Migration progress is tracked in issue #7.

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
5. Update `TODO.md` to reflect issue completion state.
6. Commit with message including issue id.
7. Push branch and open PR into `dev`.
8. Merge only after checks + manual smoke pass.

## Dev -> Main promotion gate
Promote `dev` to `main` only when:
- no open P0 issues
- all acceptance criteria for V1 scope are met
- release smoke tests pass end-to-end
- no known crash loops/disconnect regressions

## V1 smoke tests (must pass)
1. App starts once (no process/window spawn loop).
2. Open project A, switch to project B, open sessions in both.
3. Send prompt, verify stream + tool output + abort.
4. Switch model and thinking level.
5. Fork/history/export workflow works.
6. Settings shows auth + CLI runtime info.
7. CLI update check runs; update action behaves as expected for PATH installs.
8. Command palette and key shortcuts operate correctly.

## Release cut checklist
- [ ] `dev` fully green and smoke-tested
- [ ] Merge `dev` -> `main`
- [ ] Tag release candidate (`v1.0.0-rcX`) then stable (`v1.0.0`)
- [ ] Publish release notes with known limitations
