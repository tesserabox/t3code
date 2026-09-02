# Implementation Record: copilot-cli-provider

**Recorded**: 2026-07-29T19:26:03Z
**Files changed**: 19
**Patch size**: 92644 bytes
**Capture mode**: committed-range
**Base commit**: HEAD~1
**Upper bound**: HEAD
**Pathspecs**: apps/server/package.json,apps/server/src/provider/Drivers/CopilotDriver.ts,apps/server/src/provider/Layers/CopilotAdapter.test.ts,apps/server/src/provider/Layers/CopilotAdapter.ts,apps/server/src/provider/Layers/CopilotProvider.test.ts,apps/server/src/provider/Layers/CopilotProvider.ts,apps/server/src/provider/Layers/copilotClientOptions.test.ts,apps/server/src/provider/Layers/copilotClientOptions.ts,apps/server/src/provider/Services/CopilotAdapter.ts,apps/server/src/provider/builtInDrivers.ts,apps/server/src/textGeneration/CopilotTextGeneration.ts,apps/web/src/components/chat/providerIconUtils.ts,apps/web/src/components/settings/AddProviderInstanceDialog.tsx,apps/web/src/components/settings/providerDriverMeta.ts,apps/web/src/session-logic.ts,packages/contracts/src/providerRuntime.ts,packages/contracts/src/settings.ts,pnpm-lock.yaml,pnpm-workspace.yaml

## Capture Provenance

- **capture_mode**: `committed-range`
- **pathspecs**: apps/server/package.json, apps/server/src/provider/Drivers/CopilotDriver.ts, apps/server/src/provider/Layers/CopilotAdapter.test.ts, apps/server/src/provider/Layers/CopilotAdapter.ts, apps/server/src/provider/Layers/CopilotProvider.test.ts, apps/server/src/provider/Layers/CopilotProvider.ts, apps/server/src/provider/Layers/copilotClientOptions.test.ts, apps/server/src/provider/Layers/copilotClientOptions.ts, apps/server/src/provider/Services/CopilotAdapter.ts, apps/server/src/provider/builtInDrivers.ts, apps/server/src/textGeneration/CopilotTextGeneration.ts, apps/web/src/components/chat/providerIconUtils.ts, apps/web/src/components/settings/AddProviderInstanceDialog.tsx, apps/web/src/components/settings/providerDriverMeta.ts, apps/web/src/session-logic.ts, packages/contracts/src/providerRuntime.ts, packages/contracts/src/settings.ts, pnpm-lock.yaml, pnpm-workspace.yaml
- **claim_ids**: (none)
- **base_commit**: `HEAD~1`
- **upper_commit**: `HEAD`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-cli-provider/artifacts/post-apply.patch
```

_Patch was captured as a committed diff from `HEAD~1` to `HEAD`._
