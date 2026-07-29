# Exploration: copilot-plan-compaction

## Key Files
- `apps/server/src/provider/Layers/CopilotAdapter.ts` — all changes live here.

## Observations
- Permission requests flow through a callback handler in the adapter; plan mode check is added at this interception point.
- SDK emits `session.compaction_start`, `session.compaction_complete`, `session.truncation` as session-level events.
- These are mapped to the same canonical event schema used by other providers (Claude, etc.) for consistency.
- `exit_plan_mode` is an assistant event that indicates the model wants to leave plan mode; surfaced as a proposed plan for user approval.
