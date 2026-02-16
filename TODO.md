# TODO (Issue Mirror)

## Active issue
- Issue: #5 — [P1] Distribution pipeline for Windows + macOS (post-v1 stabilization)
- Branch: feat/5-distribution-pipeline
- Scope summary: document and validate reproducible release artifact flow for Windows/macOS, including signing/notarization guidance and release checklist linkage.

## Acceptance criteria (from issue)
- [ ] Windows release artifacts are reproducibly built and verified
- [ ] macOS `.dmg`/`.app` artifacts are reproducibly built and verified
- [ ] Signing/notarization requirements are documented with actionable steps
- [ ] Release checklist exists and is linked from README/release docs

## Session checklist
- [ ] Implementation done
- [ ] `npm run check` passed
- [ ] `npm run build:frontend` passed
- [ ] `cargo check` passed
- [ ] Manual smoke checks done for changed flow
- [ ] Changes committed and pushed
- [ ] PR opened/updated

## Session notes
- Core v1 product/stability work is complete on `dev` (#2/#3/#7/#9/#10/#14/#4).
- Remaining open v1 child issue is #5 (distribution pipeline/release packaging documentation).
