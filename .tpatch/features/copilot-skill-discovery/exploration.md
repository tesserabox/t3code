# Exploration: copilot-skill-discovery

## Key Files
- `apps/server/src/provider/Layers/CopilotAdapter.ts` — event listener for `session.skills_loaded`, RPC fallback call.
- `apps/server/src/provider/Layers/CopilotProvider.ts` — skill mapping and snapshot update logic.

## Observations
- `session.skills_loaded` payload contains an array of skill objects with `name`, `description`, and `trigger` fields.
- `rpc.skills.list()` returns the same schema; used as fallback when the event fires before the listener is registered.
- `ServerProviderSkill` is the canonical skill type used across all providers for UI consumption.
- Snapshot update triggers a re-render of the composer autocomplete dropdown.
