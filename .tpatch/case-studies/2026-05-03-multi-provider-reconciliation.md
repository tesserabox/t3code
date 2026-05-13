# Case Study: Multi-Provider Reconciliation (v0.0.22)

**Date**: 2026-05-03
**Duration**: ~2 hours (analysis + implementation)
**Upstream**: 32 commits including Multi-Provider (#2277), GitLab (#2462), Declarative Settings (#2452)
**Result**: 16 features reconciled, 10/10 typecheck, merged into main

---

## Feature-by-File Scope Matrix

### Core Provider (copilot-cli-provider) — ROOT

| File | Action | Notes |
|------|--------|-------|
| `apps/server/src/provider/Drivers/CopilotDriver.ts` | **NEW** | Created following ClaudeDriver pattern |
| `apps/server/src/provider/Layers/CopilotAdapter.ts` | Copied + adapted | makeCopilotAdapter export, ProviderDriverKind |
| `apps/server/src/provider/Layers/CopilotProvider.ts` | Copied + adapted | ServerProviderDraft return, presentation field |
| `apps/server/src/provider/Layers/copilotCliPath.ts` | Copied as-is | Binary resolution (Windows improvements included) |
| `apps/server/src/provider/Layers/copilotTurnTracking.ts` | Copied as-is | Turn state machine |
| `apps/server/src/provider/Layers/copilotMcpServers.ts` | Copied as-is | MCP config loader |
| `apps/server/src/provider/Services/CopilotAdapter.ts` | Adapted | Shape-only (no Context.Service tag) |
| `apps/server/src/provider/Services/CopilotProvider.ts` | Copied | Service tag for Provider |
| `apps/server/src/provider/builtInDrivers.ts` | Modified | Added CopilotDriver to BUILT_IN_DRIVERS |
| `packages/contracts/src/settings.ts` | Modified | CopilotSettings with makeProviderSettingsSchema |
| `packages/contracts/src/model.ts` | Modified | DEFAULT_MODEL_BY_PROVIDER, aliases, display names |
| `packages/contracts/src/providerRuntime.ts` | Modified | copilot.sdk.* in RuntimeEventRawSource |
| `apps/web/src/session-logic.ts` | Modified | PROVIDER_OPTIONS copilot entry |
| `apps/web/src/components/settings/providerDriverMeta.ts` | Modified | DRIVER_OPTIONS copilot entry with GithubCopilotIcon |
| `apps/server/package.json` | Modified | @github/copilot-sdk dependency |

### Adapter-Internal Features (modify CopilotAdapter.ts only)

| Feature | What it adds to CopilotAdapter.ts | Lines approx |
|---------|-----------------------------------|-------------|
| copilot-plan-compaction | Compaction event handlers (start/complete/truncation), exit_plan_mode.requested → turn.proposed.completed | ~50 lines |
| copilot-turn-timing | turnSentAt field, timestamped turn.started events | ~25 lines |
| copilot-skill-discovery | mergeDiscoveredSkills, getCopilotDiscoveredSkills, session.skills_loaded handler, rpc.skills.list fallback | ~60 lines |
| copilot-command-events | system.notification, system.message, command.execute/completed/queued handlers | ~80 lines |
| copilot-resource-events | Image/audio/resource extraction from tool.execution_complete contents | ~35 lines |
| copilot-skill-controls | CopilotSkillsRpc interface, rpc.skills.reload on session start | ~20 lines |

### Other Features

| Feature | Files | Notes |
|---------|-------|-------|
| copilot-dynamic-models | `CopilotProvider.ts` | buildCapabilitiesFromSdkModel → optionDescriptors |
| copilot-hide-internal-models | `settings.ts` (hideInternalModels), `CopilotProvider.ts` (filter) | Settings toggle |
| copilot-text-generation | `textGeneration/CopilotTextGeneration.ts` | NEW file, wired in CopilotDriver |
| copilot-icon-and-build-fix | `providerDriverMeta.ts` (GithubCopilotIcon), `build-desktop-artifact.ts` | Icon + asar |
| copilot-cross-platform-build | `build-desktop-artifact.ts` | npm force-install for cross-platform |
| effort-theming | `index.css` (xhigh CSS), `composerProviderState.tsx` (detection) | Standalone |
| readme-copilot-notice | `README.md` | CAUTION block |
| windows-wsl-support | `backendTarget.ts`, `wslBackendTarget.ts`, `main.ts`, `cli.ts` | BackendTarget + WSL + --bootstrap-json |
| upgrade-copilot-sdk | `package.json` | SDK v0.3.0 |

---

## Metadata Status

| Feature | analysis | spec | explore | recipe | patch | Docs complete? |
|---------|:--------:|:----:|:-------:|:------:|:-----:|:-----------:|
| copilot-cli-provider | ✅ 49L | ✅ 103L | ✅ 39L | ✅ | ✅ | ✅ |
| copilot-dynamic-models | ✅ 47L | ✅ 97L | ✅ 41L | ✅ | ✅ | ✅ |
| copilot-plan-compaction | ✅ 12L | ✅ 18L | ✅ 10L | ✅ | ✅ | ✅ |
| copilot-turn-timing | ✅ 11L | ✅ 15L | ✅ 10L | ✅ | ✅ | ✅ |
| copilot-skill-discovery | ✅ 12L | ✅ 18L | ✅ 11L | ✅ | ✅ | ✅ |
| copilot-hide-internal-models | ✅ 9L | ✅ 18L | ✅ 12L | ✅ | ✅ | ✅ |
| copilot-cross-platform-build | ✅ 13L | ✅ 17L | ✅ 9L | ✅ | ✅ | ✅ |
| copilot-command-events | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| copilot-resource-events | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| copilot-skill-controls | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| copilot-text-generation | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| copilot-icon-and-build-fix | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| effort-theming | ✅ 12L | ✅ 16L | ✅ 11L | ✅ | ✅ | ✅ |
| readme-copilot-notice | ✅ 14L | ✅ 19L | ✅ 13L | ✅ | ✅ | ✅ |
| windows-wsl-support | ✅ 19L | ✅ 30L | ✅ 27L | ✅ | ✅ | ✅ |
| upgrade-copilot-sdk | ✅ 20L | ✅ 25L | ✅ 28L | ✅ | ✅ | ✅ |

**11/16 features have complete docs. 5 features missing analysis/spec/exploration.**

---

## Reconciliation Process Summary

### What Worked
1. **Fresh branch approach** — proven again. Created `reconcile/multi-provider` from `upstream/main`, applied features clean
2. **Sub-agent delegation** — two agents handled the mechanical wiring work
3. **One-commit-per-group** — code in 2 commits (core + standalone), metadata in 1
4. **Driver pattern was clean** — `CopilotDriver.ts` following `ClaudeDriver.ts` was straightforward
5. **Open ProviderDriverKind** — no more "add to every Record" dance

### What Was Painful
1. **Merge conflicts** on main — old v0.0.21 code conflicted with reconciliation branch. Had to take the reconcile branch's entire tree
2. **Stale files** — old `RoutingTextGeneration.ts` survived the merge and caused type errors
3. **Cross-pollution in patches** — all features share the same 170KB patch (expected, documented)

### Key Architecture Difference

| Aspect | v0.0.21 (previous reconciliation) | v0.0.22 (this one) |
|--------|----------------------------------|-------------------|
| Provider registration | Closed `ProviderKind` union, exhaustive Records | Open `ProviderDriverKind`, Partial Records |
| Adding a new provider | Modify 15+ files with exhaustive map entries | Create 1 Driver file + register in builtInDrivers |
| Adapter wiring | Hardcoded Layer.provide in server.ts | Dynamic via ProviderInstanceRegistry |
| Text generation | Separate routing layer per provider | Bundled in Driver's textGeneration field |
| Difficulty | ~45 min with sub-agents | ~30 min with sub-agents — EASIER |

### Lesson
**The multi-provider architecture is genuinely fork-friendly.** The open `ProviderDriverKind` type and Driver pattern mean future upstream changes are less likely to break our integration. We no longer need to modify upstream's type definitions — just register our Driver.
