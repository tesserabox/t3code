# Exploration: desktop-managed-environments-connections

## Current Files And Symbols

### Desktop WSL Discovery

- `apps/desktop/src/backendEnvironment.ts`
  - `ManagedBackendEnvironment`
  - `BackendEnvironmentManager`
  - `createDefaultBackendEnvironmentManager(...)`
  - Current code discovers WSL environments on Windows via `listWslDistros()` and `isNodeAvailableInWsl(...)` and creates keys like `wsl:<distro>`.

- `apps/desktop/src/wslBackendTarget.ts`
  - `listWslDistros()` decodes `wsl.exe --list --quiet` UTF-16LE output.
  - `WslBackendTarget` is the parent-feature primitive for spawning inside WSL.

- `apps/desktop/src/wslServerBundle.ts`
  - `prepareWslServerBundle(...)` stages the server bundle under `%USERPROFILE%\.t3\wsl-server-bundles` for WSL targets.

### Desktop IPC / Main Process

- `apps/desktop/src/main.ts`
  - Current channels exist: `LIST_MANAGED_ENVIRONMENTS_CHANNEL` and `PREPARE_MANAGED_ENVIRONMENT_REGISTRATION_CHANNEL`.
  - Current `listManagedBackendEnvironments()` filters out the primary local environment.
  - Current prepare handler only calls `environment.target.ensureReady()` and returns `{ key, displayLabel, kind, ready, baseDir }`; it does not start an extra backend or return connection URLs/token.
  - Implementation should avoid expanding this file with a large runtime block. Extract to a focused module.

- `apps/desktop/src/preload.ts`
  - Current `window.desktopBridge` does not expose managed environment methods. Add them here once contracts are restored.

- `apps/desktop/src/clientPersistence.ts`
  - Current persisted saved environment validation and writes do not preserve a `management` block. This must be restored for desktop-managed records.

### Shared Contracts / Runtime

- `packages/contracts/src/ipc.ts`
  - `DesktopBridge` currently lacks `listManagedEnvironments` and `prepareManagedEnvironmentRegistration`.
  - `PersistedSavedEnvironmentRecord` currently lacks `management` metadata.

- `apps/web/src/environments/runtime/catalog.ts`
  - `SavedEnvironmentRecord` currently lacks `management` metadata.
  - `toPersistedSavedEnvironmentRecord(...)` should include `management` when present.

- `apps/web/src/environments/runtime/service.ts`
  - Current `addSavedEnvironment(...)` directly handles manual pairing only.
  - Restore a shared `registerSavedEnvironment(...)` helper so manual and managed add flows do not duplicate descriptor/bootstrap/persist/connect logic.
  - Add `addDesktopManagedEnvironment(...)` and export it from `apps/web/src/environments/runtime/index.ts`.

### Connections UI

- `apps/web/src/components/settings/ConnectionsSettings.tsx`
  - Current Add Environment dialog modes are `pairing-url` and `host-code`.
  - Current saved environment list is one combined `Remote environments` section.
  - Restore managed candidate state and add a third sibling mode rather than nesting managed candidates below pairing URL.
  - Relevant existing helpers: `SavedBackendListRow`, `getSavedBackendStatusTooltip(...)`, `handleAddSavedBackend`, `handleReconnectSavedBackend`, and `handleRemoveSavedBackend`.

## Historical Reference Commit

Checkpoint `b8934046` contains the fuller behavior to port carefully:

- `packages/contracts/src/ipc.ts`
  - `PersistedDesktopManagedEnvironmentMetadata`
  - `PersistedSavedEnvironmentManagement`
  - `DesktopManagedEnvironmentCandidate`
  - `DesktopManagedEnvironmentRegistration`
  - bridge methods for list/prepare

- `apps/desktop/src/preload.ts`
  - `listManagedEnvironments`
  - `prepareManagedEnvironmentRegistration`

- `apps/desktop/src/main.ts`
  - managed backend runtime map
  - lazy managed backend start/stop
  - registry hydration refreshing loopback URLs
  - stop removed managed backends

- `apps/web/src/environments/runtime/service.ts`
  - `registerSavedEnvironment(...)`
  - `addDesktopManagedEnvironment(...)`
  - known environment source set to `desktop-managed`

- `apps/web/src/components/settings/ConnectionsSettings.tsx`
  - managed candidates and already-added logic
  - managed saved environment grouping

## Proposed Minimal Changeset

1. Add contract types and bridge methods in `packages/contracts/src/ipc.ts`.
2. Add preload methods in `apps/desktop/src/preload.ts`.
3. Add `management` preservation in:
   - `apps/desktop/src/clientPersistence.ts`
   - `apps/web/src/clientPersistenceStorage.ts`
   - `apps/web/src/environments/runtime/catalog.ts`
4. Extract desktop managed runtime into a new desktop module, likely under `apps/desktop/src/managedBackendEnvironment.ts` or similar.
5. Add a small IPC registration helper, likely under `apps/desktop/src/managedBackendEnvironmentIpc.ts` or similar.
6. Replace current inline managed-environment handlers in `apps/desktop/src/main.ts` with controller construction and IPC registration.
7. Add `addDesktopManagedEnvironment(...)` to web runtime and export it.
8. Update `ConnectionsSettings` dialog mode state to include `managed-environments` and render the candidate list as a sibling mode.

## Test Targets

- `apps/desktop/src/clientPersistence.test.ts`
  - preserve `management` on registry read/write and encrypted secret write/remove.

- New or existing desktop tests near managed backend environment modules
  - candidate listing excludes the primary environment;
  - preparing an unknown key fails;
  - removing a managed saved record stops only that backend when no other record references the key.

- `apps/web/src/environments/runtime/service.addSavedEnvironment.test.ts`
  - `addDesktopManagedEnvironment` calls bridge prepare, persists management metadata, saves bearer token, and connects.
  - duplicates are rejected consistently.

- `apps/web/src/components/settings/SettingsPanels.browser.tsx` or focused Connections coverage
  - Add Environment dialog has three sibling modes.
  - Managed candidates load from desktop bridge and show Added for existing `management.environmentKey`.

## Validation Commands

```bash
bun fmt
bun lint
bun typecheck
bun --cwd apps/desktop run test
bun --cwd apps/web run test -- ConnectionsSettings
bun --cwd apps/web run test -- service.addSavedEnvironment
tpatch feature deps --validate-all
tpatch status --dag
```

Per repo instructions, use `bun run test` rather than `bun test` when invoking package scripts that route to Vitest. Focused direct package scripts may need adjustment during implementation based on actual `package.json` scripts.
