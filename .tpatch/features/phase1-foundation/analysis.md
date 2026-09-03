# Analysis: phase1-foundation

## Summary

The granular Phase 1 features are independently reviewed and landed, but two
shared registry files are legitimately extended by later children:

- `apps/server/src/persistence/Migrations.ts`
- `packages/contracts/src/index.ts`

Re-verifying an earlier granular patch at the final integrated tree can
therefore discard all context for those files even though the downstream
change is correct and explicitly ordered. A single integrated maintenance root
is needed in addition to the granular audit records.

## Compatibility

- The consolidated source is exactly the already-tested Phase 1 tree.
- No new runtime behavior is introduced by consolidation.
- Phase 0 Copilot and search remain hard parents.
- Granular Phase 1 features remain available as review/provenance records but
  are superseded for future replay.
- Five historical Copilot child records are also superseded because their
  accepted behavior is already provided by the hard-parent Copilot root.

## Recommendation

Record and land one 30-file Phase 1 patch from the verified Phase 0 tip, verify
that patch as the active maintenance root, and retain the granular branches and
commits as audit history.
