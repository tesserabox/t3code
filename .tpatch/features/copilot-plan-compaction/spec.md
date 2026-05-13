# Spec: copilot-plan-compaction

## Acceptance Criteria
1. When `interactionMode === "plan"`, all write tool permission requests are automatically denied.
2. Read-only tools continue to execute normally in plan mode.
3. `session.compaction_start` events emit a canonical `compaction.started` runtime event.
4. `session.compaction_complete` events emit a canonical `compaction.completed` runtime event.
5. `session.truncation` events emit a canonical `truncation` runtime event.
6. `exit_plan_mode` events surface as proposed plan outputs.

## Out of Scope
- UI display of compaction progress.
- Plan mode toggle UI changes.

## Plan
1. Add permission-request interceptor in CopilotAdapter that checks `interactionMode`.
2. Add event handlers for compaction/truncation SDK events with mapping to canonical types.
3. Wire `exit_plan_mode` to proposed-plan output.
