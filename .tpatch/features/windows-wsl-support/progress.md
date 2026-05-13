# Progress: windows-wsl-support

## Status: Phase 1 — Windows-tested, partial

## Research Complete ✅

- Desktop spawning flow analyzed (main.ts lines 1371-1470)
- Upstream issues reviewed (#671 BackendTarget, #170 WSL interop, #716 UNC paths, #870 latency)
- VS Code remote architecture pattern validated
- Component analysis: what runs inside WSL vs Windows boundary
- Plan written at `.claude/plans/goofy-zooming-hollerith.md`

## Key Findings

- `startBackend()` spawns server via `ChildProcess.spawn(process.execPath, [backendEntry])`
- Desktop currently owns exactly one backend child and exposes exactly one local environment bootstrap through Electron IPC.
- Bootstrap config via fd 3 pipe (JSON) — doesn't work across wsl.exe, using CLI arg fallback
- Server entry: `apps/server/dist/bin.mjs`, CWD: `OS.homedir()`
- Terminal/PTY, git, fs, provider CLIs all need to run inside WSL for WSL projects
- WSL2 shares host network stack — localhost TCP works cross-boundary
- **Critical**: `wsl.exe --` passes args through default shell (zsh) which expands `$VAR`. Must use `--exec` to bypass.
- **Critical**: `wsl.exe --list --quiet` outputs UTF-16LE with null bytes, must decode properly.
- **Critical**: nvm-managed Node.js is not on default PATH in WSL; must source `$NVM_DIR/nvm.sh`
- All WSL helper commands should use `execFileSync` (not `execSync`) to avoid shell-string fragility.
- The web app, router, and client-runtime already scope thread/project refs by `environmentId`, so per-thread environment routing fits the existing model better than a single global backend choice.
- `BackendTarget` is currently a single-environment spawn/install primitive. Multi-environment support needs a higher-level backend manager or environment registry above it.
- Multiple concurrent WSL environments must not share the same `t3Home` / server `baseDir`; otherwise they collide on sqlite state, logs, and persisted `environmentId`.
- Draft reuse and new-thread routing must stay bound to the physical `projectRef` (`environmentId + projectId`), not just a logical repo grouping, once the same repo can exist in local and WSL environments.
- Add-project UX needs to follow the selected environment's path rules. Linux-targeted entry can accept pasted `\\wsl.localhost\...` UNC paths, but the visible placeholder should stay Linux-style.
- Copilot SDK runtime changes and the Windows-specific CLI resolver bug are tracked separately in `upgrade-github-copilot-sdk-to-0-3-0-adapt-the-copilot`; this feature keeps only the environment-management work.
- `bun run test` is not a safe default `test_command` on Windows right now because the unrelated `scripts/mock-update-server.test.ts` symlink case fails with `EPERM`.
- The failing symlink test comes from upstream commit `8dba2d64` (`Adopt Node-native TypeScript for desktop and server (#2098)`), which is present on both `main` and `origin/main`.

## Phase 0 — BackendTarget Abstraction

- [x] Extract `BackendTarget` interface from `startBackend()` in main.ts
- [x] Implement `LocalBackendTarget` wrapping existing logic
- [x] Verify no regression on existing local flow (typecheck passes)
- [x] Typecheck passes

## Phase 1 — WSL Server Spawning (MVP)

- [x] Implement `WslBackendTarget` with `wsl.exe` spawning
- [x] WSL distro detection (`wsl.exe --list --quiet`) — fixed UTF-16LE decoding
- [x] Implement CLI arg fallback for bootstrap config (`--bootstrap-json`)
- [x] Path translation at boundary (`wslpath` + manual fallback)
- [x] WSL path detection (`isWslPath`, `extractWslDistroFromPath`)
- [x] Node.js availability check inside WSL — fixed nvm/fnm support via `--exec`
- [x] Server installation check inside WSL
- [x] Server auto-install function (`installServerInWsl`) — code written, needs server build
- [x] WSL auto-detection wired into `createDefaultBackendTarget()`
- [x] WSL bundle staging + Linux-side dependency install wired into desktop startup
- [x] Focused desktop coverage added for WSL bundle staging, stale fingerprint reinstall, and npm-registry failure fast path
- [x] Added desktop-side managed environment scaffolding with isolated server base dirs for local and per-distro WSL targets
- [x] Desktop IPC exposes managed-environment listing and registration preparation for local and WSL targets
- [x] Saved environment persistence retains desktop-managed metadata and encrypted credentials
- [x] Server runtime/settings/keybindings/provider cache writes use unique temp paths so concurrent persistence does not collide
- [x] All WSL commands use `execFileSync` (no shell interpolation)
- [x] All WSL commands use `--exec` (bypass default shell variable expansion)
- [x] `bash -c` with positional args for safe JSON passing (no shell injection)
- [x] `bun typecheck`, `bun fmt`, `bun lint` pass (0 errors)
- [x] Real install path no longer appears hung when WSL npm is unreachable; it now fails fast with explicit logging
- [ ] Desktop settings: add backend target preference — future UI work
- [ ] Test: open WSL project, terminal works, git works — blocked by WSL npm registry connectivity on this machine
- [ ] Test: at least one provider (Copilot) works for WSL sessions — blocked by WSL npm registry connectivity on this machine

## Phase 2 — Dual-Server (separate feature if large)

- [ ] Backend manager for multiple environments / server instances
- [ ] Project and thread creation flow chooses `environmentId` instead of relying on one global backend target
- [ ] Project-to-target routing based on path prefix and explicit environment selection
- [ ] Define whether opening a WSL folder should reuse the current window or open a separate window; separate window is optional UX, not the core routing model
- [x] Give each managed server instance an isolated `baseDir` so local + WSL + multi-WSL can coexist safely
- [ ] Distro picker UI

## Test Command Assessment

- `tpatch test <slug>` reads the global `.tpatch/config.yaml` `test_command`.
- `bun run test` is too broad as the default command on Windows today because it fails in an unrelated scripts-package symlink test.
- The original feature-scoped scripts (`apps/desktop:test:wsl-support` and root `test:windows-wsl-support`) were removed during later reconciliation.
- `tpatch` is now configured to run `bun run --filter t3 build`, which exercises the server build wrapper used by `bun run dev:desktop`.
- On Windows, `tpatch test` still needs a POSIX `sh` on `PATH`; this checkout validates with `C:\Program Files\Git\usr\bin` prepended.
- Current manual validation also includes the desktop package tests via `bun run test` from `apps/desktop`.
- If we want a repo-wide default later, fix or gate the Windows symlink test first.

## tpatch Tracking

- [x] Record patch
- [x] Generate recipe: `node .tpatch/tools/generate-recipe.cjs windows-wsl-support <base> HEAD`
- [x] Verify patch scope (no pollution)
- [x] Update spec.md with implementation findings
- [x] Capture takeover workflow case study
- [x] Commit tpatch metadata
