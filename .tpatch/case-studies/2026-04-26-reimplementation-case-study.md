# Case Study: Reconciliation Re-Implementation (v0.0.21)

**Date**: 2026-04-26
**Author**: Session 1 agent (returning after reconciliation agent's work)

## Critical Finding: The Reconciliation Branch is Invalid

The reconciliation agent merged `main` into `feature/copilot-provider`, but the merge resolved conflicts by favoring "ours" — keeping our old code but **dropping 41 upstream files** including:

- `builtInProviderCatalog.ts` (new model catalog)
- `composerProviderState.tsx` (replaced composerProviderRegistry.tsx)
- `ModelListRow.tsx`, `ModelPickerContent.tsx` (new model picker UI)
- Migration 026 (canonicalize model selection options)
- `pathExpansion.ts`, `atomicWrite.ts`, `windowReveal.ts` (new utilities)

The branch typechecks (9/9 ✅) because it has a self-consistent tree — but it's missing upstream's new features entirely. It's **our old code that happens to compile**, not a proper merge.

### Why This Happened

Git merge with conflicts defaults to marking files as conflicted. If the agent resolved all conflicts by choosing "ours," the resulting tree is valid but incomplete. This is a common pitfall with large merges — the tree compiles but is semantically wrong.

### tpatch's Role

tpatch's `reconcile` correctly identified that patches couldn't apply (7 blocked). But when the agent manually merged upstream, tpatch couldn't verify whether the merge was complete. There's no "post-merge validation" step.

**Gap**: tpatch should verify post-merge tree completeness — checking that all files from both parents exist in the result.

## Correct Reconciliation Strategy

**Don't merge upstream into the feature branch.** Instead:

### Option A: Fresh branch from main + re-apply (recommended)
```bash
git checkout main
git checkout -b feature/copilot-provider-v2
# For each feature, re-apply from spec:
tpatch apply <slug> --mode started
# Implement against new upstream
tpatch apply <slug> --mode done
tpatch record <slug>
```

### Option B: Rebase feature branch onto new main
```bash
git checkout feature/copilot-provider
git rebase main
# Resolve conflicts per-commit (51 commits = painful)
```

### Option C: Cherry-pick our additions onto main
```bash
git checkout -b feature/copilot-provider-v2 main
# Cherry-pick only the feature commits (skip metadata)
git cherry-pick <commit1> <commit2> ...
# Resolve conflicts per-cherry-pick
```

**Option A is cleanest** because:
- The new upstream model options system is fundamentally different
- Our old code won't adapt well through merge/rebase
- Re-implementing from spec ensures we use the new patterns correctly
- tpatch has the spec, exploration, and intent for each feature

## Feature Survival Assessment (revised)

After examining the reconciliation branch:

| Feature | Code Present? | Uses New System? | Action |
|---------|--------------|------------------|--------|
| copilot-cli-provider | ✅ All code present | ❌ Uses old ModelCapabilities | Re-implement with ProviderOptionDescriptor |
| copilot-dynamic-models | ✅ Code present | ❌ Returns old format | Re-implement to return optionDescriptors |
| copilot-plan-compaction | ✅ Code present | ⚠️ Old permission types | Adapt permission types |
| copilot-turn-timing | ✅ Code present | ✅ Internal only | Keep as-is |
| copilot-skill-discovery | ✅ Code present | ✅ Internal only | Keep as-is |
| copilot-hide-internal-models | ✅ Code present | ⚠️ Settings schema ok | Minor adaptation |
| copilot-cross-platform-build | ✅ Code present | ✅ Build script only | Keep as-is |
| copilot-command-events | ✅ Code present | ✅ Internal only | Keep as-is |
| copilot-resource-events | ✅ Code present | ✅ Internal only | Keep as-is |
| copilot-skill-controls | ✅ Code present | ✅ Internal only | Keep as-is |
| effort-theming | ✅ CSS present | ❌ Uses old composerProviderRegistry | Re-implement with new composerProviderState |
| readme-copilot-notice | ✅ | ✅ | Keep as-is |
| toast-close-button | ✅ | ✅ Upstreamed | Drop |
| windows-wsl-support | ✅ All code present | ✅ Desktop only | Keep as-is |

**Actual re-implementation count: 3 features** (not 5 as originally estimated):
1. `copilot-cli-provider` — model capabilities format
2. `copilot-dynamic-models` — same
3. `effort-theming` — new composer state system

The adapter-internal features (plan-compaction, timing, skills, commands, resources) survive because `CopilotAdapter.ts` is our own file that upstream never touches.

## Estimated Effort for Option A
- Fresh branch creation + tpatch init: 30 min
- Re-apply 10 clean features (adapter-internal + build + readme): 2-3 hours
- Re-implement 3 features against new model system: 4-6 hours
- Drop upstreamed toast-close-button: 5 min
- Total: **1 full session**
