# Spec: desktop-managed-environments-connections

## Problem Statement

The Windows/WSL integration can discover desktop-managed local and WSL backend targets, but the Connections settings page no longer exposes those candidates to users. A Windows desktop user should be able to open Settings → Connections → Add environment and choose a detected WSL distro as a managed environment without manually copying a pairing URL or entering host/code details.

## UX Shape

The Add Environment dialog should expose three sibling modes:

1. `Pairing URL`
2. `Host + code`
3. `Managed environments`

`Managed environments` should list desktop-known candidates such as detected WSL distros. It should not be nested under `Pairing URL`. Already-added managed environments should remain visible but disabled with an `Added` state so the user can understand why the candidate cannot be added again.

## IPC Explanation

Electron runs the desktop app in at least two JavaScript contexts:

- The **main process** owns OS access: spawning backend processes, reading encrypted desktop persistence, opening native dialogs, and calling `wsl.exe`.
- The **renderer process** runs the React web UI. It should not receive unrestricted Node.js or Electron primitives.
- The **preload script** is the narrow bridge between them. It uses Electron `contextBridge.exposeInMainWorld` to publish a typed `window.desktopBridge` object to React.

IPC means **inter-process communication**. In this app, renderer code calls methods like `window.desktopBridge.getSavedEnvironmentRegistry()`. The preload method calls `ipcRenderer.invoke("desktop:get-saved-environment-registry")`. The main process registers a matching `ipcMain.handle(...)`, validates the payload, performs the trusted OS/backend work, and returns a serializable result.

Design constraints for this feature:

- Do not expose raw `ipcRenderer`, `ipcMain`, Node filesystem APIs, or process-spawning APIs to React.
- Treat every IPC payload from the renderer as `unknown` in the main process and validate it before use.
- Keep `apps/desktop/src/main.ts` surface area minimal. `main.ts` should compose a small managed-environment controller/adapter and register IPC handlers, not contain the full managed-backend runtime implementation inline.
- Put the managed environment runtime and handler registration behind a focused interface, for example a `DesktopManagedEnvironmentController` plus a `registerDesktopManagedEnvironmentIpc(...)` helper. Exact names may follow local style during implementation.

## Acceptance Criteria

1. `desktop-managed-environments-connections` declares a hard tpatch dependency on `windows-wsl-support`.
2. The Add Environment dialog in `ConnectionsSettings` has three sibling modes: `Pairing URL`, `Host + code`, and `Managed environments`.
3. In the desktop app, `Managed environments` lazily loads candidates from `window.desktopBridge.listManagedEnvironments()` when the dialog/mode is opened.
4. WSL candidates discovered by the parent WSL integration are displayed with stable labels and kind labels such as `WSL environment`; local candidates, if exposed, use `Local environment`.
5. Already-added desktop-managed environments are disabled and labeled `Added` based on persisted `management.environmentKey` metadata.
6. Adding a managed candidate calls `prepareManagedEnvironmentRegistration(environmentKey)`, receives a ready `httpBaseUrl`, `wsBaseUrl`, and bootstrap credential, saves the environment, persists its encrypted credential, and connects it through the existing saved-environment runtime.
7. Saved managed environment records persist a `management` block with `{ kind: "desktop-managed", environmentKey }` and retain it across browser/local desktop persistence, encrypted secret writes, registry writes, and hydration.
8. On desktop startup/hydration, saved desktop-managed environment records refresh their volatile loopback URLs by asking the managed environment controller to prepare the corresponding backend again.
9. Removing a saved desktop-managed environment stops its extra managed backend process when no saved record still references that `environmentKey`.
10. Browser-only usage remains unchanged: the `Managed environments` mode is hidden or replaced by a clear unavailable state when `window.desktopBridge` is absent.
11. The main-process change is minimal: `apps/desktop/src/main.ts` should delegate managed-environment runtime behavior and IPC handler registration to extracted module(s). The implementation should avoid reintroducing a large inline managed-backend runtime block into `main.ts`.
12. IPC methods validate unknown renderer inputs before use and never expose direct Node/Electron primitives to the renderer.
13. Existing manual remote pairing via pairing URL and host+code behaves exactly as before.
14. Validation commands before record include `bun fmt`, `bun lint`, `bun typecheck`, and focused tests for desktop persistence/runtime plus web Connections behavior.

## Out Of Scope

- Remote SSH environment discovery.
- New WSL installation or Node.js installation UI.
- Provider-specific WSL fixes beyond starting/reconnecting the managed backend.
- Changing the primary desktop environment away from local. WSL entries remain opt-in managed environments.
- A global environment preference picker outside Connections.

## Implementation Plan

### Phase 1: Contracts And Persistence

- Add shared contract types for `DesktopManagedEnvironmentCandidate`, `DesktopManagedEnvironmentRegistration`, and `PersistedSavedEnvironmentManagement`.
- Extend `DesktopBridge` with `listManagedEnvironments()` and `prepareManagedEnvironmentRegistration(environmentKey)`.
- Extend `PersistedSavedEnvironmentRecord` and web `SavedEnvironmentRecord` with optional `management` metadata.
- Preserve `management` in browser persistence and desktop encrypted persistence helpers.

### Phase 2: Desktop Managed Environment Adapter

- Extract a managed backend controller from the checkpoint behavior instead of placing it inline in `main.ts`.
- The controller should list candidates, lazily start a selected managed backend, provide loopback URLs and bootstrap token, hydrate persisted records, and stop unused managed backends.
- Add an IPC registration helper that binds the controller to the two desktop-managed channels with validation.
- Keep `main.ts` to dependency construction and one registration call where possible.

### Phase 3: Web Runtime Registration

- Restore a shared internal registration helper so manual pairings and desktop-managed pairings both fetch descriptors, bootstrap bearer sessions, persist records, persist encrypted credentials, and connect through the same saved-environment path.
- Add `addDesktopManagedEnvironment({ environmentKey, label? })` that calls the desktop bridge, then registers the returned target with `management.kind === "desktop-managed"`.
- Ensure desktop-managed saved environments create `KnownEnvironment` values with source `desktop-managed`.

### Phase 4: Connections UI

- Add `managed-environments` as a first-class Add Environment dialog mode alongside `pairing-url` and `host-code`.
- Lazy-load candidates only when the dialog is open and the managed mode is active.
- Render loading, empty, error, add, adding, and already-added states.
- Keep text compact and operational; this is a settings surface, not a landing page.

### Phase 5: Tests And Validation

- Add/restore desktop persistence tests that preserve `management` through registry writes and encrypted secret writes.
- Add/restore web runtime tests for `addDesktopManagedEnvironment` and duplicate detection.
- Add/restore Connections settings tests or browser coverage for the managed tab and already-added state.
- Run `bun fmt`, `bun lint`, `bun typecheck`, and focused package tests before `tpatch record`.
