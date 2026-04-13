# Pi Desktop Themes: Mapping and Behavior

This document explains how Pi Desktop maps Pi theme files (`~/.pi/agent/themes/*.json`) to desktop UI tokens.

## Default bundled themes

Pi Desktop includes a default first-party theme set (installed on first desktop startup):

- `pi-desktop-notion-dark.json`
- `pi-desktop-catppuccin-dark.json`
- `pi-desktop-github-dark.json`
- `pi-desktop-vscode-plus-dark.json`
- `pi-desktop-notion-light.json`
- `pi-desktop-vscode-plus-light.json`
- `pi-desktop-catppuccin-light.json`
- `pi-desktop-github-light.json`

These files are placed in:

- `~/.pi/agent/themes`

All bundled files are written in full Pi CLI theme schema format (all required `colors` tokens), so they are valid both in Desktop and in `pi` CLI.

## Theme package behavior

In the Packages pane, **Pi Desktop Themes** behaves like a package:

- **Install**: restores bundled default theme files.
- **Uninstall**: removes bundled default theme files.

Only the bundled theme files are touched; user-created themes are not removed.

Automatic bootstrap happens only once on first desktop startup. After explicit uninstall, themes stay uninstalled until you install the package again.

Desktop also repairs legacy bundled theme files that were created with an older, incomplete schema (missing required tokens), so existing installations are cleaned up without manual edits.

## Theme variant detection (Light vs Dark)

The Settings theme dropdowns separate themes into light and dark variants.

Variant detection order:

1. `piDesktop.variant` in theme JSON (`"light" | "dark"`), if present.
2. Background luminance heuristic from resolved background color.
3. Filename fallback (`-light` / `-dark`).

## Desktop token mapping

Pi Desktop projects Pi theme tokens into desktop semantic tokens, focused on:

- Accent
- Background/surfaces
- Foreground/text

Primary theme color sources used from Pi theme files:

- Accent candidates: `accent`, `toolTitle`, `mdHeading`, `mdLink`, `customMessageLabel`
- Background candidates: `selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `mdCodeBlock`
- Foreground candidates: `text`, `userMessageText`, `customMessageText`, `toolOutput`, `syntaxVariable`

Foreground is used mainly for text hierarchy and borders; surface tinting stays background-led to avoid heavy overlay/veil effects.
