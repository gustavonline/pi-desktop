# Capability Model

Pi Desktop is a **capability host** for the Pi ecosystem.

## Mental model

- **Desktop app**: host capabilities (native shell/window UX, extension UI bridge, runtime bridge)
- **Extensions/packages**: implement optional workflows on top of host capabilities
- **Pi runtime (`pi --mode rpc`)**: executes commands, loads extensions/resources, and emits capability events

This keeps app-core lightweight while enabling ecosystem-driven behavior.

---

## Extension UI capability contract

Current supported `extension_ui_request.method` values:

- `select`
- `confirm`
- `input`
- `editor`
- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

Source of truth in code:
- `src/components/extension-ui-handler.ts`
  - `SUPPORTED_EXTENSION_UI_METHODS`
  - `normalizeExtensionUiRequest(...)`

---

## Command interoperability contract

Desktop command UX is runtime-driven, not hardcoded per package:

1. Runtime command discovery (`get_commands`) provides command metadata.
2. Desktop slash palette combines:
   - built-ins,
   - runtime extension/prompt/skill commands.
3. Extension config-intent routing is dynamic and recognizes:
   - command names ending with `config`,
   - commands invoked with `config ...` args (example: `/auto-rename config`).

Package/extension command behavior should follow the template in:
- [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md)

---

## Settings/default behavior contract (for package compatibility)

For Desktop-safe package behavior:

- package config must define explicit safe defaults,
- lifecycle handlers must no-op when disabled,
- missing config files must not crash runtime hooks,
- read/status commands must work before manual setup.

Desktop should only store transient UI state; durable settings remain package-owned.

---

## SDK compatibility contract

Extensions must use current Pi SDK/runtime APIs.

Important example:
- Prefer `ctx.modelRegistry.getApiKeyAndHeaders(model)`
- Do **not** rely solely on legacy `ctx.modelRegistry.getApiKey(model)`

When supporting mixed runtime versions, use a compatibility helper that tries `getApiKeyAndHeaders` first and falls back to legacy methods.

---

## Unsupported capability behavior

If an extension emits an unsupported `extension_ui_request` method, Pi Desktop:

1. logs a trace/debug entry,
2. sends an explicit error response (`extension_ui_response`) instead of failing silently.

This avoids hidden hangs and makes compatibility gaps easier to diagnose.

---

## Development guardrails

When adding features:

- Prefer capability-driven solutions over package-specific desktop logic.
- Keep app-core focused on:
  - UI polish
  - performance
  - reliability
  - native host quality
- Avoid embedding extension-specific business logic directly in app core.
- For package settings UX in Desktop, follow [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md).
