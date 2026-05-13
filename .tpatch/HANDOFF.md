# T3 Code Fork — Session Handoff

**Read these files in order:**
1. `.claude/instructions.md` — technical context, dev setup, gotchas
2. `.tpatch/KNOWLEDGE_TRANSFER.md` — expert context, lessons learned, upstream API changes
3. `.tpatch/BRANCHING_STRATEGY.md` — how we manage main, upstream, and reconciliation branches
4. `.tpatch/tools/WORKFLOW.md` — tpatch Path B workflow + recipe generation script

## What this is
A fork of `pingdotgg/t3code` at `github.com/tesseracode/t3code`. We added GitHub Copilot as a provider using `@github/copilot-sdk`, plus WSL support, UI theming, and other improvements.

## Branch layout
- **`main`** — our production fork (upstream v0.0.21 + all features). Build and deploy from here.
- **`upstream/main`** — read-only upstream tracking. Never push to it.
- Feature branches branch from `main` for new work.
- Reconciliation branches (`reconcile/v<version>`) are created from `upstream/main` for upstream syncs.

## Current state
- **15 applied features**, 1 upstream_merged, 3 requested
- **10/10 typecheck** ✅
- **Full Copilot provider parity** with other providers (Codex, Claude, Cursor, OpenCode)

Run `tpatch status` for the full feature list.

## How we work
Use **tpatch Path B** (agent-as-provider). The LLM implement phase produces garbage — always author changes yourself:
```bash
tpatch add --slug <name> "description"
tpatch apply <slug> --mode started
# Make changes, typecheck
tpatch apply <slug> --mode done
git commit
tpatch record <slug> --from <parent>
node .tpatch/tools/generate-recipe.cjs <slug> <parent> HEAD
```

## Dev setup
```bash
nvm use 23
export PATH="./node_modules/.bin:$PATH"
bun install && bun run dev
```

## Upstream sync workflow
See `.tpatch/BRANCHING_STRATEGY.md` for the full procedure:
```bash
git fetch upstream
git checkout -b reconcile/v<new> upstream/main
git checkout main -- .tpatch/ .claude/
# Re-apply features against new upstream
# Typecheck, commit, merge into main
```
