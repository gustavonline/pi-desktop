# Package Capability Template (Desktop)

Use this template whenever we add or adapt package/extension behavior in Pi Desktop.

## Goal

Keep Desktop as a **generic capability host** while allowing packages to add optional behavior.

## Non-goals

- No package-specific business logic in app core.
- No hardcoded package-name switches for UX flows.
- No package config controls in global `Settings` panel.

## Required architecture

1. **Discover capabilities dynamically**
   - Use runtime command discovery (`get_commands`) and installed package metadata.
   - Match commands to installed packages by source/path.

2. **Render package config in Packages view**
   - Show per-package settings entrypoint (gear icon) in Installed list.
   - Open a modal overlay (not inline expansion in crowded list views).

3. **Run package config through runtime**
   - Apply settings by executing the package command via RPC prompt.
   - Let package extension own persistence format and storage location.

4. **Use desktop-native form UX**
   - Show form controls (e.g. model dropdown) instead of command syntax.
   - User-facing actions should be `Save` / `Apply` (not raw slash-command labels).

## UI contract

- Entry point: Installed package row -> gear icon -> modal.
- Modal should include:
  - title with package label
  - discovered setting actions
  - action buttons (`Save` / `Apply`)
  - status/error line
- If no config actions discovered:
  - show informational empty state (package adds runtime capability only).

## Data-flow contract

- Desktop stores only temporary UI state for the modal.
- Durable settings are owned by package command handlers.
- Desktop may offer convenience inputs (e.g. model picker), but final write happens through package command execution.

## Implementation checklist

- [ ] No hardcoded checks for specific package names in UI behavior.
- [ ] No package config controls in global Settings panel.
- [ ] Package settings open in modal from Installed list.
- [ ] User actions are labeled with UX terms (`Save` / `Apply`), not command names.
- [ ] `npm run check` passes.
- [ ] `npm run build:frontend` passes.
- [ ] Manual smoke test for at least one model-config package and one capability-only package.

## PR checklist snippet

Copy into PR description:

```md
### Package capability template compliance
- [ ] Dynamic capability discovery (no package-name hardcoding)
- [ ] Package config lives in Packages modal
- [ ] Runtime command execution is the write path
- [ ] UX labels are Save/Apply (no slash command labels)
- [ ] Verified with model-config package + capability-only package
```
