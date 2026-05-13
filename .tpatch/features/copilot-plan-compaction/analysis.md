# Analysis: copilot-plan-compaction

## Summary
Two related fixes in CopilotAdapter: (1) block write tools when `interactionMode` is `plan` by auto-denying permission requests, and (2) handle `session.compaction_start`, `session.compaction_complete`, and `session.truncation` SDK events by mapping them to canonical runtime events.

## Compatibility
- Plan mode enforcement is additive — previously write tools could execute in plan mode (bug).
- Compaction/truncation event mapping adds new event types to the runtime event stream; consumers that don't recognize them will ignore them.

## Risk: Low-Medium
- Plan mode denial logic must not trigger outside plan mode.
- Compaction events are informational; incorrect mapping is low-impact.
