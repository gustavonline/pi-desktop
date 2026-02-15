# Pi Desktop V1 Roadmap

## Vision
Ship a stable desktop client that feels native, minimal, and polished (Apple/Codex-like UX), while remaining an integration layer on top of `pi --mode rpc` and public CLI commands.

## Product principles
1. **CLI contract first**: consume RPC/CLI capabilities, do not fork coding-agent internals.
2. **Reliability before novelty**: no regressions in project/session switching, streaming, and command execution.
3. **Minimal UI, high clarity**: fast interactions, clean hierarchy, low visual noise.
4. **Graceful compatibility**: when CLI/RPC features differ by version, show clear fallback messaging.
5. **Community-scale frontend**: converge to a React-first UI architecture to improve contributor onboarding and ecosystem leverage.

## V1 scope (must-have)
- Stable RPC lifecycle (start/stop/restart/reconnect)
- Stable project + session workflows (switch project/session without disconnect races)
- Chat core parity (streaming, tool calls, thinking, abort, retry)
- Model + thinking controls in-composer
- Session utilities (rename, fork, history, export)
- Settings runtime panel (auth state, CLI update checks/actions, compatibility checks)
- Command palette + shortcuts
- Basic extension UI protocol handling
- React-first frontend foundation established (legacy Lit bridge allowed during transition)

## Out of scope for V1
- Re-implementing interactive TUI-only flows that are not exposed by RPC
- Major redesigns beyond polish/tuning
- Deep extension framework expansion beyond current protocol support

## Milestones

### M1 — Stabilization baseline
- Lock major regressions in process handling and project/session switching
- Add startup and on-demand compatibility probes
- Ensure no process/window spawn loops
- Establish React-first app entrypoint and migration-safe hosting for existing UI surfaces

### M2 — UX polish baseline
- Tighten spacing/typography and interaction rhythm
- Improve error toasts/messages to be actionable
- Finalize titlebar/sidebar/composer behavior consistency

### M3 — Release candidate
- Pass release checklist in `RELEASE_CRITERIA.md`
- Run multi-day soak testing in daily usage
- Close all P0 issues and accepted P1s

## Definition of done for V1
- All release-gate checks pass
- No open P0 issues
- Core workflows pass smoke test repeatedly on target machine
- `main` branch tagged as `v1.0.0` candidate
