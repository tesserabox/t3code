# Case Study: v0.0.23 Upstream Reconciliation — Structural Middle-pass Data

**Study ID**: `t3code-upstream-v0.0.23-2026-05`
**Date**: 2026-05-13/14
**Upstream delta**: 62 commits (v0.0.21 lock → v0.0.23)
**Features**: 25 total, 14 re-applied, 1 upstreamed (pre-reconcile), 2 false-positive upstreamed, 2 true conflicts, 6 not yet implemented

**Revision**: Post-review correction on 2026-05-14. Two `upstreamed` verdicts were false positives caught by independent reviewers.

---

## Key Findings for Middle-pass Research

### 0. CRITICAL: `upstreamed` verdicts are unreliable (post-review finding)

Both features marked `upstreamed` by tpatch reconcile were **false positives**:

- **`session-search`**: No upstream session search exists — no keybinding, no component, no state in ChatView. The reconciler matched refactored component structure against recipe operations without verifying that the actual search functionality was present. **Trusting this verdict would have caused feature loss.**
- **`copilot-skill-controls`**: The recipe only contained a `try/catch` around skill discovery (error-handling scaffolding). That code exists because it was part of the monolithic CopilotAdapter brought by `copilot-cli-provider`. The feature's actual intent (enable/disable/reload RPC calls + toggle UI) was never implemented.

**Root cause**: tpatch's phase-2 operation-level matching checks whether recipe search strings exist in the upstream tree, but doesn't verify semantic equivalence. A recipe that searches for `try { await session.skills` will match any codebase containing that pattern — even if the pattern is from a different feature entirely.

**Impact**: 100% false positive rate on `upstreamed` verdicts (0/2 correct). This is the most dangerous class of error — it silently drops features.

### 1. Verdict accuracy: tpatch `blocked` is overly conservative

Of 15 features marked `blocked` by `tpatch reconcile`:

- **9 (60%)** reapplied cleanly — patches are entirely additive (new files, new array entries) with zero overlap against upstream changes
- **4 (27%)** needed minor relocation — insertion points shifted but the semantic content was unchanged
- **2 (13%)** were true conflicts — upstream restructured the desktop app heavily enough that our IPC/environment code needs a full rewrite

**Implication**: A structural middle-pass that can distinguish "additive patch vs overlapping patch" would eliminate ~87% of false `blocked` verdicts.

### 2. Additive patches dominate fork customization

The copilot provider feature is the largest (43 hunks, 18 files) but touches zero upstream files destructively. It adds:

- New files: CopilotDriver.ts, CopilotAdapter.ts, CopilotProvider.ts, etc.
- Array entries: builtInDrivers, PROVIDER_OPTIONS, RuntimeEventRawSource union
- Schema extensions: CopilotSettings, providers struct field

A middle-pass system that tracks "file is new" vs "file is modified" would correctly classify most copilot hunks as `applies-clean` without needing AST analysis.

### 3. Relocation patterns are consistent and predictable

The 4 features that needed relocation all followed the same pattern:

- **Type**: insertion-point shift (upstream added entries before/after our insertion point)
- **Fix**: find the equivalent anchor (e.g., the `ultrathink` block for effort-theming, the provider list for README) and insert after it
- **Difficulty**: trivial for a human, but requires semantic understanding of "equivalent anchor"

### 4. Upstream absorption is detectable at operation level

Both upstreamed features (`session-search`, `copilot-skill-controls`) were correctly detected by tpatch's phase-2 operation-level check — "all recipe operations already present in upstream." This is the one area where tpatch's current heuristics work well.

### 5. True conflicts correlate with upstream restructure scope

The 2 true conflicts (`desktop-managed-environments-connections`, `windows-wsl-support`) share a root cause: upstream restructured `apps/desktop/src/` from a flat layout to `app/`, `backend/`, `electron/` subdirectories. Our features added files and IPC channels to the old layout. This is a **structural conflict** detectable by path-prefix analysis without reading file contents.

## Adaptation Taxonomy

| Adaptation                                        | Count | Automatable?                     |
| ------------------------------------------------- | ----- | -------------------------------- |
| New API parameter (maintenanceCapabilities)       | 1     | Partially — needs type inference |
| Lint rule compliance (barrel → namespace imports) | 1     | Yes — mechanical transform       |
| Type union extension (add new literals)           | 1     | Yes — pattern matching           |
| Effect wrapper (plain → Effect.succeed)           | 1     | Partially — needs type context   |
| Insertion point relocation                        | 2     | Needs anchor matching            |
| Content rewrite (README format change)            | 1     | Needs semantic understanding     |

## Data Files

| File             | Records | Description                                         |
| ---------------- | ------- | --------------------------------------------------- |
| `study.json`     | 1       | Study metadata and parameters                       |
| `features.jsonl` | 25      | Per-feature outcomes with ground-truth labels       |
| `hunks.jsonl`    | 53      | Per-hunk metadata (path, header, line counts, hash) |
| `patches.jsonl`  | 4       | Per-commit patch summaries                          |
| `metrics.json`   | 1       | Aggregate metrics and verdict accuracy              |

## Recommendations for tpatch

1. **CRITICAL: Fix `upstreamed` false positives**: Operation-level matching must verify semantic equivalence, not just string presence. A recipe operation "search for X" should not match if X exists in a _different_ feature's code. Consider requiring that the matched code was _introduced by upstream_ (not by a sibling feature in the fork).
2. **Add `upstreamed` confidence scores**: When marking a feature as upstreamed, include which upstream commit introduced the matched operations and a confidence score. Low-confidence verdicts should be flagged for manual review.
3. **Never auto-retire on `upstreamed`**: The current workflow transitions `upstreamed` features to `upstream_merged` with the note "Feature adopted by upstream — local patch retired." This is dangerous when the verdict is wrong. Require explicit human confirmation before retiring.
4. **Add file-level novelty classification**: "new file" patches should auto-classify as `applies-clean`, not `blocked`
5. **Add hunk-level overlap detection**: only flag hunks whose context lines intersect with upstream diff hunks
6. **Improve `blocked` granularity**: distinguish "patch doesn't apply" (git error) from "patch context shifted" (relocation needed) from "patch target deleted" (true conflict)
7. **Track structural restructures**: detect when upstream moves files to new paths and flag dependent features early

## Reconciliation Process Improvements (lessons learned)

1. **Always verify `upstreamed` verdicts**: After tpatch reconcile, manually check every feature marked `upstreamed` by searching for the actual upstream implementation. Do not trust the verdict without evidence.
2. **Independent review catches what automation misses**: The two false positives were caught by reviewers who simply searched for the expected code. Build this into the reconcile checklist.
3. **Data drift check**: Ensure study.json, metrics.json, and features.jsonl agree on counts. The original data had inconsistent counts (2 vs 3 upstreamed) that went unnoticed until review.

---

## Post-Review Actions Log (2026-05-15)

### session-search re-applied

The false-positive `upstreamed` verdict was caught by independent reviewers. The feature was re-applied:

- `SessionSearchBar` component restored from pre-reconcile tag
- `chat.search` keybinding added to contracts + shared keybindings
- Search state, memo, and command handler added to ChatView.tsx
- tpatch status reverted to `applied`, patch re-recorded

### copilot-skill-controls implemented (was never actually implemented)

Reviewers noted the feature had only scaffolding code (skill discovery error handling), not the actual enable/disable/reload functionality. Rather than reverting to `requested`, we implemented the full feature:

- `ProviderAdapterShape`: added optional `setSkillEnabled` method
- `CopilotAdapter`: implemented `setSkillEnabled` calling `rpc.skills.enable()`/`disable()` on the SDK
- `ProviderRegistryShape` + `ProviderRegistryLive`: routing through adapter with error recovery
- WS RPC: new `server.setSkillEnabled` endpoint
- Contracts: `WsServerSetSkillEnabledRpc` schema
- tpatch status transitioned: `requested` → `implementing` → `applied`
- Note: Web UI toggle not yet built — server-side plumbing is complete

### Data corrections applied

- `features.jsonl`: ground_truth corrected for both false-positive features
- `metrics.json`: revised verdict accuracy to reflect 0/2 upstreamed correct
- `study.json`: aligned counts (14 applied → 15 applied with skill controls)

### Lessons for next reconciliation

1. Add "verify upstreamed" step to reconcile checklist before merging
2. Request independent review of all upstreamed/retired verdicts
3. Cross-check feature.jsonl counts against study.json before committing

---

## Postmortem: WS Connection Crash (2026-05-18)

### Incident

After the v0.0.23 reconciliation, ALL WebSocket connections failed. The UI showed no chat history, no filesystem browse results, and infinite WS reconnect loops. The server returned 500 on every WS upgrade.

### Root Cause (two compounding issues)

**Issue 1 (our bug): Missing `WsRpcGroup` registration**

- During the reconciliation, the `copilot-skill-controls` feature was implemented as a new feature (it had only scaffolding before). The implementation added `WsServerSetSkillEnabledRpc` to `packages/contracts/src/rpc.ts` but forgot to add it to the `WsRpcGroup.make(...)` call.
- Effect's `RpcServer.toHttpEffectWebsocket()` iterates the RpcGroup during WS setup. The handler in `ws.ts` referenced `WS_METHODS.serverSetSkillEnabled`, but the RpcGroup didn't include it. At `RpcGroup.js:64`, the iteration hit `undefined` and threw `TypeError: Cannot read properties of undefined (reading 'key')`.
- This crashed the **entire** WS setup, not just skill-related endpoints — it prevented ALL clients from connecting.

**Issue 2 (upstream regression): `VITE_HTTP_URL` removed from vite define**

- Upstream v0.0.23 removed `"import.meta.env.VITE_HTTP_URL": JSON.stringify(configuredHttpUrl ?? "")` from the vite.config.ts `define` block.
- The dev-runner still sets `VITE_HTTP_URL` as an env var. Vite auto-exposes `VITE_*` env vars, so `import.meta.env.VITE_HTTP_URL` became the actual backend URL (`"http://localhost:13773"`) instead of the previous empty string.
- Previously: empty string → client fell back to `window.location.origin` → API calls went through vite proxy → session cookies set on same-origin → cookies sent on WS connections to `:13773` (cookies are not port-scoped).
- Now: auto-exposed URL → `resolveConfiguredPrimaryTarget()` returned the backend URL → API calls bypassed the proxy → cookies scoped to `:5733` → not sent on cross-port WS.
- **This issue was masked by Issue 1** — the WS crashed before cookie auth could even be attempted.

### Timeline

1. Reconciliation completed with 13/13 typecheck ✅
2. User reported missing chats and empty filesystem browse
3. Initial investigation blamed stale auth tokens (wrong diagnosis)
4. Testing with `curl` revealed WS returning 500 (not 401)
5. Server trace showed `TypeError: Cannot read properties of undefined (reading 'key')` in `RpcGroup.js`
6. Fix: added `WsServerSetSkillEnabledRpc` to `WsRpcGroup` + restored `VITE_HTTP_URL` define
7. WS connections restored, all functionality working

### Why wasn't this caught?

1. **`bun run typecheck` doesn't catch RpcGroup completeness.** TypeScript verifies that the RPC definition is valid and the handler signature matches, but it can't verify that every handler in `ws.ts` has a corresponding RpcGroup entry. This is a runtime invariant that only fails when the WS setup runs.

2. **The feature was implemented during the reconciliation, not ported.** `copilot-skill-controls` had only error-handling scaffolding pre-reconcile (no RPC, no WS handler, no registry method). The full implementation was new code written during the review response — it was never tested in a running server before committing.

3. **No integration test for WS connectivity.** The reconciliation checklist verified typecheck (static) but not a running dev server (dynamic). A simple "can a WS connect?" smoke test would have caught this immediately.

4. **The vite.config.ts regression was invisible.** The upstream removal of `VITE_HTTP_URL` from the define block had no typecheck impact and no visible diff in target.ts. The behavioral change (auto-expose vs explicit define) is a Vite implementation detail that only manifests at runtime in dev mode.

### Should this have been a separate feature from the start?

**Yes.** The `copilot-skill-controls` feature mixed two concerns:

- **Server-side plumbing** (adapter method, registry routing, WS RPC handler, contracts schema) — infrastructure that affects ALL WebSocket connections
- **Copilot-specific skill toggle logic** — calling `rpc.skills.enable()/disable()` on the SDK

The WS RPC registration is infrastructure-level — a bug there blocks the entire application, not just skill toggling. It should have been:

- `copilot-skill-controls`: the adapter's `setSkillEnabled` method + skill state management (copilot-scoped, safe to fail)
- `copilot-skill-controls-ws-rpc`: the contracts RPC definition + WsRpcGroup registration + vite define fix (infrastructure-scoped, must not fail)

This is now the actual structure, with `copilot-skill-controls-ws-rpc` depending on `copilot-skill-controls`.

### Checklist additions for future reconciliations

1. **After implementing new features during reconciliation, start the dev server and verify WS connects** — add `bun run dev` + browser smoke test to the reconcile checklist
2. **Every RPC added to `WS_METHODS` must be added to `WsRpcGroup`** — add to the feature's acceptance criteria template
3. **Check vite.config.ts `define` block for removed env vars** — upstream may remove explicit defines that we depend on for dev mode behavior
4. **Separate infrastructure changes from feature-specific code** — a bug in a WS RPC registration shouldn't be scoped under a copilot feature
