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
- listing installed packages
- install/remove/update flows
- global vs project scope
- recommended packages

It also renders extension-driven UI signals through the extension UI host boundary.

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
