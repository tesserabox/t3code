# Implementation Record: copilot-cli-provider

**Recorded**: 2026-07-29T16:34:04Z
**Files changed**: 18
**Patch size**: 134713 bytes
**Capture mode**: committed-range
**Base commit**: 48ea81c54
**Upper bound**: 2cc3de8e8
**Pathspecs**: apps/server/package.json,apps/server/src/provider/Drivers/CopilotDriver.ts,apps/server/src/provider/Layers/CopilotAdapter.ts,apps/server/src/provider/Layers/CopilotProvider.ts,apps/server/src/provider/Layers/copilotCliPath.ts,apps/server/src/provider/Layers/copilotMcpServers.ts,apps/server/src/provider/Layers/copilotTurnTracking.ts,apps/server/src/provider/Services/CopilotAdapter.ts,apps/server/src/provider/Services/CopilotProvider.ts,apps/server/src/provider/builtInDrivers.ts,apps/server/src/textGeneration/CopilotTextGeneration.ts,apps/web/src/components/KeybindingsToast.browser.tsx,apps/web/src/components/chat/providerIconUtils.ts,apps/web/src/components/settings/providerDriverMeta.ts,apps/web/src/session-logic.ts,bun.lock,packages/contracts/src/providerRuntime.ts,packages/contracts/src/settings.ts

## Capture Provenance

- **capture_mode**: `committed-range`
- **pathspecs**: apps/server/package.json, apps/server/src/provider/Drivers/CopilotDriver.ts, apps/server/src/provider/Layers/CopilotAdapter.ts, apps/server/src/provider/Layers/CopilotProvider.ts, apps/server/src/provider/Layers/copilotCliPath.ts, apps/server/src/provider/Layers/copilotMcpServers.ts, apps/server/src/provider/Layers/copilotTurnTracking.ts, apps/server/src/provider/Services/CopilotAdapter.ts, apps/server/src/provider/Services/CopilotProvider.ts, apps/server/src/provider/builtInDrivers.ts, apps/server/src/textGeneration/CopilotTextGeneration.ts, apps/web/src/components/KeybindingsToast.browser.tsx, apps/web/src/components/chat/providerIconUtils.ts, apps/web/src/components/settings/providerDriverMeta.ts, apps/web/src/session-logic.ts, bun.lock, packages/contracts/src/providerRuntime.ts, packages/contracts/src/settings.ts
- **claim_ids**: (none)
- **base_commit**: `48ea81c54`
- **upper_commit**: `2cc3de8e8`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-cli-provider/artifacts/post-apply.patch
```

*Patch was captured as a committed diff from `48ea81c54` to `HEAD`.*
