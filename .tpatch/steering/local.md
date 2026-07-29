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

## Verification Baseline

Run static metadata checks on the feature-bearing fork:

```bash
tpatch doctor --check D2 --check D7
git apply -R --check .tpatch/features/<slug>/artifacts/post-apply.patch
```

Run dynamic `tpatch verify` only from the fresh upstream reconciliation branch
after restoring `.tpatch/`. Verify allocates its shadow from the current
`HEAD`; on the feature-bearing fork, an applied feature is already present and
its canonical patch cannot be forward-applied a second time. On the upstream
branch, V7 and V8 correctly test recipe and patch replay against the feature-free
baseline plus hard-parent closure.

For migrated historical features, also check the canonical patch against its
recorded base in a detached worktree before committing metadata.

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

For new work, prefer `tpatch land <slug>` so recording, scoped staging, commit
trailers, and patch-generation metadata stay atomic.

For historical committed work, reconstruct the narrowest exact commit range and
declare advisory file claims before regenerating:

```bash
tpatch feature claim add <slug> <feature-path...>
tpatch record <slug> \
  --from <feature-parent> \
  --to <feature-commit> \
  --files <comma-separated-feature-paths> \
  --regenerate-recipe
tpatch doctor --check D2 --check D7
```

Do not regenerate a historical feature from a broad upstream-to-HEAD range:
that recreates the cross-feature patch pollution found in the v0.0.23 records.

If committed-range recipe autogeneration cannot read files from the current
worktree because upstream deleted or moved them, keep the feature patch-only.
Do not retain a partial recipe or replace modified upstream files with
snapshot-wide `write-file` operations. The canonical patch remains the
authoritative intent, and dynamic verify will skip V7 while still running V8.

After rebuilding a historical canonical patch, remove any pre-existing
`artifacts/incremental.patch`. Reconcile prefers the incremental artifact when
both exist, so a stale incremental patch can silently override the newly
recorded canonical feature boundary and contaminate verdict evidence.

Reconcile independent feature patches one slug per invocation. The current
multi-slug path assumes later canonical patches are cumulative and derives
cross-feature incremental deltas; that assumption is incompatible with scoped
claims and one-feature-per-commit recording.

When the upstreamed confirmation gate rejects a semantic candidate for missing
commit evidence, record the human decision with `tpatch reconcile review add`.
Do not manually edit lifecycle state if `confirm-upstreamed` still refuses the
reviewed candidate; keep it blocked until tpatch provides an evidence-linked
human transition.
