# T3 Code Fork — Agent Instructions

## What this is
A fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — a multi-provider coding assistant (Codex, Claude, Cursor, OpenCode). We added **GitHub Copilot** as a provider using `@github/copilot-sdk`, plus WSL support, UI theming, and other improvements.

## Branches
- **`main`** — our production fork (upstream v0.0.21 + all features). Build and deploy from here.
- **`upstream/main`** — read-only upstream tracking ref. Never push to it.
- See `.tpatch/BRANCHING_STRATEGY.md` for upstream sync and reconciliation workflow.

## tpatch — fork patch management
This repo uses `tpatch` to track fork-specific features as replayable patches. Key commands:

```bash
tpatch status                          # see all features and their state
tpatch add --slug <slug> "description" # register a new feature
tpatch apply <slug> --mode started     # snapshot before edits
tpatch apply <slug> --mode done        # capture diff after edits
tpatch record <slug> --from <ref>      # save patch (use --from main for full diff)
tpatch reconcile --upstream-ref upstream/main  # check features against new upstream
```

**Important**: tpatch's LLM-driven `implement` phase produces low-quality recipes. Always use **Path B** — `--mode started`, make changes manually/with agent, then `--mode done` + `record`. The agent acts as the "tpatch provider" for conflict resolution and feature implementation.

### Recipe management
After implementing changes, rebuild recipes from git diffs to ensure they're deterministically replayable:
- Recipes use `write-file` for new files and `replace-in-file` for modifications
- `search` strings must match the **upstream** (pre-change) file content
- Validate with `tpatch apply <slug> --mode execute --dry-run` on a clean upstream tree
- Record patches with `tpatch record <slug> --from <base-ref>` — look for "Patch validated: applies cleanly"

## Active features (all `applied`)
| Feature | What it does |
|---------|-------------|
| `copilot-cli-provider` | Full Copilot provider — SDK adapter, services, registry wiring, UI, Electron build fixes |
| `copilot-dynamic-models` | Runtime model capabilities from SDK's `listModels()` instead of static list |
| `effort-theming` | Animated teal border when GPT xhigh effort is selected |

## Upstream sync workflow
```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
# Restore .tpatch from feature branch (do NOT pop stash with source files):
git checkout feature/copilot-provider -- .tpatch/
# Run reconcile on CLEAN upstream tree (no source changes):
tpatch reconcile --upstream-ref upstream/main
# If "reapplied": act as provider to merge changes onto new upstream
# If "blocked": reconcile report tells you which files conflict
```

**Critical**: Do NOT `git stash pop` source changes before reconcile. Reconcile needs a clean tree to produce accurate diagnostics. Only restore `.tpatch/` metadata first.

## Dev setup
```bash
nvm use 24              # Node 24+ for native .ts support
export PATH="./node_modules/.bin:$PATH"
bun install
bun run dev             # starts server + web
bun run typecheck       # verify all 9 packages
```

## Key files for Copilot provider

### Server
- `apps/server/src/provider/Services/CopilotAdapter.ts` — service tag
- `apps/server/src/provider/Services/CopilotProvider.ts` — service tag
- `apps/server/src/provider/Layers/CopilotAdapter.ts` — full SDK adapter (~1757 lines)
- `apps/server/src/provider/Layers/CopilotProvider.ts` — detection + model listing
- `apps/server/src/provider/Layers/copilotCliPath.ts` — binary resolution for Electron
- `apps/server/src/provider/Layers/copilotTurnTracking.ts` — turn ID state machine
- `apps/server/src/provider/Layers/copilotMcpServers.ts` — MCP config loader

### Contracts
- `packages/contracts/src/orchestration.ts` — `ProviderKind`, `CopilotModelSelection`
- `packages/contracts/src/model.ts` — `CopilotModelOptions`, defaults, aliases, display names
- `packages/contracts/src/settings.ts` — `CopilotSettings`, `CopilotSettingsPatch`

### Web
- `apps/web/src/session-logic.ts` — `PROVIDER_OPTIONS` (UI picker list)
- `apps/web/src/composerDraftStore.ts` — `normalizeProviderKind()`, `normalizeProviderModelOptions()`
- `apps/web/src/components/chat/TraitsPicker.tsx` — `getRawEffort()`, `getEffortKey()`
- `apps/web/src/components/chat/composerProviderRegistry.tsx` — provider state + theming

## Known patterns / gotchas

### TypeScript
- Every `Record<ProviderKind, ...>` must include `copilot` or TS will error at compile time
- Constructing `ModelSelection` from a dynamic `provider: ProviderKind` requires `as ModelSelection` cast (discriminated union narrowing limitation)

### Runtime
- `normalizeProviderKind()` in `composerDraftStore.ts` is a runtime gate — missing providers silently fail (clicks do nothing)
- `TraitsPicker.tsx` `getRawEffort()` and `getEffortKey()` need copilot cases for effort selection to work
- Copilot uses `reasoningEffort` (same key as Codex), not `effort` (Claude's key)

### Electron / Production builds
- `scripts/build-desktop-artifact.ts` must NOT use `--omit optional` (copilot binary is optional dep)
- `asarUnpack` must include `node_modules/@github/copilot-*/**` so binary is executable
- `CopilotProvider.ts` must use `resolveBundledCopilotCliPath()` (not raw `binaryPath`) for Electron
- On first desktop launch, provider status may fail before `syncShellEnvironment()` hydrates PATH — restart fixes it

### Architecture
- Copilot follows the same Effect-TS Service/Layer pattern as all providers
- Claude and Copilot both use SDK npm packages that wrap CLI binaries
- Codex and OpenCode spawn CLI binaries directly over JSON-RPC
- Cursor uses ACP protocol via `@t3tools/effect-acp`
