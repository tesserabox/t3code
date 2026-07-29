# Spec: copilot-skill-discovery

## Acceptance Criteria
1. `session.skills_loaded` events trigger a provider snapshot update with discovered skills.
2. If the event is missed, `rpc.skills.list()` is called as a fallback after session creation.
3. SDK skills are mapped to `ServerProviderSkill` schema (name, description, trigger).
4. `$`-autocomplete in the composer populates with Copilot skills.
5. Skills list updates if a new `skills_loaded` event arrives mid-session.

## Out of Scope
- Skill execution/invocation (handled elsewhere).
- Custom skill registration UI.

## Plan
1. Add `session.skills_loaded` event handler in CopilotAdapter.
2. Add `rpc.skills.list()` fallback call after session init.
3. Map SDK skill format → `ServerProviderSkill` in CopilotProvider.
4. Call `updateSnapshot()` with new skills array.
