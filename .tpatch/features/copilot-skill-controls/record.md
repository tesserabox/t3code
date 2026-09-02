# Implementation Record: copilot-skill-controls

**Recorded**: 2026-05-15T20:50:35Z
**Files changed**: 7
**Patch size**: 8409 bytes
**Capture mode**: committed range
**Base commit**: HEAD~1
**Upper bound**: HEAD

## Change Summary

```
 .tpatch/FEATURES.md                                |    4 +-
 .../artifacts/apply-session.json                   |    6 +-
 .../artifacts/post-apply-diff.txt                  |   43 +-
 .../artifacts/post-apply.patch                     | 4847 +-------------------
 .../features/copilot-skill-controls/status.json    |   15 +-
 5 files changed, 187 insertions(+), 4728 deletions(-)
```

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/copilot-skill-controls/artifacts/post-apply.patch
```

_Patch was captured as a committed diff from `HEAD~1` to `HEAD`._
