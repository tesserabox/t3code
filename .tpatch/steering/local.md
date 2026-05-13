# Local Steering

## Commit Strategy — One Commit Per Feature

When re-applying features (reconciliation or fresh branch), follow this strict sequence per feature:

```
1. Make code changes for ONE feature only
2. git add <feature files only — NO .tpatch/>
3. git commit -m "feat(<scope>): <description>"
4. tpatch record <slug> --from HEAD~1
   → generates patch + recipe scoped to exactly this commit
5. Move to next feature
6. ... repeat for all features ...
7. git add .tpatch/ && git commit -m "chore(tpatch): record all features"
   → single metadata commit at the end
```

**Why**: `record --from HEAD~1` captures exactly one feature's diff. No cross-pollution. Clean recipes. If a feature fails typecheck, you know which one.

**Exception**: If two features MUST be in the same commit (e.g., contracts change + adapter change that won't compile separately), combine them but document why.

## Reconciliation Process

When upstream releases new commits:

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Create reconciliation branch from upstream
git checkout -b reconcile/<version> upstream/main

# 3. Copy tpatch metadata from main
git checkout main -- .tpatch/ .claude/

# 4. Apply features in dependency order (tpatch status --dag)
#    Root features first, then dependents
#    One commit per feature, record after each

# 5. Typecheck after each feature
bun run typecheck

# 6. After ALL features applied, commit tpatch metadata
git add .tpatch/ && git commit -m "chore(tpatch): record all reconciled features"

# 7. Merge into main
git checkout main && git merge reconcile/<version>
git push origin main

# 8. Update upstream.lock
# (tpatch reconcile updates this, or manually set it)
```

## Phase Ordering

```
requested    → tpatch analyze    → analyzed
analyzed     → tpatch define     → defined
defined      → tpatch explore    → defined (exploration.md enriched)
defined      → tpatch apply --mode started / edit / --mode done    → applied
applied      → tpatch record     → active
active       → tpatch reconcile  → active | upstream_merged | blocked
```

## Dependency Validation

After completing analyze/define/explore for any feature, validate the dependency graph before implementation:
- Register dependencies: `tpatch feature deps <slug> add <parent>[:hard|:soft]`
- Validate: `tpatch feature deps --validate-all`
- View DAG: `tpatch status --dag`

## Features in In-Progress States

Features in `defined`, `analyzed`, or `requested` state during reconciliation:
- **Do not re-implement** — they have no code changes to reconcile
- **Do verify** the spec is still valid against the new upstream
- Another agent can run `define` and `explore` again later

## Recipe Generation

After recording, verify the auto-generated recipe:
```bash
tpatch record <slug> --from HEAD~1
# v0.6.1+ auto-generates artifacts/apply-recipe.json
# If not, use: node .tpatch/tools/generate-recipe.cjs <slug> HEAD~1 HEAD
```
