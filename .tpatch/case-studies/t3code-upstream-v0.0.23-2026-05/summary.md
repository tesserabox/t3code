# Case Study: v0.0.23 Upstream Reconciliation — Structural Middle-pass Data

**Study ID**: `t3code-upstream-v0.0.23-2026-05`
**Date**: 2026-05-13/14
**Upstream delta**: 62 commits (v0.0.21 lock → v0.0.23)
**Features**: 25 total, 13 re-applied, 3 upstreamed, 2 true conflicts, 7 not yet implemented

---

## Key Findings for Middle-pass Research

### 1. Verdict accuracy: tpatch `blocked` is overly conservative

Of 15 features marked `blocked` by `tpatch reconcile`:
- **9 (60%)** reapplied cleanly — patches are entirely additive (new files, new array entries) with zero overlap against upstream changes
- **4 (27%)** needed minor relocation — insertion points shifted but the semantic content was unchanged
- **2 (13%)** were true conflicts — upstream restructured the desktop app heavily enough that our IPC/environment code needs a full rewrite

**Implication**: A structural middle-pass that can distinguish "additive patch vs overlapping patch" would eliminate ~87% of false `blocked` verdicts.

### 2. Additive patches dominate fork customization

The copilot provider feature is the largest (43 hunks, 18 files) but touches zero upstream files destructively. It adds:
- New files: CopilotDriver.ts, CopilotAdapter.ts, CopilotProvider.ts, etc.
- Array entries: builtInDrivers, PROVIDER_OPTIONS, RuntimeEventRawSource union
- Schema extensions: CopilotSettings, providers struct field

A middle-pass system that tracks "file is new" vs "file is modified" would correctly classify most copilot hunks as `applies-clean` without needing AST analysis.

### 3. Relocation patterns are consistent and predictable

The 4 features that needed relocation all followed the same pattern:
- **Type**: insertion-point shift (upstream added entries before/after our insertion point)
- **Fix**: find the equivalent anchor (e.g., the `ultrathink` block for effort-theming, the provider list for README) and insert after it
- **Difficulty**: trivial for a human, but requires semantic understanding of "equivalent anchor"

### 4. Upstream absorption is detectable at operation level

Both upstreamed features (`session-search`, `copilot-skill-controls`) were correctly detected by tpatch's phase-2 operation-level check — "all recipe operations already present in upstream." This is the one area where tpatch's current heuristics work well.

### 5. True conflicts correlate with upstream restructure scope

The 2 true conflicts (`desktop-managed-environments-connections`, `windows-wsl-support`) share a root cause: upstream restructured `apps/desktop/src/` from a flat layout to `app/`, `backend/`, `electron/` subdirectories. Our features added files and IPC channels to the old layout. This is a **structural conflict** detectable by path-prefix analysis without reading file contents.

## Adaptation Taxonomy

| Adaptation | Count | Automatable? |
|------------|-------|-------------|
| New API parameter (maintenanceCapabilities) | 1 | Partially — needs type inference |
| Lint rule compliance (barrel → namespace imports) | 1 | Yes — mechanical transform |
| Type union extension (add new literals) | 1 | Yes — pattern matching |
| Effect wrapper (plain → Effect.succeed) | 1 | Partially — needs type context |
| Insertion point relocation | 2 | Needs anchor matching |
| Content rewrite (README format change) | 1 | Needs semantic understanding |

## Data Files

| File | Records | Description |
|------|---------|-------------|
| `study.json` | 1 | Study metadata and parameters |
| `features.jsonl` | 25 | Per-feature outcomes with ground-truth labels |
| `hunks.jsonl` | 53 | Per-hunk metadata (path, header, line counts, hash) |
| `patches.jsonl` | 4 | Per-commit patch summaries |
| `metrics.json` | 1 | Aggregate metrics and verdict accuracy |

## Recommendations for tpatch

1. **Add file-level novelty classification**: "new file" patches should auto-classify as `applies-clean`, not `blocked`
2. **Add hunk-level overlap detection**: only flag hunks whose context lines intersect with upstream diff hunks
3. **Improve `blocked` granularity**: distinguish "patch doesn't apply" (git error) from "patch context shifted" (relocation needed) from "patch target deleted" (true conflict)
4. **Track structural restructures**: detect when upstream moves files to new paths and flag dependent features early
