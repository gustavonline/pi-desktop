# Package Capability Template (Desktop)

Use this template when adding or adapting package/extension behavior for Pi Desktop.

## Goal

Keep Desktop a **generic capability host** while making package commands/settings predictable and Desktop-compatible by default.

## Non-goals

- No package-specific business logic in app core.
- No hardcoded package-name switches for command routing.
- No package config controls embedded in global `Settings`.

---

## 1) Required architecture

### 1.1 Discover capabilities dynamically

- Discover commands via runtime (`get_commands`) and installed package metadata.
- Map command -> package by source/path metadata, not by package-name constants.
- Treat `extension`, `prompt`, and `skill` command sources as first-class.

### 1.2 Run package config through runtime

- Desktop owns only temporary form/input state.
- Package owns persistence format and storage location.
- Apply settings by executing package commands through runtime.

### 1.3 Keep Desktop UX native

- Package config entrypoint is the Installed package row (gear icon) -> modal.
- User actions are UX labels (`Save`, `Apply`, `Test`) rather than raw slash syntax.

---

## 2) Command behavior contract (required)

For package command `/<base>`:

1. `/<base>` (no args)
   - Must be safe/read-only (status/help/current config summary).
   - Must not perform destructive or expensive side effects.

2. `/<base> config`
   - Must be valid and deterministic.
   - Should return config/help output and/or open package config UI intent.
   - Should not silently fail when config file is missing.

3. `/<base> config <args>`
   - Applies configuration.
   - Returns clear success/error feedback via output and/or `ctx.ui.notify`.

4. Optional alias: `/<base>-config`
   - If exposed, behavior should mirror `/<base> config`.

Desktop config-intent routing currently recognizes both:
- command names ending with `config`
- commands invoked with args beginning with `config` (e.g. `/auto-rename config`)

---

## 3) Settings/default behavior contract (required)

### 3.1 Config resolution

Packages should document:
- config file name,
- lookup precedence (project -> user/global),
- write target for `config/apply` commands.

### 3.2 Safe defaults

Required defaults for Desktop compatibility:
- Explicit `enabled` toggle in config schema.
- Event hooks (`before_agent_start`, `agent_end`, etc.) must short-circuit when `enabled: false`.
- Missing config file must fall back to internal defaults (no throw/crash).
- `config`/`status` commands must work before any manual setup.

### 3.3 Idempotent writes

- Reapplying same settings should be harmless.
- Validation errors must produce actionable messages (what field failed, expected format).

---

## 4) SDK/API compatibility contract (required)

Avoid deprecated runtime APIs. For model auth in extensions, use modern `ModelRegistry` APIs.

### 4.1 Current auth API

Use `ctx.modelRegistry.getApiKeyAndHeaders(model)` (not `getApiKey`).

### 4.2 Backward/forward-compatible helper

```ts
async function resolveModelApiKey(ctx: ExtensionContext, model: Model<Api>): Promise<string | undefined> {
  const registry = ctx.modelRegistry as {
    getApiKeyAndHeaders?: (m: Model<Api>) => Promise<{ ok: true; apiKey?: string } | { ok: false; error: string }>;
    getApiKey?: (m: Model<Api>) => Promise<string | undefined>; // legacy
  };

  if (typeof registry.getApiKeyAndHeaders === "function") {
    const auth = await registry.getApiKeyAndHeaders(model);
    return auth.ok ? auth.apiKey : undefined;
  }

  if (typeof registry.getApiKey === "function") {
    return await registry.getApiKey(model);
  }

  return undefined;
}
```

If auth cannot be resolved, return a clean user-facing error; do not throw uncaught exceptions from lifecycle handlers.

---

## 5) Desktop UI contract

Package settings modal should include:
- package title,
- discovered setting actions,
- form fields for known args (e.g. model picker),
- action buttons (`Save` / `Apply`),
- inline status/error text.

If no config actions are discovered, show an informational empty state.

---

## 6) Error + feedback contract

- Always emit explicit success/failure feedback (`ctx.ui.notify` and/or command output).
- Never rely on silent side effects.
- For unsupported Desktop UI capability requests, handle rejection gracefully.

Reference: [`docs/CAPABILITY_MODEL.md`](./CAPABILITY_MODEL.md)

---

## 7) Implementation checklist

- [ ] No hardcoded package-name checks in Desktop logic.
- [ ] Command behavior follows `/<base>`, `/<base> config`, `/<base> config <args>` contract.
- [ ] Config schema includes `enabled` and safe defaults.
- [ ] Lifecycle handlers no-op when disabled.
- [ ] Uses `getApiKeyAndHeaders` (or compatibility shim) instead of deprecated `getApiKey`.
- [ ] Package settings open from Installed row -> modal.
- [ ] UX labels are `Save`/`Apply` (not slash command strings).
- [ ] `npm run check` passes.
- [ ] `npm run build:frontend` passes.
- [ ] Manual smoke: one model-config package + one capability-only package.

## PR checklist snippet

```md
### Package capability template compliance
- [ ] Dynamic capability discovery (no package-name hardcoding)
- [ ] Command contract: /<base>, /<base> config, /<base> config <args>
- [ ] Safe defaults + enabled short-circuit for lifecycle hooks
- [ ] Uses ModelRegistry getApiKeyAndHeaders compatibility path
- [ ] Package config lives in Packages modal
- [ ] Runtime command execution is the write path
- [ ] UX labels are Save/Apply (no slash command labels)
- [ ] Verified with model-config package + capability-only package
```
