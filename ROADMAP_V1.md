# Pi Desktop V1 Roadmap

## Vision
Ship a stable desktop client that feels native, minimal, and polished (Apple/Codex-like), while remaining an integration layer on top of `pi --mode rpc` and public CLI commands.

## Current Status (2026-02-17)

- ✅ **M1 Stabilization baseline:** complete
  - RPC lifecycle + compatibility checks in place
  - project/session switching stabilized
  - React-only frontend architecture established
- ✅ **M2 UX polish baseline:** complete
  - codex-like dark polish across sidebar/chat/titlebar/settings
  - project-centric sidebar + metadata-rich session rows
  - improved actionable status/error messaging
- 🔄 **M3 Release candidate:** in progress
  - primary remaining open child issue: **#5** (distribution pipeline + release packaging docs)

## Product principles
1. **CLI contract first**: consume RPC/CLI capabilities, do not fork coding-agent internals.
2. **Reliability before novelty**: avoid regressions in switching, streaming, and command execution.
3. **Minimal UI, high clarity**: fast interactions and low visual noise.
4. **Graceful compatibility**: when CLI/RPC versions differ, show clear fallback guidance.
5. **Community-scale frontend**: keep React-first architecture for contributor friendliness.

## V1 scope (must-have)
- Stable RPC lifecycle (start/stop/restart/reconnect)
- Stable project + session workflows
- Chat core parity (streaming, tool calls, thinking, abort, retry)
- Model + thinking controls in-composer
- Session utilities (rename, fork, history, export)
- Settings runtime panel (auth state, CLI update checks/actions, compatibility checks)
- Command palette + shortcuts
- Basic extension UI protocol handling
- React-only frontend architecture

## Out of scope for V1
- Re-implementing interactive TUI-only flows not exposed by RPC
- Major redesigns beyond polish/tuning
- Deep extension framework expansion beyond current protocol surface

## Milestones

### M1 — Stabilization baseline ✅
- Lock regressions in process handling and project/session switching
- Add startup + on-demand compatibility probes
- Ensure no process/window spawn loops
- Keep React-only app entrypoint/bootstrap (no legacy Lit bridge)

### M2 — UX polish baseline ✅
- Tighten spacing/typography and interaction rhythm
- Improve errors/toasts to be actionable
- Finalize titlebar/sidebar/composer behavior consistency

### M3 — Release candidate 🔄
- Pass release checklist in `RELEASE_CRITERIA.md`
- Complete issue #5 (distribution pipeline + reproducible release packaging docs)
- Run multi-day soak testing in daily usage
- Close all P0 issues and accepted P1s

## Definition of done for V1
- All release-gate checks pass
- No open P0 issues
- Core workflows pass smoke test repeatedly on target machine(s)
- `main` tagged as `v1.0.0` candidate

## Next Steps
1. Finalize issue #5 acceptance criteria (Windows/macOS artifact reproducibility + signing/notarization guidance).
2. Execute full smoke matrix from `RELEASE_CRITERIA.md` after distribution docs land.
3. Promote `dev -> main` only when release gate is fully green.
