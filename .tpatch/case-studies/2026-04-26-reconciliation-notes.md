# Notes on Reconciliation Case Study — From the Original Session Agent

**Author**: Session 1 agent (macOS, built 13+ features from scratch, 3 upstream syncs)
**Subject**: `2026-04-26-reconciliation-case-study.md` by the reconciliation agent

---

## Where tpatch's Assumptions Break Down

### 1. The "patch as unit of truth" assumption

tpatch assumes the recorded patch (`post-apply.patch`) is the authoritative representation of a feature. But patches are **fragile** — they encode context lines, line numbers, and surrounding code. When upstream changes even nearby lines, the patch fails to apply even though the feature's code is still valid.

**The gap**: tpatch equates "patch doesn't apply" with "feature is broken." In reality, on a long-lived feature branch that merges upstream, the code persists through the merge. The patch mechanics are broken but the code is fine. Three of our "blocked" features proved this — the code was present and working, but tpatch called them blocked.

**What should happen**: Before declaring "blocked," tpatch should check if the feature's key identifiers (function names, class names, unique strings from the recipe's search fields) exist in the current tree. If they do, the feature is "drifted" not "blocked."

### 2. The "upstream can't have done what you did" assumption

Phase 3 asks the LLM "has upstream obsoleted this feature?" This is a **dangerous question to outsource to an LLM** without evidence. The LLM saw our spec about "adding a provider" and noted upstream added Cursor and OpenCode providers. It concluded our Copilot provider was "satisfied" — a hallucination. Upstream added *different* providers, not Copilot.

**The gap**: The LLM has no way to verify its answer. It's pattern-matching on spec text, not checking if `"copilot"` appears in the upstream `ProviderKind` enum.

**What should happen**: Phase 3 should require evidence — specific file:line references where upstream satisfies each acceptance criterion. Or better: check the recipe's search strings against upstream. If none match, the feature is definitively NOT upstreamed.

### 3. The "features are independent" assumption

tpatch evaluates each feature in isolation during reconciliation. But our features form a dependency chain: `copilot-cli-provider` → `copilot-dynamic-models` → `copilot-plan-compaction` → etc. When the base feature's verdict is wrong ("upstreamed" when it's not), all dependent features' verdicts are unreliable.

**The gap**: No dependency awareness. A wrong verdict on the root feature cascades to all dependents.

**What should happen**: Features should declare dependencies. Reconcile should evaluate the root first, then propagate its verdict before evaluating dependents.

### 4. The "same base = clean reconcile" assumption

When you merge upstream into your feature branch (as our agent did), the code survives but the patches become meaningless. They were recorded against the pre-merge tree. Post-merge, `git apply` can't find the context lines because they're in a different position (or unchanged, since they survived the merge).

**The gap**: tpatch doesn't know that a branch merge invalidates recorded patches. It tries to apply them and fails.

**What should happen**: After a merge, `tpatch record` should detect that the base ref has changed and prompt for re-recording. Or reconcile should have a "post-merge" mode that verifies code presence instead of trying to re-apply patches.

### 5. The "`--resolve` needs merge blobs" assumption

Phase 3.5 (`--resolve`) uses git's 3-way merge infrastructure, which needs a common ancestor blob. When features were created on a branch that has since been rebased or merged, the blobs don't exist in the expected locations. All 7 of our blocked features failed `--resolve` for this reason.

**The gap**: `--resolve` has a hard dependency on git history topology. If the history is non-linear (rebase, squash, merge), it fails silently.

**What should happen**: Fall back to whole-file semantic diff when blobs aren't available. Or reconstruct the "before" state from the recorded patch (the search strings ARE the before state).

---

## What I Would Do Differently With This Knowledge

1. **Never merge upstream into the feature branch.** Rebase or reconcile on a clean main, but don't merge — it destroys patch applicability.

2. **Record features immediately after implementation**, not after metadata cleanup. The later you record, the more likely the tree has drifted.

3. **Keep the recipe as the primary replay artifact**, not the patch. Recipes with `replace-in-file` can adapt to shifted line numbers if the search string is unique enough. Patches can't.

4. **Test reconciliation on a throwaway branch first.** Don't reconcile on the main feature branch — do it on `reconciliation/<slug>` and merge if it works.

5. **Scope feature files explicitly.** When registering a feature, list the files it touches. This prevents cross-feature pollution in patches and enables code-presence verification.

---

## Recommendations for tpatch Team

| Priority | Recommendation | Why |
|----------|---------------|-----|
| P0 | Add code-presence check before "blocked" verdict | 3/7 false positives in our reconciliation |
| P0 | Require evidence for "upstreamed" verdict | LLM hallucinated that Copilot was upstreamed |
| P1 | Auto-re-record after upstream merge | Patches become stale, users don't realize |
| P1 | Feature dependency declaration | Wrong root verdict cascades to all dependents |
| P2 | `--resolve` fallback without merge blobs | 0/7 could use `--resolve` due to missing blobs |
| P2 | Recipe-based reconciliation (not just patch-based) | Recipes are more resilient to line drift |
| P3 | "Drifted" vs "blocked" vs "upstreamed" verdict taxonomy | Current binary is too coarse |
