# Implementation Record: windows-wsl-support

**Recorded**: 2026-07-29T16:36:09Z
**Files changed**: 7
**Patch size**: 42290 bytes
**Capture mode**: committed-range
**Base commit**: e42c13bf9
**Upper bound**: 27bead0f7
**Pathspecs**: apps/desktop/src/backendEnvironment.ts,apps/desktop/src/backendTarget.ts,apps/desktop/src/main.ts,apps/desktop/src/wslBackendTarget.ts,apps/desktop/src/wslServerBundle.ts,apps/server/src/cli-config.test.ts,apps/server/src/cli.ts

## Capture Provenance

- **capture_mode**: `committed-range`
- **pathspecs**: apps/desktop/src/backendEnvironment.ts, apps/desktop/src/backendTarget.ts, apps/desktop/src/main.ts, apps/desktop/src/wslBackendTarget.ts, apps/desktop/src/wslServerBundle.ts, apps/server/src/cli-config.test.ts, apps/server/src/cli.ts
- **claim_ids**: (none)
- **base_commit**: `e42c13bf9`
- **upper_commit**: `27bead0f7`

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/windows-wsl-support/artifacts/post-apply.patch
```

_Patch was captured as a committed diff from `e42c13bf9` to `HEAD`._

## Migration Note

The v0.0.23 reconciliation removed these WSL implementation paths from the
current fork while leaving the feature metadata blocked. This record rebuilds
the complete core WSL patch from the dedicated commits ending at `27bead0f7`
and excludes the unrelated `apps/server/scripts/cli.ts` hunk previously
captured with it.

The feature is intentionally patch-only. Recipe autogeneration cannot safely
read historical upper-bound files that no longer exist in the current
worktree, and retaining the resulting partial recipe would misrepresent the
seven-file canonical patch.
