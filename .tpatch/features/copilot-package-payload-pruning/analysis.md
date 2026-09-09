# Analysis: copilot-package-payload-pruning

## Problem

A real Windows x64 build produced 97 loose files, exceeding the authoritative
upstream 80-file installation/update budget. The build correctly failed before
artifact promotion.

The Copilot SDK adds 32 unpacked native/executable files to a 65-file baseline.
Nineteen x64 files are unreachable from T3's `copilot-cli` SDK server mode:

- 12 generic clipboard bindings duplicated by retained target-specific
  clipboard packages;
- 1 Linux-musl Koffi binding while supported WSL validation uses glibc;
- 6 voice, webview, and Foundry Local natives used by interactive CLI
  facilities rather than T3's SDK server path.

Pruning them yields 78 loose x64 files without raising the budget. Arm64 also
contains non-target x64 search tools, which can be removed while preserving
target tools.

## Compatibility

- Pruning is conditional on a staged Copilot SDK and exact reviewed Copilot
  runtime `1.0.75`.
- Builds without the fork provider remain unchanged.
- Required target Windows and glibc-Linux executables, runtime natives, search
  helpers, specialized clipboard bindings, and Koffi bindings are checked
  before pruning.
- Windows computer-use executables remain.
- One staged tree feeds `server.asar` and `wsl-runtime.tar.gz`; pruning cannot
  drift between them.
- The Linux-only WSL archive separately excludes all retained Windows Copilot
  and Koffi packages.

## Recommendation

Prune immediately after the hoisted production install and before WSL archive
or ASAR creation. Keep the 80-file limit unchanged and require a real Windows
packaged-runtime rerun.
