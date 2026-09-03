# Exploration: phase1-foundation

## Base

- Verified Phase 0 tip: `45ae25ab3`
- Current integrated Phase 1 source: `phase1/tws-bindings`

## Patch paths

The canonical patch is scoped to:

- attention:
  - orchestration contract/test
  - attention mapper/test
  - projection pipeline/test
  - migration 44/test
  - attention repository service/layer/test
- TWS adapter:
  - CLI adapter/test
  - CLI decoder/test
- work items:
  - work-item contract/test
  - environment capability/test
- TWS bindings:
  - binding contract/test
  - binding matcher/test
  - migration 45/test
  - binding repository service/layer/test
- shared registries:
  - `packages/contracts/src/index.ts`
  - `apps/server/src/persistence/Migrations.ts`

Total: 30 source/test paths.

## Landing method

1. Seed all current tpatch metadata onto a clean worktree based on the Phase 0
   tip, without Phase 1 source.
2. Apply the committed Phase 1 source diff.
3. Capture, test, and land `phase1-foundation`.
4. Verify the landing.
5. Merge the evidence history into the tested granular branch only after the
   non-tpatch trees match.

This avoids parallel landing ambiguity and leaves one active replay root.
