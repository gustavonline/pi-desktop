# Terminal integration follow-up (implemented baseline)

Status: Implemented baseline on `feat/70-slash-actions-reliability` (2026-04-06)

## What changed

- Terminal no longer opens as its own content tab/pane.
- Terminal now opens as a bottom dock inside the chat pane (VS Code-like layout).
- Terminal dock now uses an xterm-powered terminal surface (instead of a plain text input row).
- Terminal toggle uses the existing top-right terminal button in the content tabs bar.
- Dock behavior:
  - open/close toggles inline in chat
  - does not replace the active chat session
  - keeps chat visible above terminal

## Runtime behavior

- Terminal commands now run in an isolated shell execution path (not through chat-session tool events), so terminal commands no longer appear as chat timeline tool rows.
- Added clearer guarded runtime states inside the terminal surface:
  - no project: terminal guidance is shown and command execution is blocked
- Added terminal keyboard polish (history up/down, Ctrl+C abort, Ctrl+L clear).
- `cd` commands now update terminal working directory state for subsequent terminal commands.
- Composer Alt+Enter queue behavior now uses a minimal queue strip near the composer (instead of speculative queued user bubbles in chat).

## Notes

- Legacy persisted `pane: "terminal"` state is auto-normalized back to `pane: "chat"` with terminal dock open.
- Current implementation is single docked terminal panel (no split panes/multi-terminal tabs yet).
- Slash/command-palette terminal toggle is stable; app-wide keyboard shortcut reliability is tracked separately in issue #84.

## Potential follow-ups

- Adjustable terminal dock height (drag handle).
- Multi-terminal sessions/tabs inside the dock.
- Optional persisted terminal command history per workspace.
