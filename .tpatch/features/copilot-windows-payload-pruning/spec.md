# Specification: copilot-windows-payload-pruning

## Included behavior

1. Detect the staged Copilot SDK dependency.
2. Before pruning, require the target Windows and glibc-Linux x64/arm64
   Copilot executables, core CLI/runtime natives, search helpers, specialized
   clipboard bindings, and Koffi bindings.
3. Remove from both target Copilot platform packages:
   - generic `@teddyzhu/clipboard/clipboard.*.node` duplicates;
   - `pvrecorder`;
   - `webview`;
   - `foundry-local-sdk`.
4. Remove the Linux-musl Koffi directory while retaining the glibc binding.
5. Perform the pruning once before producing either the WSL runtime archive or
   Windows server ASAR.
6. Keep the upstream Windows unpacked-file limit at 80.

## Acceptance criteria

1. A fixture with the pinned package topology removes exactly 19 native files
   and retains every required SDK-server native and the computer-use plugin.
2. A tree without the Copilot SDK is unchanged.
3. A staged Copilot tree missing a required target native fails explicitly.
4. Existing desktop artifact tests pass.
5. Changed-file typecheck/lint passes.
6. A real Windows x64 build produces at most 80 loose payload files.
7. The packaged Windows and WSL Copilot runtimes start successfully.
8. Windows approval and SDK → native CLI → SDK persisted continuity pass.
9. No dependency versions or user-visible provider behavior change.

## Dependency

Hard parent: `copilot-cli-provider`.
