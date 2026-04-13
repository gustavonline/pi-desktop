# Chat UI polish – temporary checklist

Context: consolidated from latest UX feedback for Codex-like chat/workflow parity.

## Workflow / dropdown behavior
- [x] Keep workflow expanded by default while run is active.
- [x] Respect manual collapse override during active run (do not auto-reopen on subsequent tool events).
- [x] Avoid closing on individual tool completion; close automatically only when final agent text handoff starts.
- [x] Hide global bottom Pi working indicator when a workflow dropdown is expanded.
- [x] Show global bottom Pi working indicator when dropdown is collapsed.
- [x] Render inline Pi indicator inside expanded workflow for active thinking/tool rows.
- [x] Keep inline Pi + running text animation in sync (same animation cadence).
- [x] Support concurrent running tool groups (indicator on each running row).

## Thinking / tool timeline
- [x] Thinking should not be hard-locked to top: keep timeline order from message stream.
- [x] Thinking blocks can appear before, between, or after tool rows based on actual event order.
- [x] Thinking detail area uses scroll/max-height behavior like tool details.
- [x] Thinking content tone/weight aligned to tool detail content style.

## Code block UX polish
- [x] Remove assistant message-level copy action when message is only a single fenced code block.
- [x] Keep code-block-local copy action as primary copy affordance.
- [x] Remove card-in-card look for fenced blocks (single surface treatment).
- [x] Tighten code block spacing, header/footer proportions, and copy icon sizing.
- [x] Soften copy button/copied state visual weight for minimal look.

## Composer/status cleanliness
- [x] Suppress internal extension status-key events (for example `oqto_title_changed`) so title-sync events do not render stray text above composer controls.

## Remaining QA pass
- [ ] Validate long code blocks (horizontal + vertical scroll behavior).
- [ ] Validate mixed markdown (paragraph + code block + paragraph) copy button behavior.
- [ ] Validate timeline ordering on streamed runs with interleaved thinking/tool updates.
- [ ] Validate manual collapse persistence across multi-tool runs with retries.
