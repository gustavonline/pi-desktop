# Follow-up: tree/fork UI polish after #70

Status: Deferred intentionally (not a #70 blocker)
Created: 2026-04-06

## Context
`/tree` and `/fork` are now behaviorally separated:
- `/tree` = full session tree overview across branches
- `/fork` = user-message selector (CLI-style)

Parity behavior is in place, but we still want focused visual/interaction polish.

## Polish scope

### `/tree`
- Improve deep-tree readability without introducing horizontal scroll.
- Reduce visual density in long sessions (row rhythm/contrast).
- Tune connector/path marker clarity in dark/light themes.
- Optional: add keyboard navigation affordances closer to CLI tree selector semantics.

### `/fork`
- Keep user-only list compact and scannable in long sessions.
- Improve selected/hover state hierarchy for fast message picking.
- Optional: richer message snippet formatting (without timeline/tool noise).

## Non-goals
- Do not re-merge `/fork` into full history timeline UI.
- Do not add desktop-only behavior that diverges from CLI fork semantics.

## Acceptance criteria
- `/tree` remains readable in very deep sessions and never exposes blank horizontal scroll area.
- `/fork` shows only user messages and supports quick fork selection with minimal noise.
- No regressions in slash reliability or fork/tree command determinism.
