# Analysis: copilot-skill-discovery

## Summary
Surfaces skills discovered by the Copilot SDK to the UI. Listens for `session.skills_loaded` events and falls back to `rpc.skills.list()` after session creation. Maps SDK skill objects to `ServerProviderSkill` schema and updates the provider snapshot so `$`-autocomplete populates in the composer.

## Compatibility
- Additive feature; no existing behavior changes.
- Touches both CopilotAdapter (event handling) and CopilotProvider (snapshot update).

## Risk: Low
- If skill mapping fails, autocomplete simply won't show skills — no crash path.
- Fallback RPC call handles race condition where event fires before listener is attached.
