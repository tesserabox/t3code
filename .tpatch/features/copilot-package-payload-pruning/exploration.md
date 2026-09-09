# Exploration: copilot-package-payload-pruning

## Evidence

- Windows validator: 97 files, limit 80.
- Exact pinned x64 packages: 32 added loose natives.
- Reviewed x64 removal: 19; expected result: 78.
- Artifact tests: 65/65.
- Script typecheck and changed-file lint: passed.
- Real pruned Linux x64 payload loaded specialized clipboard fallback and
  started Copilot `1.0.75`, protocol 3.

## Paths

- `scripts/build-desktop-artifact.ts`
- `scripts/build-desktop-artifact.test.ts`
- `docs/operations/release.md`
