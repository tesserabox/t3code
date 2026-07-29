# Spec: copilot-turn-timing

## Acceptance Criteria
1. `turn.started` event `createdAt` uses the timestamp captured at `sendTurn()` invocation.
2. "Worked for X" elapsed time reflects actual wall-clock duration from user submission.
3. SDK `assistant.turn_start` timestamp is no longer used for elapsed time calculation.

## Out of Scope
- Server-side timing metrics or telemetry.
- Timer display formatting changes.

## Plan
1. Capture `Date.now()` immediately before/at `sendTurn()` call.
2. Pass captured timestamp as `createdAt` when emitting the `turn.started` event.
3. Ignore `assistant.turn_start` event timestamp for display purposes.
