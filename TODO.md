# TODO (Final UI polish pass)

## Context
- Repo: `C:\Users\gusta\downloads\pi-desktop`
- Base branch: `dev`
- Working branch: `feat/tabbed-terminal-ui-polish`
- Goal: final minimal shell cleanup (top-to-bottom bars, tabs, chat status, sidebar footer)

## Current request checklist
- [x] 1) Move `PI-desktop vX` from top-right to top-left
- [x] 2) Add breathing space below titlebar divider
- [x] 3) Fix new project tab placement + add tab reordering via drag/drop
- [x] 4) Improve general alignment between sidebar/workspace/chat shell
- [x] 5) Move path/session usage data below chat input and reorganize left/right
  - [x] Path + branch on left
  - [x] Branch selectable (switch branch)
  - [x] Usage metrics grouped on right with stronger color separation
- [x] 6) Restore default thinking-level shortcut to `Shift+Tab`
- [x] 7) Remove top chat header title/`0 msgs`; place command trigger more cleanly
- [x] 8) Rename action trigger to `Commands`
- [x] 9) Reorganize sidebar bottom controls with profile-circle dropdown for settings/resources

## Additional implementation notes
- Added new backend/bridge API for git branch operations:
  - `get_project_git_status`
  - `list_project_git_branches`
  - `switch_project_git_branch`
- Sidebar width resize remains persisted (`pi-desktop.sidebar.width.v1`).

## Validation
- [x] `npm run check`
- [x] `npm run build:frontend`
- [x] `cargo check`
- [x] `npm run build` (release `.exe`)
- [ ] Manual UX smoke test by user

## Local runnable artifact
- [x] Built release app binary: `src-tauri/target/release/pi-desktop.exe`
- [x] Copied runnable binary to project root: `pi-desktop.exe`
- [x] Added launcher script: `run-pi-desktop.bat`

## Follow-up tweak (top chrome cohesion)
- [x] Merge tabs into a unified top shell (`#topbar-shell`) with titlebar
- [x] Use one shared top divider under title + tabs to cleanly section sidebar/chat content
