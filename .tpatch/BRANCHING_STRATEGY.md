# Branching Strategy for Fork Management

## Current State (pre-reconcile v0.0.23)

```
upstream/main (b83e9c95, v0.0.23) ← 62 commits ahead of our lock
         │
         └── main (2245ccfd, tag: pre-reconcile-v0.0.23) ← production fork with 25 features
              │
              └── (last lock: 9df3c640, v0.0.21) features, typechecks ✅
```

**Old branches (archive, do not use):**

- `feature/copilot-provider` — pre-v0.0.21, based on old upstream
- `feature/copilot-provider-v2` — merged into main during v0.0.21 reconcile
- `reconciliation/v0.0.21-assessment` — invalid merge, case study data only
- `reconcile/v0.0.22` — merged into main, completed

## Strategy: `main` = Our Fully-Featured Fork

### The principle

`origin/main` should be our **production-ready fork** — upstream + all applied features. This is what we build, test, and deploy from.

`upstream/main` (the remote) tracks the upstream project. We never push to it.

### Workflow

**When upstream releases a new version (proven fresh branch approach):**

```bash
# 1. Tag save point
git tag pre-reconcile-v<version> HEAD

# 2. Fetch upstream
git fetch upstream

# 3. Run tpatch reconcile for verdicts
tpatch reconcile --from <lock-commit> --to upstream/main

# 4. Create reconciliation branch from upstream
git checkout -b reconcile/v<version> upstream/main

# 5. Copy tpatch + claude metadata
git checkout main -- .tpatch/ .claude/
git add .tpatch/ .claude/ && git commit -m "chore: bring tpatch metadata"

# 6. Re-apply features in dependency order (Path B — agent-authored)
# For each feature:
#   tpatch apply <slug> --mode started
#   <make changes, adapt to new upstream APIs>
#   git commit -m "feat(<slug>): re-apply for v<version>"
#   tpatch apply <slug> --mode done
#   tpatch record <slug> --from HEAD~1

# 7. Typecheck
bun run typecheck  # must pass all packages

# 8. Merge into main
git checkout main
git merge reconcile/v<version>
git push origin main

# 9. Update upstream lock
tpatch reconcile --update-lock
```

**Key rules:**

1. **Never merge upstream directly into main** — always use a reconciliation branch
2. **Never rebase main** — it's the stable production ref
3. **tpatch reconcile runs before branching** — verdicts guide re-application
4. **Apply features in dependency order** — roots first (copilot-cli-provider before dependents)
5. **One commit per feature** — enables clean `tpatch record --from HEAD~1`
6. **Tag before reconcile** — `pre-reconcile-v<version>` for safe rollback
7. **Main is always deployable** — if typecheck passes, it's good

### Current reconciliation target

```
upstream/main (b83e9c95, v0.0.23, 62 commits ahead)
         │
         └── reconcile/v0.0.23 ← create from upstream, re-apply features here
              │
              └── main (merge reconcile when ready)
```
