# Implementation Record: copilot-cli-provider

**Recorded**: 2026-09-03T07:34:29Z
**Files changed**: 38
**Patch size**: 292795 bytes
**Capture mode**: committed-range
**Base commit**: d01f4d65fd45a2f018019895da595142aeb106eb
**Upper bound**: HEAD
**Pathspecs**: README.md,apps/mobile/src/components/ProviderIcon.tsx,apps/server/package.json,apps/server/src/provider/Drivers/CopilotDriver.test.ts,apps/server/src/provider/Drivers/CopilotDriver.ts,apps/server/src/provider/Layers/CopilotAdapter.test.ts,apps/server/src/provider/Layers/CopilotAdapter.ts,apps/server/src/provider/Layers/CopilotProvider.test.ts,apps/server/src/provider/Layers/CopilotProvider.ts,apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.test.ts,apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts,apps/server/src/provider/Layers/copilotClientOptions.test.ts,apps/server/src/provider/Layers/copilotClientOptions.ts,apps/server/src/provider/builtInDrivers.ts,apps/server/src/serverSettings.ts,apps/server/src/textGeneration/CopilotTextGeneration.test.ts,apps/server/src/textGeneration/CopilotTextGeneration.ts,apps/server/src/textGeneration/TextGeneration.ts,apps/web/src/components/chat/providerIconUtils.test.ts,apps/web/src/components/chat/providerIconUtils.ts,apps/web/src/components/settings/AddProviderInstanceDialog.tsx,apps/web/src/components/settings/ProviderSettingsForm.test.ts,apps/web/src/components/settings/ProviderSettingsPanel.tsx,apps/web/src/components/settings/SettingsPanels.logic.test.ts,apps/web/src/components/settings/SettingsPanels.logic.ts,apps/web/src/components/settings/providerDriverMeta.ts,apps/web/src/session-logic.ts,docs/README.md,docs/user/providers-copilot.md,packages/contracts/src/model.ts,packages/contracts/src/providerRuntime.test.ts,packages/contracts/src/providerRuntime.ts,packages/contracts/src/settings.test.ts,packages/contracts/src/settings.ts,pnpm-lock.yaml,pnpm-workspace.yaml,scripts/lib/cli-external-packages.test.ts,scripts/lib/cli-external-packages.ts

## Capture Provenance

- **capture_mode**: `committed-range`
- **pathspecs**: README.md, apps/mobile/src/components/ProviderIcon.tsx, apps/server/package.json, apps/server/src/provider/Drivers/CopilotDriver.test.ts, apps/server/src/provider/Drivers/CopilotDriver.ts, apps/server/src/provider/Layers/CopilotAdapter.test.ts, apps/server/src/provider/Layers/CopilotAdapter.ts, apps/server/src/provider/Layers/CopilotProvider.test.ts, apps/server/src/provider/Layers/CopilotProvider.ts, apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.test.ts, apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts, apps/server/src/provider/Layers/copilotClientOptions.test.ts, apps/server/src/provider/Layers/copilotClientOptions.ts, apps/server/src/provider/builtInDrivers.ts, apps/server/src/serverSettings.ts, apps/server/src/textGeneration/CopilotTextGeneration.test.ts, apps/server/src/textGeneration/CopilotTextGeneration.ts, apps/server/src/textGeneration/TextGeneration.ts, apps/web/src/components/chat/providerIconUtils.test.ts, apps/web/src/components/chat/providerIconUtils.ts, apps/web/src/components/settings/AddProviderInstanceDialog.tsx, apps/web/src/components/settings/ProviderSettingsForm.test.ts, apps/web/src/components/settings/ProviderSettingsPanel.tsx, apps/web/src/components/settings/SettingsPanels.logic.test.ts, apps/web/src/components/settings/SettingsPanels.logic.ts, apps/web/src/components/settings/providerDriverMeta.ts, apps/web/src/session-logic.ts, docs/README.md, docs/user/providers-copilot.md, packages/contracts/src/model.ts, packages/contracts/src/providerRuntime.test.ts, packages/contracts/src/providerRuntime.ts, packages/contracts/src/settings.test.ts, packages/contracts/src/settings.ts, pnpm-lock.yaml, pnpm-workspace.yaml, scripts/lib/cli-external-packages.test.ts, scripts/lib/cli-external-packages.ts
- **claim_ids**: (none)
- **base_commit**: `d01f4d65fd45a2f018019895da595142aeb106eb`
- **upper_commit**: `HEAD`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-cli-provider/artifacts/post-apply.patch
```

*Patch was captured as a committed diff from `d01f4d65fd45a2f018019895da595142aeb106eb` to `HEAD`.*
