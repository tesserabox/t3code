# Specification: copilot-package-payload-pruning

## Included behavior

1. Detect the staged Copilot SDK dependency.
2. Require reviewed Copilot runtime version `1.0.75`.
3. Before pruning, require target Windows and glibc-Linux Copilot executables,
   core CLI/runtime natives, search tools, specialized clipboard bindings, and
   Koffi bindings.
4. Remove generic embedded clipboard binding duplicates, interactive-only
   `pvrecorder`, `webview`, and `foundry-local-sdk` directories, Linux-musl
   Koffi, and non-target search-tool directories.
5. Exclude Windows Copilot and Koffi packages from the Linux-only WSL archive.
6. Fail explicitly on unsupported runtime versions or layout drift.
7. Keep the authoritative upstream unpacked-file limit at 80.

## Acceptance criteria

1. X64 fixtures remove exactly 19 loose native/executable files.
2. Arm64 fixtures remove the reviewed 20 loose native/executable files and
   non-target extensionless search tools.
3. All required target files and Windows computer-use executables remain.
4. Stages without Copilot are unchanged.
5. Missing required target files, unsupported versions, or layout drift fail.
6. Artifact tests, script typecheck, and changed-file lint pass.
7. A real pruned Linux x64 payload loads the specialized clipboard fallback and
   starts Copilot `1.0.75`, protocol 3.
8. A real Windows x64 build emits at most 80 loose files.
9. Packaged Windows/WSL startup, Copilot approval, and SDK/CLI continuity pass.

## Dependency

Hard parent: `copilot-cli-provider`.
