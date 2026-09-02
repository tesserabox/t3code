# Analysis: desktop-managed-environments-connections

## Summary

The current branch has partial Windows/WSL managed environment support: desktop startup discovers WSL distros and `apps/desktop/src/main.ts` still registers IPC handlers named `desktop:list-managed-environments` and `desktop:prepare-managed-environment-registration`. That is not enough for the user-facing feature. The preload bridge, shared contracts, saved environment metadata, runtime registration helper, and Connections settings UI no longer expose or persist desktop-managed environment candidates.

This feature should restore the missing user-facing path as a dependent child of `windows-wsl-support`: detected local/WSL managed environments should appear as a first-class "Managed environments" mode in the Add Environment dialog, alongside "Pairing URL" and "Host + code". Selecting one should lazily prepare registration, start the managed backend if necessary, save it with desktop-managed metadata, and reconnect it like any other saved environment.

## Upstream / Current Compatibility

- Not already present in current `main`.
- The `windows-wsl-support` parent already provides the WSL discovery primitives (`listWslDistros`, `isNodeAvailableInWsl`, `WslBackendTarget`) and the desktop `BackendEnvironmentManager` scaffold.
- The current main-process IPC handlers are too thin: `prepareManagedEnvironmentRegistration` currently only calls `target.ensureReady()` and returns base metadata, not a ready loopback URL plus bootstrap token.
- The fuller local checkpoint `b8934046` contains the missing end-to-end behavior, but it should be ported carefully rather than copied wholesale because `apps/desktop/src/main.ts` and the web runtime have moved forward.

## Historical Source Of Truth

- `2454f489`, `e8845a12`, and `27bead0f` do not include the Connections UI for WSL candidates; they only include the auth policy string and/or desktop-side WSL scaffolding.
- Checkpoint `b8934046` includes the richer implementation:
  - shared contract types for desktop-managed candidates and registrations;
  - preload methods for list/prepare;
  - saved environment `management` metadata;
  - `addDesktopManagedEnvironment` in the web runtime;
  - Connections UI candidate list;
  - managed backend runtime in desktop main that starts/stops extra local/WSL backends and hydrates saved loopback URLs.

## Risks

- Reintroducing the checkpoint as a large `main.ts` block would make desktop startup harder to reason about. The implementation should extract the managed-backend runtime and IPC registration into focused modules, leaving `main.ts` as composition only.
- Managed environments use loopback ports and bootstrap tokens. Persisted records must refresh volatile URLs on hydration and keep encrypted credentials intact.
- WSL availability checks can be slow or fail due host configuration. Candidate listing should be lazy, cancellable from the UI perspective, and error-tolerant.
- Saved managed records must retain their `management.environmentKey`; otherwise the desktop app cannot restart the right WSL backend after app restart.

## Compatibility Decision

Compatible, provided the feature depends hard on `windows-wsl-support` and keeps the browser/manual remote pairing path unchanged. The change should be additive for desktop users and invisible for browser-only users.
