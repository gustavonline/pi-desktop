# Contributing to Pi Desktop

Thanks for contributing ❤️

## Before you start

- Read [`README.md`](./README.md)
- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Prefer small, focused PRs

## Development setup

```bash
git clone https://github.com/gustavonline/pi-desktop.git
cd pi-desktop
npm install
npm run tauri dev
```

## Branch strategy

- `main`: release-ready branch only
- `dev`: active integration branch
- feature/fix branches: branch from `dev` (`feat/...`, `fix/...`)
- open PRs into `dev`; merge `dev -> main` when ready to release

Example:

```bash
git checkout dev
git pull
git checkout -b feat/workspace-rename
```

## Validation checklist

Run before opening a PR:

```bash
npm run check
npm run build:frontend
cargo check --manifest-path src-tauri/Cargo.toml
```

## PR expectations

- Explain **what** changed and **why**
- Include screenshots/GIFs for UI changes
- Keep UX consistent with minimalist/low-noise design goals
- Keep app logic host-focused; prefer extension/package-driven behavior for policy/workflow features

## Scope guidelines

### Good for core app
- runtime/session reliability
- shell UX and native integration
- accessibility and keyboard interactions
- package/resource surface quality

### Prefer package/extension space
- project-specific automations
- heavy policy workflows
- opinionated assistant behavior

## Commit style (recommended)

Use concise imperative messages, e.g.:
- `ui: simplify message action hover behavior`
- `release: add cross-platform release workflow`

## Code of Conduct

By participating, you agree to follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
