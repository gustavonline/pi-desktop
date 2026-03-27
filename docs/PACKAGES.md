# Packages, Extensions, and Resource Philosophy

Pi Desktop is designed for an **extension-first** ecosystem.

## Why packages matter

The desktop app should not hardcode every behavior. Instead:

- host UX lives in Pi Desktop,
- agent behavior can be layered through packages/extensions.

This enables community-driven capability growth without turning the desktop shell into a monolith.

### Capability host model

Pi Desktop should expose capabilities that extensions can consume (UI primitives, native shell affordances, RPC bridge integration). In other words: extensions make the app do more, while app-core stays lightweight and maintainable.

---

## What Pi Desktop surfaces

Pi Desktop includes a Packages pane that supports:
- extension package install/remove/update flows
- skills + extensions surfaced as first-class package capabilities
- curated recommendations (skills + extensions)

It also renders extension-driven UI signals through the extension UI host boundary.

### Skills + extensions in Desktop

In the Packages pane:
- **Installed** lists all installed skills + extensions in one view.
- **Recommended** blends curated skills/extensions (Brave Search, Browser Tools, YouTube Transcript) with top extension picks and search results.
- list rows keep minimal controls (`+` to install, `✓` when installed)
- clicking an item opens a details modal for richer actions:
  - extension settings/config commands
  - install / uninstall
  - open folder / open page
  - skill setup + “try in chat”
- model-picker settings hydrate from extension config JSON when available (e.g. `~/.pi/agent/extensions/<package>.json`)
- **Create skill** stages `/skill:creatorskill` in chat for manual Enter

If runtime discovery fails, Desktop shows explicit error banners and keeps diagnostics available in the Packages pane.
The pane also shows an explicit initial loading state (`Loading packages…`) to avoid confusing partial renders while RPC/package discovery is still in progress.

---

## What should live in packages (preferred)

Examples:
- notification policy (when/why to notify)
- naming automation
- project guardrails and conventions
- workflow-specific custom commands

## What should stay in app core

Examples:
- sidebar/workspaces/tabs
- chat/file/terminal/packages pane shell
- runtime/session switching and reliability
- native integrations (window/fs/dialog)

---

## Authoring package UX

When building packages/extensions for desktop compatibility:
- prefer `ctx.ui.*` APIs over terminal escape sequence tricks
- keep status text concise and desktop-safe
- expose behavior as optional, user-installable modules

For Desktop-side implementation rules (modal settings flow, dynamic command discovery, Save/Apply UX labels), follow [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md).

---

## Recommended package model

The app ships with a curated recommended list (npm/git/url source hints).
This keeps core app small while helping users discover useful add-ons.
