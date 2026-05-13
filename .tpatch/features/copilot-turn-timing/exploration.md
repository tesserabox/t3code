# Exploration: copilot-turn-timing

## Key Files
- `apps/server/src/provider/Layers/CopilotAdapter.ts` — `sendTurn()` method and `assistant.turn_start` event handler.

## Observations
- The `assistant.turn_start` SDK event arrives with a server-side timestamp that includes network round-trip and queue time.
- This delay caused "Worked for X" to undercount by several hundred ms to seconds.
- Fix stores `Date.now()` at the point of `sendTurn()` invocation and uses it for the `turn.started` runtime event's `createdAt` field.
- The SDK event is still processed for other purposes; only the timestamp source changes.
