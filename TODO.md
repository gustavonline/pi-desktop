# TODO (Warp-like tabbed workspace UI polish)

## Context
- Repo: `C:\Users\gusta\downloads\pi-desktop`
- Base branch: `dev`
- Working branch: `feat/tabbed-terminal-ui-polish`
- Goal: tabbed project UX with a single minimal sidebar

## Completed
- [x] Tabs as project workspaces (`WorkspaceTabs`) with open/switch/close
- [x] Active tab persisted and reused on restart
- [x] Sidebar sessions/files bound to active project only
- [x] Last tab close => auto open folder dialog
- [x] `Tab` key cycles thinking level when focus is not in input/select/editor

## Latest polish pass
- [x] Simplified duplicate project labeling:
  - [x] Titlebar now shows active **project path**
  - [x] Sidebar panel headers no longer repeat project name
- [x] Reduced visual noise in top shell:
  - [x] Titlebar model label removed
  - [x] Project color dots removed from tabs
- [x] Replaced emoji visuals with minimal monochrome icons/glyphs where prominent

## New sidebar simplification (current request)
- [x] Removed inner left activity rail (no more “sidebar inside sidebar”)
- [x] Added top inline panel switcher in sidebar header (`Sessions` / `Files`)
- [x] Removed redundant static section title text in the header area
- [x] Added draggable sidebar resize handle between sidebar and chat
- [x] Persist sidebar width in localStorage (`pi-desktop.sidebar.width.v1`)

## Validation
- [x] `npm run check`
- [x] `npm run build:frontend`
- [ ] Manual UX smoke test by user

## Notes
- `Ctrl/Cmd+T` remains unchanged (toggle thinking blocks) to avoid conflicts with current pi defaults.
- Session browser remains global for now (can be filtered by active project in a follow-up).
