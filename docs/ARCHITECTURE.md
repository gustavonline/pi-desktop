# Architecture

This document explains the **product architecture** (not deep code internals).

## Mental model

Pi Desktop is a 3-layer system:

1. **Desktop host (this app)**
2. **Pi CLI runtime (`pi --mode rpc`)**
3. **Packages/extensions**

```text
User
  -> Pi Desktop UI (Lit + Tauri shell)
    -> RPC bridge (stdin/stdout)
      -> pi --mode rpc runtime
        -> packages/extensions/skills/prompts/themes
```

---

## Layer responsibilities

## 1) Desktop host (Pi Desktop)

Owns:
- windowing, panes, tabs, sidebar
- native integrations (filesystem, window focus, notifications bridge)
- workspace/project/session navigation
- resilient runtime orchestration across sessions
- rendering extension UI primitives (`notify`, `select`, `confirm`, `input`, `editor`, etc.)

Does **not** try to own all agent workflow policy.

## 2) Pi runtime (`pi --mode rpc`)

Owns:
- model execution
- conversation/session state
- tool execution pipeline
- package loading and runtime behavior

Pi Desktop talks to this runtime over a typed RPC bridge (`src/rpc/bridge.ts`).

## 3) Packages/extensions

Own optional behavior:
- workflow automation
- notification policy
- project-specific conventions
- extra commands/skills/prompts/themes

This keeps the desktop shell generic and maintainable.

### Practical direction for ongoing development

- Keep app-core work focused on **UI polish + performance + reliability**.
- Add new user-facing workflows through **packages/extensions first** whenever possible.
- Treat Pi Desktop as a **capability host** (`ctx.ui`, native shell bridge), not a hardcoded workflow layer.

For an explicit host contract and capability list, see [`docs/CAPABILITY_MODEL.md`](./CAPABILITY_MODEL.md).

---

## Runtime/session design

Pi Desktop supports multiple sessions and runtime switching.

Key goals:
- avoid cross-session state bleed
- avoid stale event application when switching fast
- keep UI responsive during reconnects/restarts

The app tracks runtime activity and binds/unbinds session context so each tab can behave predictably.

---

## Onboarding + update flow

### First run
If `pi` is not available, Pi Desktop shows an onboarding card with install command and retry flow.

### Update flow
Pi Desktop checks current/latest CLI version and can surface update affordances in settings/sidebar.

---

## UI philosophy

- neutral, low-noise visual language
- minimal but clear controls
- hover-revealed secondary actions
- avoid flashy/unreadable high-contrast accents

---

## Security boundary

Tauri permissions are declared in `src-tauri/capabilities/default.json`.

Important: this app intentionally needs shell/fs access to operate as a local coding agent host. Validate this against your environment policy before deployment.
