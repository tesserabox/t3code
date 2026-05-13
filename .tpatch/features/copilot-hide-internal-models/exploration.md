# Exploration: copilot-hide-internal-models

## Relevant Files
- `packages/contracts/src/settings.ts` — `CopilotSettings` schema (line ~92), `CopilotSettingsPatch` (line ~201)
- `apps/server/src/provider/Layers/CopilotProvider.ts` — model list filtering after `listModels()` and in `BUILT_IN_MODELS` fallback
- `apps/web/src/components/settings/SettingsPanels.tsx` — Copilot provider settings section

## Key Observations
- Models from SDK have a `name` field — internal ones contain "(Internal only)" e.g. "Claude Opus 4.6 (1M context)(Internal only)"
- Also could check `billing.restricted_to` or `policy` fields, but name-based filtering is simplest
- The filter should happen in `CopilotProvider.ts` when building `runtimeModels` array, so internal models never reach the UI
- Static `BUILT_IN_MODELS` also has `claude-opus-4.6-1m` — should be filtered there too when the setting is on
