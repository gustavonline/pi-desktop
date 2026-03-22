# Capability Model

Pi Desktop is a **capability host** for the Pi ecosystem.

## Mental model

- **Desktop app**: exposes host capabilities (UI primitives, native shell integration, runtime bridge)
- **Extensions/packages**: consume those capabilities to implement optional workflows and behavior
- **Pi runtime (`pi --mode rpc`)**: orchestrates execution and extension loading

This keeps app-core lightweight while allowing ecosystem-driven growth.

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

## Unsupported capability behavior

If an extension emits an unsupported `extension_ui_request` method, Pi Desktop:

1. logs a trace/debug entry,
2. sends an explicit error response (`extension_ui_response`) instead of failing silently.

This avoids hidden hangs and makes compatibility gaps easier to diagnose.

## Development guardrails

When adding features:

- Prefer adding functionality through **capabilities + extensions** first.
- Keep app-core focused on:
  - UI polish
  - performance
  - reliability
  - native host quality
- Avoid embedding extension-specific business logic directly in app core.
- For package settings UX in Desktop, follow [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md).
