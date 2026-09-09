# Implementation Record: copilot-windows-payload-pruning

**Recorded**: 2026-09-09T02:32:13Z
**Files changed**: 3
**Patch size**: 26603 bytes
**Capture mode**: working-tree-all
**Pathspecs**: scripts/build-desktop-artifact.ts,scripts/build-desktop-artifact.test.ts,docs/operations/release.md

## Change Summary

```
 docs/operations/release.md             |  18 ++-
 scripts/build-desktop-artifact.test.ts | 225 +++++++++++++++++++++++++++++
 scripts/build-desktop-artifact.ts      | 254 ++++++++++++++++++++++++++++++++-
 3 files changed, 494 insertions(+), 3 deletions(-)
```

## Capture Provenance

- **capture_mode**: `working-tree-all`
- **pathspecs**: scripts/build-desktop-artifact.ts, scripts/build-desktop-artifact.test.ts, docs/operations/release.md
- **claim_ids**: (none)
- **base_commit**: `39295aed7a950a925791579661e79c4ff6b9072e`
- **upper_commit**: `working-tree`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-windows-payload-pruning/artifacts/post-apply.patch
```

