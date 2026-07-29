# Spec: copilot-hide-internal-models

## Acceptance Criteria
1. `CopilotSettings` has a `hideInternalModels` boolean (default: `false`)
2. When enabled, models with "(Internal only)" in their name are filtered from the provider snapshot's model list
3. The setting is exposed in the Copilot provider settings panel in the UI
4. The filtering happens in `CopilotProvider.ts` when building the model list, not in the UI
5. `bun run typecheck` passes

## Out of Scope
- Filtering by billing tier or subscription level
- Per-model hide/show toggles

## Plan
1. Add `hideInternalModels` to `CopilotSettings` in `packages/contracts/src/settings.ts`
2. Add to `CopilotSettingsPatch` for settings updates
3. Filter models in `CopilotProvider.ts` after `listModels()` / fallback
4. Add toggle in `SettingsPanels.tsx` under Copilot provider section
