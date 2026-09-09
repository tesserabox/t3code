# Exploration: windows-portable-packaging-tests

## Sources

- Upstream `0a590fa01`: host-portable payload fixtures and path assertion.
- Upstream `30f128fab`: shared symlink capability probe.

## Paths

- `packages/shared/package.json`
- `packages/shared/src/testing/symlinks.ts`
- `scripts/build-desktop-artifact.test.ts`

## Evidence

- Local artifact suite: 61/61 passed.
- Shared direct typecheck and changed-file lint passed.
- Corrected Windows run: 181 passed, one capability-based skip.
