# Analysis: copilot-windows-payload-pruning

## Problem

A real Windows x64 build of the Phase 1 source produced 97 loose files in the
unpacked application, exceeding the upstream 80-file installation/update
budget. The build correctly failed before artifact promotion.

The pre-Copilot Windows payload accounts for 65 files. The pinned Copilot SDK
adds 32 unpacked natives:

- 29 from the Windows x64 and Linux x64 Copilot platform packages;
- 3 from Windows x64 and Linux x64 Koffi packages.

Seventeen of those files are unreachable from T3's `copilot-cli` SDK server
mode:

- 12 generic clipboard bindings duplicated by the retained platform-specific
  clipboard packages;
- 1 Linux-musl Koffi binding while the supported WSL runtime is glibc;
- 6 native bindings for CLI-interactive voice, webview, and Foundry Local
  facilities that T3 does not invoke in SDK server mode.

Removing those 19 loose natives leaves 78 files, preserving the upstream
80-file budget without raising it. The Windows-only computer-use plugin,
Windows/glibc-Linux Copilot executables, core runtime natives, search helpers,
specialized clipboard bindings, and Koffi bindings remain.

## Compatibility

- The pruning is conditional on the Copilot SDK being present in the staged
  server tree; upstream builds without the fork provider remain unchanged.
- The same staged tree feeds `server.asar` and `wsl-runtime.tar.gz`, so one
  pruning step keeps both payloads coherent.
- The pinned SDK/CLI versions remain unchanged.
- Runtime probes must still prove packaged Copilot startup, approval, and
  SDK/CLI session continuity on Windows.

## Recommendation

Prune and validate the staged Copilot SDK server payload immediately after the
production dependency install and before WSL archive/ASAR creation. Keep the
80-file limit as the regression guard.
