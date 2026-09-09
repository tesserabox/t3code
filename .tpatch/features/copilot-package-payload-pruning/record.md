# Implementation Record: copilot-package-payload-pruning

**Recorded**: 2026-09-09T02:40:53Z
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
- **base_commit**: `ee3377d45c2895073315d4135ef104e53d8cb1ca`
- **upper_commit**: `working-tree`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-package-payload-pruning/artifacts/post-apply.patch
```

