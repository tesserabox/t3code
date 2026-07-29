# Reconciliation Impact Assessment — Multi-Provider (#2277) + 24 commits

**Date**: 2026-04-28
**Upstream range**: `main..upstream/main` (25 commits)
**Critical commit**: `08e6d4cf` — Multi-Provider support (#2277) — 205 files, 18K insertions

---

## Architecture Change Summary

The Multi-Provider PR replaces the closed `ProviderKind` literal union with an **open driver/instance** model:

| Old (v0.0.21) | New (upstream HEAD) |
|---------------|---------------------|
| `ProviderKind = Literals(["codex", "copilot", ...])` | `ProviderDriverKind` — open branded string, any value valid |
| `ModelSelection { provider: ProviderKind }` | `ModelSelection { instanceId: ProviderInstanceId }` |
| `Record<ProviderKind, ...>` with exhaustiveness | Open maps, no compile-time exhaustiveness |
| `Services/CopilotProvider.ts` (Effect Service tag) | `Drivers/CopilotDriver.ts` (new Driver pattern) |
| `RoutingTextGeneration.ts` (per-provider routing) | `TextGenerationLive.ts` (driver-based routing) |
| Hardcoded adapter layers in `server.ts` | `ProviderInstanceRegistryHydration.ts` (dynamic registration) |

### Key Deleted Files
- `apps/server/src/git/Layers/RoutingTextGeneration.ts` — our `CopilotTextGeneration` wiring is here
- `apps/server/src/provider/Services/ClaudeProvider.ts` — the Service tag pattern we followed
- `apps/server/src/provider/Services/CodexProvider.ts` — same

### Key New Files
- `apps/server/src/provider/Drivers/` — per-driver registration (need `CopilotDriver.ts`)
- `apps/server/src/provider/ProviderDriver.ts` — Driver interface
- `apps/server/src/git/Layers/TextGenerationLive.ts` — replaces RoutingTextGeneration
- `apps/server/src/provider/Layers/ProviderInstanceRegistryHydration.ts` — dynamic provider registration

---

## Per-Feature Impact Assessment

### Tier 1 — MUST re-adapt (directly affected by architecture change)

| Feature | Impact | Why | Action |
|---------|--------|-----|--------|
| **copilot-cli-provider** | 🔴 HIGH | `ProviderKind` gone, Service tags gone, server wiring changed. Need `CopilotDriver.ts` following new Driver pattern | Create Driver, update adapter service tag, register in instance registry |
| **copilot-text-generation** | 🔴 HIGH | `RoutingTextGeneration.ts` deleted, replaced by `TextGenerationLive.ts`. Our entire wiring is gone | Re-wire into new TextGenerationLive |
| **copilot-dynamic-models** | 🟡 MEDIUM | Model capabilities may feed through Driver now | Adapt to Driver's model registration pattern |
| **copilot-hide-internal-models** | 🟡 MEDIUM | Settings still per-driver, but provider snapshot path changed | Adapt filter to new snapshot builder |

### Tier 2 — Internal adapter changes (likely survive)

| Feature | Impact | Why |
|---------|--------|-----|
| **copilot-plan-compaction** | 🟢 LOW | Internal to CopilotAdapter.ts, no upstream changes to adapter |
| **copilot-turn-timing** | 🟢 LOW | Internal turnSentAt field |
| **copilot-skill-discovery** | 🟢 LOW | Internal skills store + event handler |
| **copilot-command-events** | 🟢 LOW | Internal switch cases |
| **copilot-resource-events** | 🟢 LOW | Internal image extraction |
| **copilot-skill-controls** | 🟢 LOW | Internal RPC calls |

### Tier 3 — Non-provider changes (likely clean)

| Feature | Impact | Why |
|---------|--------|-----|
| **effort-theming** | 🟢 LOW | CSS + composerProviderState detection |
| **readme-copilot-notice** | 🟢 LOW | README only |
| **copilot-cross-platform-build** | 🟢 LOW | Build script changes |
| **copilot-icon-and-build-fix** | 🟡 MEDIUM | providerIconUtils may have changed |
| **windows-wsl-support** | 🟢 LOW | Desktop-only, independent |
| **upgrade-copilot-sdk-0.3.0** | 🟢 LOW | Package version + CLI path resolution |

### Tier 4 — No code changes / not applicable

| Feature | State | Action |
|---------|-------|--------|
| toast-close-button | upstream_merged | None |
| background-tasks-ui | requested | None — not implemented |
| copilot-resource-rendering | requested | None — not implemented |
| custom-agents | requested | None — not implemented |
| **system-generated-turns** | **defined** | **None** — no code changes. Spec may need re-validation against new orchestration layer. Another agent can re-run define/explore later. |

---

## Feature Dependency DAG

Based on implementation dependencies (which features need others to exist):

```
copilot-cli-provider (root — everything depends on this)
├── copilot-dynamic-models (hard — modifies CopilotProvider created by parent)
├── copilot-plan-compaction (hard — modifies CopilotAdapter created by parent)
├── copilot-turn-timing (hard — modifies CopilotAdapter)
├── copilot-skill-discovery (hard — modifies CopilotAdapter + CopilotProvider)
├── copilot-hide-internal-models (hard — modifies CopilotSettings + CopilotProvider)
├── copilot-command-events (hard — modifies CopilotAdapter)
├── copilot-resource-events (hard — modifies CopilotAdapter)
├── copilot-skill-controls (hard — modifies CopilotAdapter)
├── copilot-text-generation (hard — needs CopilotDriver registered)
├── copilot-icon-and-build-fix (soft — icon + build, could exist independently)
└── copilot-cross-platform-build (soft — build script, independent)

effort-theming (standalone — CSS + composerProviderState, needs "copilot" as valid provider)
readme-copilot-notice (standalone — README only)
windows-wsl-support (standalone — desktop-only)
upgrade-copilot-sdk-0.3.0 (soft dep on copilot-cli-provider)
```

---

## Reconciliation Plan

### Step 0 — Preparation
```bash
# Verify tpatch v0.6.1+
tpatch --version

# Update skills
cp $TPATCH_SRC/skills/claude/tessera-patch/SKILL.md .claude/skills/tessera-patch/SKILL.md

# Register feature dependencies
tpatch feature deps copilot-dynamic-models add copilot-cli-provider:hard
tpatch feature deps copilot-plan-compaction add copilot-cli-provider:hard
tpatch feature deps copilot-turn-timing add copilot-cli-provider:hard
tpatch feature deps copilot-skill-discovery add copilot-cli-provider:hard
tpatch feature deps copilot-hide-internal-models add copilot-cli-provider:hard
tpatch feature deps copilot-command-events add copilot-cli-provider:hard
tpatch feature deps copilot-resource-events add copilot-cli-provider:hard
tpatch feature deps copilot-skill-controls add copilot-cli-provider:hard
tpatch feature deps copilot-text-generation add copilot-cli-provider:hard
tpatch feature deps copilot-icon-and-build-fix add copilot-cli-provider:soft
tpatch feature deps copilot-cross-platform-build add copilot-cli-provider:soft

# Update upstream.lock
# (will happen during reconcile)
```

### Step 1 — Fresh branch (Option A, proven approach)
```bash
git checkout -b reconcile/multi-provider upstream/main
git checkout main -- .tpatch/ .claude/
```

### Step 2 — Apply root feature first (copilot-cli-provider)
This is the big one. Needs:
1. Create `apps/server/src/provider/Drivers/CopilotDriver.ts` following the new Driver pattern
2. Read existing drivers (ClaudeDriver.ts, CodexDriver.ts) as templates
3. Update `CopilotAdapter` service tag to match new pattern
4. Copy adapter files (CopilotAdapter.ts, CopilotProvider.ts, utils)
5. Register in ProviderInstanceRegistryHydration
6. Add `CopilotSettings` to settings schema
7. Typecheck

### Step 3 — Apply Tier 2 features (internal adapter changes)
These should apply cleanly by copying files from main:
- copilot-plan-compaction, turn-timing, skill-discovery, command-events, resource-events, skill-controls
All are internal modifications to CopilotAdapter.ts which is our file.

### Step 4 — Apply Tier 1 adapted features
- copilot-text-generation → wire into new `TextGenerationLive.ts`
- copilot-dynamic-models → adapt to Driver's model registration
- copilot-hide-internal-models → adapt settings filter

### Step 5 — Apply standalone features
- effort-theming, readme-copilot-notice, windows-wsl-support, icon-and-build-fix, cross-platform-build, sdk-upgrade

### Step 6 — Typecheck + record
```bash
bun run typecheck  # must be 10/10 (or 11 if new packages)
# For each feature:
tpatch record <slug> --from <base>
node .tpatch/tools/generate-recipe.cjs <slug> <base> HEAD -- <scoped-files>
```

### Step 7 — Merge into main
```bash
git checkout main
git merge reconcile/multi-provider
git push origin main
```

---

## Estimated Effort

| Phase | Effort | Notes |
|-------|--------|-------|
| Step 0 (prep + deps) | 15 min | Mechanical, run commands |
| Step 1 (fresh branch) | 5 min | Git operations |
| Step 2 (copilot-cli-provider) | 2-3 hours | CopilotDriver.ts, registry wiring, settings — the big one |
| Step 3 (Tier 2, 6 features) | 30 min | Copy files, verify |
| Step 4 (Tier 1 adapted, 3 features) | 1-2 hours | Text generation rewire, model adaptation |
| Step 5 (standalone, 5 features) | 30 min | Copy files, minor fixes |
| Step 6 (typecheck + record) | 30 min | Mechanical |
| **Total** | **5-7 hours** | Full session |

---

## Key Risk: ProviderDriverKind is OPEN

This is actually **good for us**. Since `ProviderDriverKind` is an open branded string (not a closed union), `"copilot"` is automatically valid without modifying any enum. No more "add copilot to every Record<ProviderKind>" dance.

The main adaptation work is structural — creating the `CopilotDriver.ts` and wiring it into the new registration system. The web components should auto-detect any registered driver instance.

## Key File to Study First

Read `apps/server/src/provider/Drivers/ClaudeDriver.ts` on `upstream/main` — it's the template for how our `CopilotDriver.ts` should be structured. It replaces the old Service tag + Provider layer + adapter wiring pattern with a single unified Driver registration.
