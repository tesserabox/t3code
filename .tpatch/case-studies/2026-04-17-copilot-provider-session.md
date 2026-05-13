# tpatch v0.4.2 → v0.4.3 Case Study Feedback

**Repo:** tesserabox/t3code (fork of pingdotgg/t3code)
**Session:** ~20 hours across 2 days
**Features implemented:** 9 (6 applied from v0.4.2 session, 3 new with v0.4.3)
**Upstream syncs:** 1 (14 commits, including Cursor + OpenCode providers)

---

## 1. Skill/CLI Schema Mismatch (v0.4.3)

The v0.4.3 skill documents `"op"` as the operation field name in apply-recipe.json:
```json
{ "op": "replace-in-file", "path": "...", "search": "...", "replace": "..." }
```

But the CLI's `apply --mode execute` reads `"type"` and errors with `unknown operation type ""` unless you use:
```json
{ "type": "replace-in-file", "path": "...", "search": "...", "replace": "..." }
```

The skill's recipe schema example uses `"op"` in 4 places. All of them fail at runtime. Either the CLI should accept `"op"` as an alias, or the skill should document `"type"`.

---

## 2. Agent-as-Provider Fallback Not Documented (v0.4.2, partially addressed in v0.4.3)

v0.4.3 added the "You Are the Provider" section — great improvement. However, the skill still doesn't explain:

- **What files to generate and their exact format** when acting as provider. The recipe schema is now documented (good), but `analysis.md`, `spec.md`, and `exploration.md` have no schema guidance — what sections are expected? What makes a good vs bad one?
- **The `post-apply.patch` lifecycle** — when it's created, when it's updated, what format it uses (git unified diff), and that it's the source of truth for reconciliation (not the recipe).
- **How to handle `tpatch implement` producing garbage** — the skill says Path B is "normal" but doesn't say "if Path A returned a 1-operation ensure-directory stub, don't retry — switch to Path B immediately."

---

## 3. Reconcile Phase-4 False Positive (v0.4.2, acknowledged)

`tpatch reconcile` returned `reapplied` but `git apply --3way` produced 20 files with conflict markers. The honest verdict should have been `3WayConflicts`. 

The v0.4.3 skill documents the 3WayConflicts playbook which is good, but the CLI still needs the fix (distinguishing `reapplied-strict` vs `reapplied-with-3way`).

**What we did as workaround:** Reset to clean upstream, restored only `.tpatch/` via `git checkout stash@{0}^3 -- .tpatch/`, then acted as the provider to re-apply the feature's intent to the new upstream. This worked well but required understanding the reconcile internals.

---

## 4. Feature Dependency Tracking

Features form a DAG but tpatch models them as independent:

```
copilot-cli-provider
├── copilot-dynamic-models (modifies CopilotProvider.ts, created by parent)
├── copilot-plan-compaction (modifies CopilotAdapter.ts, created by parent)
├── copilot-turn-timing (modifies CopilotAdapter.ts, created by parent)
├── copilot-hide-internal-models (modifies CopilotProvider.ts + settings)
└── effort-theming (references provider === "copilot" in its diff)
```

Problems:
- `copilot-dynamic-models` recipe has `replace-in-file` on `CopilotProvider.ts` — a file that only exists after `copilot-cli-provider`. Recipe standalone fails.
- `tpatch reconcile` evaluates features independently — might say `copilot-dynamic-models` is BLOCKED because its target file doesn't exist in upstream.
- Rebase-and-squash is the only workaround for contiguous feature commits.

**Suggestion:** `depends_on: [copilot-cli-provider]` in `status.json` or `spec.md`, with `apply` and `reconcile` respecting dependency order.

---

## 5. Discontinuous Feature Commits — `record --from` Captures Cross-Feature Pollution

When multiple features are interleaved on the same branch:
```
3007567a feat(copilot): add toggle to hide internal-only models  [hide-internal]
f6e4378f feat(ui): add close button to toast notifications       [toast-close]
54aa1165 fix(copilot): remove restricted model from fallback     [hide-internal]
```

`tpatch record copilot-hide-internal-models --from 3007567a~1` diffs from base to HEAD — including toast.tsx from the unrelated feature.

**Workaround:** Manually generate `post-apply.patch` with explicit file paths:
```bash
git diff <base>..HEAD -- file1.ts file2.ts > .tpatch/features/<slug>/artifacts/post-apply.patch
```

**Suggestion:** `tpatch record --from <base> --files file1.ts file2.ts` or track which files belong to which feature in `status.json`.

---

## 6. Auto-Generate Recipe from Record (Path B Gap)

In Path B, the natural flow skips `implement` entirely: `explore --manual` → `apply --mode started` → make changes → `apply --mode done` → `record`. No `apply-recipe.json` is ever created.

We reverse-engineered recipes from `git diff` after the fact using a Node script. This works but is tedious and should be automated.

**Suggestion:** When `tpatch record` captures a patch and no `apply-recipe.json` exists, auto-generate one by parsing the unified diff into `replace-in-file` and `write-file` operations. Or have `tpatch apply --mode done` generate it from the diff between `--mode started` baseline and current tree.

---

## 7. `--manual` Flag — Works Well (v0.4.3 validation)

The `--manual` / `--skip-llm` flag works correctly on all 4 phases:
- ✅ Refuses when artifact is missing (names the exact file)
- ✅ Validates JSON on `implement --manual`  
- ✅ State advances correctly with "Phase advanced manually" note
- ✅ Full Path B chain flows into `apply` + `record` without provider

Only issue: the implement phase's JSON validation accepts the `"op"` key (matching the skill docs) but `apply --mode execute` rejects it (see item #1).

---

## 8. `tpatch record` — v0.4.2 Improvements Validated

- ✅ A8: Empty capture refused with diagnostic and `--from` candidates
- ✅ A8: Cleanup reminder when >6 patches accumulated ("13 patches accumulated... use artifacts/post-apply.patch for replay")
- ✅ A10: Clean tree enforcement on reconcile (not tested with dirty tree, but the preflight is documented)

---

## 9. FEATURES.md Not Regenerated on State Transitions

`status.json` correctly updates to `applied` after `tpatch apply --mode done` and `tpatch record`, but `FEATURES.md` retains the previous state (`requested`). The table only updates when another command happens to regenerate it.

**Repro:** `tpatch add` → skip analyze/define/explore → `tpatch apply --mode started` → `--mode done` → `record` → check FEATURES.md (still shows `requested` while status.json shows `applied`).

**Impact:** Low — FEATURES.md is a convenience view, status.json is authoritative. But it's confusing when auditing feature state.

---

## Summary — Priority Ranking

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | Skill/CLI `op` vs `type` mismatch | High (blocks recipe execution) | Trivial |
| 3 | Reconcile false positive | High (silent data corruption risk) | Medium |
| 6 | Auto-generate recipe from record | Medium (every Path B feature) | Medium |
| 5 | Cross-feature pollution in record | Medium (manual workaround exists) | Medium |
| 4 | Feature dependency tracking | Medium (rebase workaround exists) | Large |
| 9 | FEATURES.md stale on state transitions | Low (cosmetic, status.json is correct) | Trivial |
| 2 | Skill content gaps | Low (agent figures it out) | Small |
| 7 | --manual works well | Positive validation | — |
| 8 | v0.4.2 record fixes work | Positive validation | — |
