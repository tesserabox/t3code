# Implementation Record: hosting-work-item-contracts

**Recorded**: 2026-09-03T09:23:32Z
**Files changed**: 5
**Patch size**: 17019 bytes
**Capture mode**: working-tree-all
**Pathspecs**: packages/contracts/src/workItem.ts,packages/contracts/src/workItem.test.ts,packages/contracts/src/index.ts,packages/contracts/src/environment.ts,packages/contracts/src/environment.test.ts

## Change Summary

```
 packages/contracts/src/environment.test.ts | 13 +++++++++++++
 packages/contracts/src/environment.ts      |  2 ++
 packages/contracts/src/index.ts            |  1 +
 3 files changed, 16 insertions(+)
```

## Capture Provenance

- **capture_mode**: `working-tree-all`
- **pathspecs**: packages/contracts/src/workItem.ts, packages/contracts/src/workItem.test.ts, packages/contracts/src/index.ts, packages/contracts/src/environment.ts, packages/contracts/src/environment.test.ts
- **claim_ids**: (none)
- **base_commit**: `3e7848b129fa1e1d438a7e59626c54f2c92c8915`
- **upper_commit**: `working-tree`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/hosting-work-item-contracts/artifacts/post-apply.patch
```

