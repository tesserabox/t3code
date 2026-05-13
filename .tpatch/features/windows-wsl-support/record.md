# Implementation Record: windows-wsl-support

**Recorded**: 2026-05-04T06:22:13Z
**Files changed**: 3
**Patch size**: 12201 bytes

## Change Summary

```
 .../windows-wsl-support/artifacts/post-apply.patch | 5111 ++------------------
 .tpatch/features/windows-wsl-support/spec.md       |   21 +
 2 files changed, 303 insertions(+), 4829 deletions(-)
```

## Replay Instructions

To re-apply this feature to a clean checkout:

```bash
# From the feature's artifacts directory:
git apply .tpatch/features/windows-wsl-support/artifacts/post-apply.patch
```

_Patch was captured as a committed diff from `27bead0f~1` to `HEAD`._

## Follow-up: Windows Node Exec Path Shelling

**Recorded**: 2026-05-04T19:58:00Z
**Files changed**: 1

Desktop dev runs `t3#build` before launching Electron. The server build wrapper was spawning `process.execPath` with `shell: true`; on Windows installs under `C:\Program Files`, that caused the shell to split the executable path and fail with `'C:\Program' is not recognized`. The follow-up patch removes shell mode for the direct Node executable spawn in `apps/server/scripts/cli.ts`.

Validation performed before recording this follow-up:

```bash
bun run --filter t3 build
bun run dev:desktop
bun --cwd apps/desktop run test
tpatch test windows-wsl-support
bun fmt
bun typecheck
bun lint
```

On Windows, `tpatch test windows-wsl-support` requires Git Bash `sh.exe` on `PATH`; the verified run used `C:\Program Files\Git\usr\bin` and recorded `artifacts/test-output.txt`.

`bun fmt` was initially blocked by JSON conflict markers in `.tpatch/features/**/status.json`; those JSON markers were resolved by keeping the newer reconciliation side.
