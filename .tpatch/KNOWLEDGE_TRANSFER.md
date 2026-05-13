# Knowledge Transfer: tpatch Expert Context

You are taking over as the expert on this fork. Here's everything learned across 3+ weeks, 18 features, 3 upstream syncs, cross-platform handoff (macOS→Windows), and a full reconciliation.

## CURRENT STATE (2026-04-26)

**`main` is now our production fork** — upstream v0.0.21 + all 15 applied features.
- **15 applied** (14 copilot features + 1 upstream_merged toast-close-button)
- **3 requested** (background-tasks-ui, copilot-resource-rendering, custom-agents)
- **10/10 typecheck** ✅
- **Full provider parity** including native text generation

**Branching strategy**: See `.tpatch/BRANCHING_STRATEGY.md`
- `origin/main` = our fork (upstream + all features)
- `upstream/main` = read-only upstream tracking
- Future upstream syncs: create `reconcile/v<version>` branch, re-apply, merge into main

**Old branches (archive only):**
- `feature/copilot-provider` — pre-v0.0.21
- `feature/copilot-provider-v2` — merged into main ✅
- `reconciliation/v0.0.21-assessment` — invalid merge, case study data

## RECONCILIATION LESSON LEARNED

**Never merge upstream into the feature branch for structural refactors.** Use "Option A: fresh branch from main + re-apply":
```bash
git checkout -b feature/copilot-provider-v2 main
git checkout feature/copilot-provider -- .tpatch/ .claude/
# Copy our new files (CopilotAdapter.ts, CopilotProvider.ts, etc.)
# Add "copilot" to all Record<ProviderKind, ...> — TypeScript guides you
# Adapt to new APIs (ProviderOptionDescriptor, presentation field, etc.)
# Sub-agents handle the mechanical work efficiently
```

See `.tpatch/case-studies/2026-04-26-fresh-branch-reconciliation.md` for the full story.

## Recipe Generation Script

We built `.tpatch/tools/generate-recipe.cjs` because tpatch's LLM `implement` phase produces garbage recipes 90%+ of the time. This script reverse-engineers a valid `apply-recipe.json` from a git diff range.

### Usage
```bash
# Basic: from a commit range
node .tpatch/tools/generate-recipe.cjs <slug> <from-ref> <to-ref>

# Scoped to specific files (avoids cross-feature pollution)
node .tpatch/tools/generate-recipe.cjs <slug> HEAD~1 HEAD -- apps/server/src/file.ts

# After a fresh branch reconciliation (all features in one commit)
node .tpatch/tools/generate-recipe.cjs copilot-cli-provider main HEAD -- \
  apps/server/src/provider/Layers/CopilotAdapter.ts \
  apps/server/src/provider/Layers/CopilotProvider.ts \
  packages/contracts/src/orchestration.ts
```

### How it works
1. Runs `git diff --diff-filter=A` for new files → `write-file` operations
2. Runs `git diff --diff-filter=M` for modified files → parses unified diff hunks into `replace-in-file` operations
3. Context lines (` ` prefix) are included in both `search` and `replace` for match uniqueness
4. Validates every `search` string exists in the base ref (`git show <from>:<path>`)
5. Writes to `.tpatch/features/<slug>/artifacts/apply-recipe.json`
6. Exits non-zero on validation errors

### Why it exists
- tpatch's `implement` phase rarely produces usable recipes
- `tpatch record` captures patches but NOT recipes
- Recipes are the **deterministic replay** artifact — they target a specific upstream snapshot
- Without recipes, features can only be re-applied via "read the spec and rewrite" (expensive)

### Known limitations
- Binary files are skipped
- If the same text appears multiple times in a file, the search string may not be unique — add more context lines
- After a single-commit reconciliation, ALL features get the same recipe unless you scope with `-- file1 file2`
- The script uses CommonJS (`.cjs`) because the repo has `"type": "module"` in package.json

### Suggested improvements
- Integrate into `tpatch record` as auto-generation step
- Add `--scope` flag to tpatch for per-feature file tracking
- Support `delete-file` operations (currently only write + replace)
- Hunk-level feature attribution (map hunks to features by content analysis)

Full documentation: `.tpatch/tools/WORKFLOW.md`

## CROSS-POLLUTION WARNING

All features share the same recorded patch (137KB, 27 files) because they're in one commit. `tpatch record <slug> --from main` captures ALL changes. This is acceptable but not ideal. Future work: one commit per feature for clean patches.

## Read These Files First
1. `.tpatch/RECONCILIATION_HANDOFF.md` — current situation (upstream v0.0.21 broke 5 features)
2. `.tpatch/case-studies/2026-04-26-reconciliation-impact.md` — per-feature impact assessment
3. `.tpatch/case-studies/2026-04-26-reconciliation-notes.md` — lessons learned, assumption gaps
4. `.claude/instructions.md` — technical context for this repo
5. `.tpatch/tools/WORKFLOW.md` — our proven Path B workflow + recipe generation script

## Core Lessons

### tpatch Workflow That Works
```
tpatch add --slug <name> "description"
tpatch apply <slug> --mode started
# Make ALL code changes
bun run typecheck
tpatch apply <slug> --mode done
git add <files> && git commit -m "feat: ..."
tpatch record <slug> --from <parent-commit>
node .tpatch/tools/generate-recipe.cjs <slug> <parent> HEAD
git add .tpatch/ && git commit -m "chore: record <slug>"
```

**Never use Path A** (LLM implement). It produces garbage recipes 90%+ of the time. Always use Path B (you-as-provider).

### Recipe Schema
The CLI uses `"type"` not `"op"` for operations. The skill file was wrong in v0.4.3 (fixed in v0.5.1). Always use:
```json
{ "type": "replace-in-file", "path": "...", "search": "...", "replace": "..." }
{ "type": "write-file", "path": "...", "content": "..." }
```

### Reconciliation Gotchas (learned the hard way)
1. **Never merge upstream INTO the feature branch** — it destroys patch applicability. Rebase or reconcile on clean main.
2. **"Upstreamed" verdicts are unreliable** — the LLM hallucinated that Copilot was upstreamed when upstream only added Cursor/OpenCode. Always verify.
3. **"Blocked" ≠ "broken"** — 3/7 "blocked" features had their code fully present in the tree. tpatch confused "patch can't apply" with "feature is broken."
4. **`--resolve` fails when merge blobs are missing** — 0/7 could use Phase 3.5 in our reconciliation.
5. **FEATURES.md doesn't auto-update** on `apply --mode done` or `record`. It catches up lazily.

### Cross-Feature File Conflicts
Multiple features modify `CopilotAdapter.ts`. When recording:
- `tpatch record --from <base>` captures ALL changes since base, including other features
- Use scoped recording: `git diff <base>..HEAD -- file1.ts > post-apply.patch`
- Or scope the recipe: `node .tpatch/tools/generate-recipe.cjs <slug> <base> HEAD -- file1.ts`

### Provider Integration Patterns
When adding a new provider (like Copilot) to t3code:
1. Every `Record<ProviderKind, ...>` must include the new provider (TS enforces at compile time)
2. `normalizeProviderKind()` in `composerDraftStore.ts` is a runtime gate — missing providers silently fail (clicks do nothing)
3. The old `TraitsPicker.tsx` per-provider effort handling has been **replaced** with generic `ProviderOptionDescriptor` arrays as of upstream v0.0.21
4. The old `ModelCapabilities` with `reasoningEffortLevels` is **gone** — replaced by `optionDescriptors` on model capabilities

### The New Upstream Model Options System (v0.0.21)
**This is critical for re-implementing our features:**

Old system (what our features target):
```typescript
CodexModelOptions { reasoningEffort: "low"|"medium"|"high"|"xhigh" }
ClaudeModelOptions { effort, thinking, fastMode, contextWindow }
CopilotModelOptions { reasoningEffort } // we added this
```

New system (what upstream uses now):
```typescript
ProviderOptionDescriptor { id, type: "select"|"boolean", options[], currentValue }
ProviderOptionSelection { id, value: string|boolean }
ModelCapabilities { optionDescriptors?: ProviderOptionDescriptor[] }
```

The model options are now **generic arrays**, not per-provider types. To add Copilot model options, you create `ProviderOptionDescriptor` entries describing the available options (effort levels, etc.) — the UI auto-renders them via the generic TraitsPicker.

### Key Files (Post-v0.0.21)
| File | What it does now |
|------|-----------------|
| `packages/contracts/src/model.ts` | `ProviderOptionDescriptor`, `ProviderOptionSelection`, `ModelCapabilities` |
| `packages/contracts/src/orchestration.ts` | `ProviderKind` (need to add `"copilot"`) |
| `packages/contracts/src/settings.ts` | Per-provider settings (need to add `CopilotSettings`) |
| `apps/web/src/components/chat/composerProviderState.ts` | Replaced `composerProviderRegistry.tsx` |
| `apps/web/src/components/chat/TraitsPicker.tsx` | Generic descriptor-based, no per-provider code |
| `apps/server/src/provider/builtInProviderCatalog.ts` | NEW — built-in model definitions |
| `apps/server/src/provider/providerSnapshot.ts` | Rewritten — builds provider snapshots |

### Copilot SDK
- Currently on `@github/copilot-sdk@0.3.0` (the Windows agent upgraded from 0.2.2)
- SDK permission types changed in 0.3.0 — `PermissionRequestResult` kinds are now `approve-once`, `approve-for-session`, `reject` (not the old `approved`/`denied-interactively-by-user`)
- `session.rpc.skills.list/enable/disable/reload` are `@experimental`
- `enableConfigDiscovery: true` enables auto-discovery of skills, MCP, agents
- `infiniteSessions` defaults to enabled (auto-compaction at 80% context)

### What Needs Re-Implementation
The 5 features that need adaptation to the new upstream:
1. **copilot-cli-provider** — Add `"copilot"` to `ProviderKind`, `CopilotSettings`, all `Record<ProviderKind>` maps, web components. Use new `ProviderOptionDescriptor` for model capabilities.
2. **copilot-dynamic-models** — `buildCapabilitiesFromSdkModel()` must return `{ optionDescriptors: [...] }` instead of the old `{ reasoningEffortLevels: [...] }`.
3. **copilot-plan-compaction** — Permission types changed. `denied-interactively-by-user` → `reject`. Plan mode check logic is the same.
4. **copilot-hide-internal-models** — Re-add `CopilotSettings.hideInternalModels` to new settings schema. UI toggle in SettingsPanels needs new provider card structure.
5. **effort-theming** — xhigh detection needs new descriptor-based approach (check `primarySelectDescriptor` value instead of old `promptEffort === "xhigh"`).

### Testing
```bash
nvm use 23  # or 24 for builds
export PATH="./node_modules/.bin:$PATH"
bun install && bun run typecheck  # 9 packages must pass
bun run dev  # starts server + web on localhost:5733
```

### Git Setup
```
origin: https://github.com/tesseracode/t3code.git
upstream: https://github.com/pingdotgg/t3code.git
main: synced with upstream/main (v0.0.21)
feature/copilot-provider: our feature branch (51 commits)
reconciliation/v0.0.21-assessment: reconciliation agent's work
```
