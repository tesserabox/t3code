# Case Study: Fresh Branch Reconciliation — v0.0.21

**Date**: 2026-04-26
**Duration**: ~2 hours total (research + implementation)
**Upstream**: 27 commits, major model options refactor
**Result**: ✅ All 14 features re-applied, 10/10 typecheck, 1 feature marked upstream_merged

---

## What Happened

### The Problem
Upstream v0.0.21 shipped 27 commits that rewrote the model options system from per-provider types (`CodexModelOptions`, `ClaudeModelOptions`) to a generic `ProviderOptionDescriptor` array system. Our 14 applied features, built against the old system, needed reconciliation.

### Three Approaches Tried

| Approach | Agent | Time | Result |
|----------|-------|------|--------|
| 1. `tpatch reconcile` + `--resolve` | Reconciliation agent | 1 hour | 7 blocked, 3 upstreamed (1 false positive), 0 resolved by Phase 3.5 |
| 2. Merge upstream into feature branch | Reconciliation agent | 30 min | Invalid — dropped 41 upstream files, kept old code |
| 3. **Fresh branch from main + re-apply** | Original agent | 45 min | ✅ Success — 10/10 typecheck |

### Why Approach 3 Won

**Merge-based approaches fail when the upstream refactor is structural.** When upstream replaces `ModelCapabilities { reasoningEffortLevels }` with `ModelCapabilities { optionDescriptors }`, a merge produces a tree that has EITHER the old OR the new — never both correctly integrated. The merge chose "ours," which compiled but was missing 41 upstream files.

**Fresh branch + re-apply is surgical.** You start with a known-good upstream, then add your changes one by one, adapting each to the new API surface. TypeScript catches every missing entry immediately.

### The Cross-Pollution Issue

When recording all features with `tpatch record <slug> --from main`, every feature gets the **same 137KB, 27-file patch** because all changes are in one commit. This is the cross-feature pollution problem — `--from main` captures ALL changes since main for every feature.

**This is acceptable for now** because:
- The patches work for full replay (applying any one applies all)
- Feature-scoped patches would need per-feature commits
- The recipes (when generated per-feature) are properly scoped

**For future sessions**: Make one commit per feature to get clean per-feature patches.

### What the Sub-Agents Did

Two sub-agents handled the mechanical work:

1. **Agent 1** (10min): Added `copilot` to all `Record<ProviderKind, ...>` maps, `CopilotSettings`, `ModelSelectionPatch`, session-logic, composerDraftStore, SettingsPanels, server wiring, ProviderRegistry, ProviderAdapterRegistry. Result: 9/10 typecheck (13 errors in our adapter files).

2. **Agent 2** (7min): Fixed CopilotAdapter and CopilotProvider for new upstream APIs — converted `ModelCapabilities` to `optionDescriptors` format, added `presentation` field, replaced `CodexReasoningEffort` with local type, updated option access pattern. Result: 10/10 typecheck.

**Sub-agent delegation was key** — the mechanical "add copilot to every Record<ProviderKind>" work is tedious but well-scoped. Perfect for parallel agents.

---

## Key Learnings

1. **Fresh branch > merge for structural refactors.** When upstream changes the shape of core types, merge resolution is guesswork. Fresh re-application uses the compiler as your guide.

2. **Sub-agents excel at mechanical adaptation.** "Add copilot to every Record<ProviderKind, ...>" is a perfect agent task — repetitive, well-defined, verifiable by typecheck.

3. **Cross-pollution in patches is tolerable** when you have one big re-application commit. The alternative (per-feature commits) is ideal but time-consuming.

4. **`upstream_merged` state is useful.** Marking `toast-close-button` as upstream_merged (not removed) preserves the history of what happened.

5. **The checklist validation pattern works well.** Running a quick grep-based verification against a checklist after re-application catches gaps fast.

---

## Recommendations for tpatch

| Priority | Recommendation |
|----------|---------------|
| P0 | Add `tpatch reconcile --fresh-branch <name>` mode — creates new branch from upstream, copies .tpatch/, provides feature specs as re-application context |
| P0 | Auto-generate recipe from `tpatch record` — closes the biggest Path B gap |
| P1 | Warn when `record --from` produces identical patches for multiple features (cross-pollution detection) |
| P1 | Add `--state upstream_merged` flag to `tpatch amend` for manual state setting |
| P2 | Sub-agent coordination support — "apply these 5 features in parallel on worktrees, merge results" |

---

## Appendix: Recipe Generation Script

### The Problem

tpatch's LLM `implement` phase produces unusable recipes 90%+ of the time (1-operation stubs, `ensure-directory src/`, truncated JSON). `tpatch record` captures patches but NOT recipes. This leaves a gap — features can be replayed via patch but not deterministically re-applied via recipe.

We built `.tpatch/tools/generate-recipe.cjs` to close this gap by reverse-engineering a valid `apply-recipe.json` from a git diff range.

### Usage

```bash
# From a commit range (all changed files)
node .tpatch/tools/generate-recipe.cjs <slug> <from-ref> <to-ref>

# Scoped to specific files (avoids cross-feature pollution)
node .tpatch/tools/generate-recipe.cjs <slug> HEAD~1 HEAD -- apps/server/src/file.ts

# After fresh branch reconciliation (scope per feature)
node .tpatch/tools/generate-recipe.cjs copilot-cli-provider main HEAD -- \
  apps/server/src/provider/Layers/CopilotAdapter.ts \
  apps/server/src/provider/Layers/CopilotProvider.ts \
  packages/contracts/src/orchestration.ts
```

### How It Works

1. Runs `git diff --diff-filter=A` for new files → creates `write-file` operations with full file content
2. Runs `git diff --diff-filter=M` for modified files → parses unified diff hunks into `replace-in-file` operations where `search` = before-context and `replace` = after-context
3. Context lines (` ` prefix in unified diff) are included in both `search` and `replace` to ensure match uniqueness
4. **Validates** every `search` string exists in the base ref via `git show <from>:<path>` — catches parsing errors before writing
5. Writes to `.tpatch/features/<slug>/artifacts/apply-recipe.json`
6. Exits non-zero on validation errors, reporting which operations failed

### Why This Should Be Built Into tpatch

This script has been used successfully across 14+ features in this fork. The pattern is:
1. Agent implements feature (Path B)
2. Agent commits code
3. Agent runs `tpatch record` → captures patch
4. Agent runs `generate-recipe.cjs` → captures recipe
5. Both artifacts exist for replay

Step 4 is manual and easy to forget. If `tpatch record` auto-generated a best-effort recipe from the captured diff, the tooling gap would close entirely. The recipe would be "good enough" for deterministic replay — agents can always refine it later.

### Limitations

- Binary files are skipped
- If the same text appears multiple times in a file, the `search` string may not be unique (solution: include more surrounding context lines)
- After single-commit reconciliation, all features get the same recipe unless scoped with `-- file1 file2`
- Uses CommonJS (`.cjs`) because the repo has `"type": "module"` in `package.json`
- No `delete-file` or `rename-file` operations (use Path B for those)

### Suggested Improvements for tpatch Integration

1. **`tpatch record --recipe`** — auto-generate recipe alongside the patch
2. **Per-feature file tracking** in `status.json` — `"files": ["src/a.ts", "src/b.ts"]` — enables automatic scoping
3. **Hunk attribution** — map diff hunks to features by matching against recipe search strings
4. **Stale recipe detection** — compare recipe's search strings against current upstream, warn if they no longer match (v0.5.1's `recipe-provenance.json` is a start)
