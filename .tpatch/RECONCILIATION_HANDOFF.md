# Reconciliation Handoff: Multi-Provider Architecture (v0.0.22)

**Read `.tpatch/KNOWLEDGE_TRANSFER.md` first, then this file.**

## What Changed in Upstream

32 new commits. The critical one: **`08e6d4cf` — Multi-Provider support (#2277)**. This replaces the entire provider registration architecture:

### Old vs New Architecture

| Concept | Old (our main) | New (upstream) |
|---------|---------------|----------------|
| Provider ID type | `ProviderKind` (closed literal union) | `ProviderDriverKind` (open branded string — ANY value valid) |
| Model selection key | `provider: ProviderKind` | `instanceId: ProviderInstanceId` |
| Adapter registration | Service tags + Layer.provide in server.ts | `ProviderDriver.create()` via `ProviderInstanceRegistry` |
| Text generation | `RoutingTextGeneration.ts` (per-provider routing) | `TextGenerationLive.ts` (driver-based) |
| Settings UI | `PROVIDER_SETTINGS` array | `DRIVER_OPTIONS` from `providerDriverMeta.ts` |
| Provider Service tag | `Services/CopilotProvider.ts` (Context.Service) | **GONE** — Drivers bundle everything |

### What This Means for Copilot

**Good news**: `ProviderDriverKind` is OPEN — `"copilot"` is automatically valid. No more adding to every `Record<ProviderKind, ...>`.

**Main task**: Create `apps/server/src/provider/Drivers/CopilotDriver.ts` following the new Driver pattern. Study `ClaudeDriver.ts` as the template.

## Reconciliation Steps

### Step 0 — Create fresh branch
```bash
git checkout -b reconcile/multi-provider upstream/main
git checkout main -- .tpatch/ .claude/
bun install
```

### Step 1 — copilot-cli-provider (THE ROOT — do first)

Create `CopilotDriver.ts` by studying `ClaudeDriver.ts`:
- A Driver has: `driverKind`, `create(config) -> ProviderInstance`
- `ProviderInstance` bundles: adapter, snapshot, textGeneration
- Register in `BUILT_IN_DRIVERS` array in `ProviderInstanceRegistryHydration.ts`

Copy these files from main (they are our files, unchanged by upstream):
```bash
git checkout main -- \
  apps/server/src/provider/Layers/CopilotAdapter.ts \
  apps/server/src/provider/Layers/CopilotProvider.ts \
  apps/server/src/provider/Layers/copilotCliPath.ts \
  apps/server/src/provider/Layers/copilotTurnTracking.ts \
  apps/server/src/provider/Layers/copilotMcpServers.ts
```

Then adapt:
- `CopilotAdapter` service tag to shape-only (like `ClaudeAdapterShape`)
- `CopilotProvider` to feed into Driver snapshot
- Wire text generation into Driver `textGeneration` field

Add to contracts:
- `CopilotSettings` in `settings.ts` using `makeProviderSettingsSchema()` with form annotations
- Add copilot to `DEFAULT_MODEL_BY_PROVIDER`, `MODEL_SLUG_ALIASES_BY_PROVIDER`, `PROVIDER_DISPLAY_NAMES` (all `Partial<Record<ProviderDriverKind, ...>>` now)
- Add copilot entry to `providerDriverMeta.ts` `DRIVER_OPTIONS`
- Add copilot to `PROVIDER_OPTIONS` in `session-logic.ts`

### Step 2 — Copy adapter-internal features (should work as-is)
All modifications to CopilotAdapter.ts (our file):
- copilot-plan-compaction, copilot-turn-timing, copilot-skill-discovery
- copilot-command-events, copilot-resource-events, copilot-skill-controls

### Step 3 — copilot-text-generation
Wire into new `TextGenerationLive.ts`. The Driver `textGeneration` field handles this.

### Step 4 — Standalone features
- effort-theming: add xhigh CSS + detection in `composerProviderState.tsx`
- readme-copilot-notice: update README
- copilot-icon-and-build-fix: add to `providerDriverMeta.ts` + build script
- copilot-cross-platform-build: build script asarUnpack + npm force
- windows-wsl-support: copy desktop files + --bootstrap-json in cli.ts
- upgrade-copilot-sdk: package.json version

### Step 5 — Commit strategy
**One commit per feature, record after each, tpatch metadata at the end.**
See `.tpatch/steering/local.md`.

### Step 6 — Merge into main
```bash
git checkout main && git merge reconcile/multi-provider
git push origin main
```

## Key Files to Study on upstream/main

| File | What to learn |
|------|---------------|
| `apps/server/src/provider/Drivers/ClaudeDriver.ts` | **THE TEMPLATE** for CopilotDriver |
| `apps/server/src/provider/ProviderDriver.ts` | Driver interface definition |
| `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts` | Where BUILT_IN_DRIVERS are registered |
| `apps/server/src/git/Layers/TextGenerationLive.ts` | New text generation routing |
| `apps/web/src/components/settings/providerDriverMeta.ts` | Declarative UI metadata per driver |
| `packages/contracts/src/providerInstance.ts` | ProviderDriverKind + ProviderInstanceId |
| `packages/contracts/src/settings.ts` | `makeProviderSettingsSchema()` with form annotations |

## Feature Dependencies (already registered)

Run `tpatch status --dag` to see. Root: `copilot-cli-provider`. Apply root first, then dependents.

## Features to SKIP (no code changes)

- `system-generated-turns` (defined, no code)
- `toast-close-button` (upstream_merged)
- `background-tasks-ui`, `copilot-resource-rendering`, `custom-agents` (requested)
