# Reconciliation Impact Report — Upstream v0.0.21 (27 commits)

**Date**: 2026-04-26
**Upstream range**: `origin/main~27..origin/main`
**Our branch**: `feature/copilot-provider` (51 commits, 18 features)

## Critical Upstream Changes

### 1. `8d1d699f` — Refactor provider model selections to option arrays (#2246)

**THE killer change.** The entire per-provider model options system was replaced:

- `CodexModelOptions`, `ClaudeModelOptions`, `CopilotModelOptions` → **GONE**
- `CodexReasoningEffort`, `ClaudeAgentEffort` → **GONE**
- `ModelCapabilities` with per-provider `reasoningEffortLevels` → replaced with generic `ProviderOptionDescriptor` arrays
- `ProviderModelOptions` struct → replaced with `ProviderOptionSelections` (array of `{id, value}`)
- Every `Record<ProviderKind, ...>` for model defaults, aliases, display names may be restructured
- `composerDraftStore.ts` `normalizeProviderKind` and `normalizeProviderModelOptions` → rewritten
- `TraitsPicker.tsx` `getRawEffort`, `getEffortKey` → replaced with generic descriptor-based UI

### 2. `66c326b8` — Redesign model picker with favorites and search (#2153)

- `ProviderModelPicker` → rewritten with search and favorites
- `session-logic.ts` `PROVIDER_OPTIONS` → restructured (added `pickerSidebarBadge`)
- `modelSelection.ts` → restructured

### 3. `3a1daa87` — Add close buttons to toasts (#2023)

- **Our `toast-close-button` feature is upstreamed!** Toast component rewritten with corner dismiss orbs, expandable content, and description triggers.

### 4. `e25db3a5` — Fix provider cache atomic write temp path collisions (#2291)

- The Windows agent also fixed this independently — may be fully upstreamed.

## Per-Feature Impact Assessment

| Feature                          | Impact    | Verdict                 | Details                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **copilot-cli-provider**         | 🔴 HIGH   | needs-full-readaptation | ProviderKind must be re-added. Settings schema restructured. Model options rewritten to generic descriptors. All `Record<ProviderKind>` maps need copilot entries. Web components (composerDraftStore, TraitsPicker, SettingsPanels, modelSelection) completely rewritten. |
| **copilot-dynamic-models**       | 🔴 HIGH   | needs-rewrite           | `ModelCapabilities` replaced with `ProviderOptionDescriptor`. `buildCapabilitiesFromSdkModel()` must map to new descriptor format. `reasoningEffortLevels` → `optionDescriptors`.                                                                                          |
| **copilot-plan-compaction**      | 🟡 MEDIUM | needs-adaptation        | Adapter code survives. Permission types changed (`PermissionRequestResult` kinds). Plan mode check against new option descriptors.                                                                                                                                         |
| **copilot-turn-timing**          | 🟢 LOW    | likely-clean            | Internal adapter change (`turnSentAt`). No upstream conflicts expected.                                                                                                                                                                                                    |
| **copilot-skill-discovery**      | 🟢 LOW    | likely-clean            | Internal adapter + provider. Module-level `discoveredCopilotSkills` store is independent.                                                                                                                                                                                  |
| **copilot-hide-internal-models** | 🟡 MEDIUM | needs-adaptation        | `CopilotSettings` must be re-added to new settings schema. Toggle UI in SettingsPanels needs new structure.                                                                                                                                                                |
| **copilot-cross-platform-build** | 🟢 LOW    | likely-clean            | Build script changes are independent. SDK version bumped to 0.3.0 by Windows agent.                                                                                                                                                                                        |
| **copilot-command-events**       | 🟢 LOW    | likely-clean            | Internal adapter switch cases only.                                                                                                                                                                                                                                        |
| **copilot-resource-events**      | 🟢 LOW    | likely-clean            | Internal adapter switch cases only.                                                                                                                                                                                                                                        |
| **copilot-skill-controls**       | 🟢 LOW    | likely-clean            | Internal adapter RPC calls only.                                                                                                                                                                                                                                           |
| **effort-theming**               | 🟡 MEDIUM | needs-adaptation        | `composerProviderRegistry.tsx` → now `composerProviderState.ts`. xhigh detection logic must use new descriptor system. CSS should survive.                                                                                                                                 |
| **readme-copilot-notice**        | 🟢 LOW    | likely-clean            | README-only change.                                                                                                                                                                                                                                                        |
| **toast-close-button**           | 🟢 N/A    | **UPSTREAMED**          | PR #2023 merged upstream. **Drop this feature.**                                                                                                                                                                                                                           |
| **windows-wsl-support**          | 🟢 LOW    | likely-clean            | Desktop-only changes. `backendTarget.ts`, `wslBackendTarget.ts` are new files.                                                                                                                                                                                             |
| **upgrade-copilot-sdk-0.3.0**    | 🟡 MEDIUM | needs-review            | SDK type changes may interact with new options system. Permission types restructured.                                                                                                                                                                                      |
| **custom-agents**                | N/A       | requested               | Not yet implemented.                                                                                                                                                                                                                                                       |
| **copilot-resource-rendering**   | N/A       | requested               | Not yet implemented.                                                                                                                                                                                                                                                       |
| **background-tasks-ui**          | N/A       | requested               | Not yet implemented.                                                                                                                                                                                                                                                       |

## Reconciliation Strategy

### Phase 1 — Triage

```bash
tpatch reconcile --upstream-ref upstream/main
```

This will give us the formal verdicts. Based on this analysis, expect:

- ~7 features `reapplied` (clean or 3-way)
- ~5 features `3WayConflicts` or `blocked`
- ~1 feature `upstreamed` (toast-close-button)

### Phase 2 — Drop upstreamed features

```bash
tpatch remove toast-close-button --force
```

### Phase 3 — Re-apply clean features first

Features likely to apply cleanly (internal adapter changes):

- copilot-turn-timing
- copilot-skill-discovery
- copilot-command-events
- copilot-resource-events
- copilot-skill-controls
- copilot-cross-platform-build
- readme-copilot-notice
- windows-wsl-support

### Phase 4 — Re-adapt broken features

Features needing manual re-implementation against new upstream:

1. **copilot-cli-provider** — the big one. Re-add `"copilot"` to ProviderKind, CopilotSettings, model descriptors, all web components
2. **copilot-dynamic-models** — rewrite `buildCapabilitiesFromSdkModel` to produce `ProviderOptionDescriptor[]`
3. **copilot-plan-compaction** — adapt permission types
4. **copilot-hide-internal-models** — re-add settings + UI toggle
5. **effort-theming** — adapt to new descriptor-based traits system

### Estimated effort

- Phase 1-2: 30 minutes
- Phase 3: 1-2 hours (verify, record)
- Phase 4: 4-8 hours (re-implement against new schemas)

## Key Files to Read Before Reconciliation

| File                                                    | Why                                               |
| ------------------------------------------------------- | ------------------------------------------------- |
| `packages/contracts/src/model.ts`                       | New `ProviderOptionDescriptor` system             |
| `packages/contracts/src/orchestration.ts`               | ProviderKind enum (need to add copilot)           |
| `packages/contracts/src/settings.ts`                    | New settings structure (copilot section missing)  |
| `packages/shared/src/model.ts`                          | New model resolution utilities                    |
| `apps/web/src/composerDraftStore.ts`                    | Rewritten model options handling                  |
| `apps/web/src/components/chat/TraitsPicker.tsx`         | Generic descriptor-based UI                       |
| `apps/web/src/components/chat/composerProviderState.ts` | Replaced composerProviderRegistry                 |
| `apps/web/src/components/ui/toast.tsx`                  | Upstream's toast close button (compare with ours) |
