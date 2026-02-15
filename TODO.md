# TODO (Issue Mirror)

## Active issue
- Issue: #3 — [P0] Add RPC capability fallback and compatibility messaging
- Branch: feat/3-rpc-compat-fallback
- Scope summary: Add compatibility probing + graceful feature fallback messaging when CLI/RPC capabilities differ.

## Acceptance criteria (from issue)
- [x] Missing/non-supported RPC calls are surfaced as actionable messages
- [x] Feature areas degrade gracefully without crashing UI
- [x] Settings panel reports compatibility state clearly

## Session checklist
- [x] Implementation done
- [x] `npm run check` passed
- [x] `npm run build:frontend` passed
- [x] `cargo check` passed
- [ ] Manual smoke checks done for changed flow
- [x] Changes committed and pushed
- [x] PR opened/updated

## Session notes
- Expanded `checkRpcCompatibility()` with required + optional capability checks and structured warnings.
- Added `rpcBridge.formatFeatureError()` for actionable compatibility-aware error messages.
- Wired compatibility status details into Settings → CLI Runtime and applied feature-error fallbacks in chat/settings actions.
