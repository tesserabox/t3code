# Implementation Record: copilot-package-payload-pruning

**Recorded**: 2026-09-09T02:35:04Z
**Files changed**: 3
**Patch size**: 26603 bytes
**Capture mode**: explicit-committed-range
**Base commit**: 39295aed7a950a925791579661e79c4ff6b9072e
**Upper bound**: c0f4c4b566581e9e5c330298aa259d03c333bc4b
**Pathspecs**: scripts/build-desktop-artifact.ts,scripts/build-desktop-artifact.test.ts,docs/operations/release.md

## Capture Provenance

- **capture_mode**: `explicit-committed-range`
- **pathspecs**: scripts/build-desktop-artifact.ts, scripts/build-desktop-artifact.test.ts, docs/operations/release.md
- **claim_ids**: (none)
- **base_commit**: `39295aed7a950a925791579661e79c4ff6b9072e`
- **upper_commit**: `c0f4c4b566581e9e5c330298aa259d03c333bc4b`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-package-payload-pruning/artifacts/post-apply.patch
```

*Patch was captured as a committed diff from `39295aed7a950a925791579661e79c4ff6b9072e` to `HEAD`.*
