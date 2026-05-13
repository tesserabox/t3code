# Spec: windows-wsl-support

## Acceptance Criteria

1. T3 Code launches and runs on native Windows (no WSL required for Windows-side projects).
2. Projects inside WSL distros can be opened and edited from the Windows host.
3. WSL distros are auto-detected via `wsl.exe --list`.
4. A separate server process is spawned inside WSL for Linux-side projects.
5. Path translation between Windows (`C:\...`) and WSL (`/mnt/c/...`) paths works transparently via `wslpath`.
6. Server binary is auto-installed inside WSL on first use.
7. File watching uses native `inotify` inside WSL (not polling).
8. The desktop app can list additional desktop-managed environments and prepare registration metadata for local and WSL targets.
9. Managed local and WSL environments persist saved-environment metadata, encrypted credentials, runtime state, settings, keybindings, and provider cache files without clobbering each other.
10. On Windows, `bun run dev:desktop` builds the server even when Node is installed under `C:\Program Files`.

## Out of Scope

- Linux desktop (non-WSL) GUI support.
- Remote SSH server support.
- Windows ARM64 (initial release).

## Plan

1. Add Windows platform detection and native server support.
2. Implement WSL distro discovery (`wsl.exe --list --quiet`).
3. Build WSL server spawning via `wsl.exe -d <distro> -- <server-binary>`.
4. Implement `wslpath` translation layer for cross-boundary path resolution.
5. Add auto-install flow for server binary inside WSL distros.
6. Add desktop-managed environment registration, persistence, and reconnect flows.
7. Harden multi-environment persistence so isolated base directories and atomic writes protect runtime files.
8. Set up Windows CI pipeline for smoke testing.

## Files Touched (reconciliation reference)

| File                                     | What it does                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/backendTarget.ts`      | BackendTarget interface + LocalBackendTarget                                                              |
| `apps/desktop/src/wslBackendTarget.ts`   | WslBackendTarget + distro detection + path translation                                                    |
| `apps/desktop/src/backendEnvironment.ts` | BackendEnvironmentManager + WSL auto-discovery                                                            |
| `apps/desktop/src/wslServerBundle.ts`    | Server bundle preparation for WSL targets                                                                 |
| `apps/desktop/src/main.ts`               | IPC channels (list-managed-environments, prepare-managed-environment-registration) + BackendTarget wiring |
| `apps/server/src/cli.ts`                 | --bootstrap-json flag (WSL fd 3 workaround)                                                               |
| `apps/server/scripts/cli.ts`             | Server package build wrapper for desktop dev                                                              |
| `apps/server/src/cli-config.test.ts`     | bootstrapJson in test fixtures                                                                            |

## Reconciliation Checklist

On every upstream sync, verify:

```bash
ls apps/desktop/src/backendTarget.ts apps/desktop/src/wslBackendTarget.ts apps/desktop/src/backendEnvironment.ts apps/desktop/src/wslServerBundle.ts
grep "LIST_MANAGED_ENVIRONMENTS\|PREPARE_MANAGED_ENVIRONMENT" apps/desktop/src/main.ts
grep "bootstrapJson\|bootstrap-json" apps/server/src/cli.ts
bun run --filter t3 build
```
