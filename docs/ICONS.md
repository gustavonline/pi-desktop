# Icon workflow

This document defines how Pi Desktop app icons are maintained and regenerated.

## Source of truth

- Primary source artwork: `assets/branding/pi-desktop-icon.svg`

Current source uses:
- official Pi geometry from `https://pi.dev/logo.svg`
- a subtle pixel `D` badge for desktop branding

Keep this file square and minimal. Prefer high-contrast, low-detail shapes that remain readable at small sizes.

## Regenerate platform icon set

From repo root:

```bash
npx tauri icon assets/branding/pi-desktop-icon.svg -o src-tauri/icons
```

This regenerates:
- macOS (`icon.icns`)
- Windows (`icon.ico`, Appx Square/Store logos)
- Linux/desktop PNG sizes
- iOS / Android icon outputs used by Tauri bundles

## Validation checklist

After regenerating icons:

1. Commit both source and generated outputs:
   - `assets/branding/pi-desktop-icon.svg`
   - `src-tauri/icons/**`
2. Build checks:
   - `npm run check`
   - `npm run build:frontend`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
3. Manual shell/surface checks:
   - macOS: Dock + Finder + app switcher
   - Windows: taskbar + Start Menu
   - Linux: launcher/menu
4. Capture screenshots and attach to issue/PR when icon changes are part of release scope.

## Notes

- Avoid tiny details, soft gradients, or thin strokes that collapse below 32px.
- If icon concept changes significantly, update issue #23 with before/after screenshots and approval notes.
