# tpatch Workflow Guide — Proven Patterns from This Repo

## The Path B Workflow (Agent-Driven)

This is the workflow we've used successfully across 13+ features. It bypasses the LLM implement phase (which produces low-quality recipes) and uses the agent as the provider.

### Quick Reference

```bash
# 1. Register the feature
tpatch add --slug <slug> "description"

# 2. Optional: advance through phases with --manual
#    (create analysis.md, spec.md, exploration.md first)
tpatch analyze <slug> --manual
tpatch define <slug> --manual
tpatch explore <slug> --manual

# 3. Start implementing
tpatch apply <slug> --mode started

# 4. Make code changes, typecheck, test
bun run typecheck

# 5. Finish implementation
tpatch apply <slug> --mode done

# 6. Commit the code changes
git add <changed files>
git commit -m "feat: description"

# 7. Record the patch
tpatch record <slug> --from <parent-commit>

# 8. Generate the recipe
node .tpatch/tools/generate-recipe.cjs <slug> <parent-commit> HEAD

# 9. Verify the patch is clean (no cross-feature pollution)
grep "^diff --git" .tpatch/features/<slug>/artifacts/post-apply.patch

# 10. Commit tpatch metadata
git add .tpatch/
git commit -m "chore: record <slug>"

# 11. Push
git push origin feature/copilot-provider
```

### Recipe Generation Script

Located at `.tpatch/tools/generate-recipe.cjs`. Usage:

```bash
# Basic: generate from a commit range
node .tpatch/tools/generate-recipe.cjs <slug> <from-ref> <to-ref>

# Scoped: only include specific files
node .tpatch/tools/generate-recipe.cjs <slug> HEAD~1 HEAD -- apps/server/src/file.ts
```

The script:
1. Parses `git diff` hunks into `replace-in-file` operations
2. Creates `write-file` operations for new files
3. Validates every `search` string exists in the base ref
4. Writes to `.tpatch/features/<slug>/artifacts/apply-recipe.json`

### Common Gotchas

1. **Cross-feature pollution**: When features share files, `tpatch record --from <base>` captures ALL changes since base, not just your feature. Use scoped file paths: `git diff <base>..HEAD -- file1.ts > post-apply.patch`

2. **`type` not `op`**: The recipe schema uses `"type": "replace-in-file"`, not `"op"`. The v0.4.3 skill incorrectly documented `"op"` (fixed in v0.5.1).

3. **bun skips cross-platform deps**: Optional dependencies with `"os"` restrictions are skipped by bun on non-matching hosts. Use `npm install --force` for cross-compilation.

4. **Amending metadata commits**: When you amend the tpatch metadata commit, you need `--force-with-lease` to push.

5. **FEATURES.md stale**: `FEATURES.md` doesn't auto-update on `apply --mode done` or `record`. It catches up on the next tpatch command that regenerates it.

## Multi-Session Features

For large features that span multiple sessions:

### Progress Tracking

Create a `progress.md` file in the feature directory:

```bash
echo "# Progress: <slug>
## Session 1 (date)
- [ ] Phase 0: BackendTarget interface
- [ ] Phase 1: WSL spawning
- [ ] Phase 2: Dual-server
" > .tpatch/features/<slug>/progress.md
```

Update checkboxes as you complete each phase. This file persists across sessions and is committed with tpatch metadata.

### Handoff Between Sessions

1. Commit all code changes before ending a session
2. Update `progress.md` with current state
3. Record with tpatch so the patch/recipe are current
4. Push to remote

New session reads `.tpatch/HANDOFF.md` and `.claude/instructions.md` for context, then checks `progress.md` for the specific feature.
