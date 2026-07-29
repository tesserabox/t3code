# Analysis: copilot-turn-timing

## Summary
The "Worked for X" elapsed timer displays incorrect durations because it uses the SDK's `assistant.turn_start` event timestamp (which arrives late due to network/processing delay) instead of the local `sendTurn()` call timestamp. Fix: capture `Date.now()` at `sendTurn()` and use it as `createdAt` for the `turn.started` event.

## Compatibility
- Purely a timing fix; no behavioral or API changes.
- Only affects CopilotAdapter.

## Risk: Low
- Worst case: timer is still slightly off, but always more accurate than before.
