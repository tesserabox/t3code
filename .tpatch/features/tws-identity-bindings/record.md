# Implementation Record: tws-identity-bindings

**Recorded**: 2026-09-03T10:06:41Z
**Files changed**: 11
**Patch size**: 67663 bytes
**Capture mode**: working-tree-all
**Pathspecs**: packages/contracts/src/twsBindings.ts,packages/contracts/src/twsBindings.test.ts,packages/contracts/src/index.ts,apps/server/src/tws/TwsBindingMatch.ts,apps/server/src/tws/TwsBindingMatch.test.ts,apps/server/src/persistence/Migrations.ts,apps/server/src/persistence/Migrations/045_TwsBindings.ts,apps/server/src/persistence/Migrations/045_TwsBindings.test.ts,apps/server/src/persistence/Services/TwsBindings.ts,apps/server/src/persistence/Layers/TwsBindings.ts,apps/server/src/persistence/Layers/TwsBindings.test.ts

## Change Summary

```
 apps/server/src/persistence/Migrations.ts | 2 ++
 packages/contracts/src/index.ts           | 1 +
 2 files changed, 3 insertions(+)
```

## Capture Provenance

- **capture_mode**: `working-tree-all`
- **pathspecs**: packages/contracts/src/twsBindings.ts, packages/contracts/src/twsBindings.test.ts, packages/contracts/src/index.ts, apps/server/src/tws/TwsBindingMatch.ts, apps/server/src/tws/TwsBindingMatch.test.ts, apps/server/src/persistence/Migrations.ts, apps/server/src/persistence/Migrations/045_TwsBindings.ts, apps/server/src/persistence/Migrations/045_TwsBindings.test.ts, apps/server/src/persistence/Services/TwsBindings.ts, apps/server/src/persistence/Layers/TwsBindings.ts, apps/server/src/persistence/Layers/TwsBindings.test.ts
- **claim_ids**: (none)
- **base_commit**: `ae62583898a1853f5f248d082054ccce0d259f50`
- **upper_commit**: `working-tree`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/tws-identity-bindings/artifacts/post-apply.patch
```

