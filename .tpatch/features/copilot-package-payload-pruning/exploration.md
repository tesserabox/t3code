# Exploration: copilot-package-payload-pruning

## Windows evidence

- Focused Windows tests: 181 passed, one capability-based skip.
- Linux x64 node-pty prebuild: passed.
- Generated installer: about 1.03 GB before rejection.
- Payload validator: 97 files, limit 80.
- No packaged runtime or integrated UI gate ran after rejection.

## Exact pinned package topology

The published `1.0.75` target tarballs contain:

- Windows x64 Copilot: 17 native/executable files.
- Linux x64 Copilot: 12 native files.
- Target Windows/Linux Koffi: 3 native files.

Generic clipboard loaders fall back to retained platform-specific packages.
SDK and app entrypoints use existence-checked optional loaders for
`pvrecorder`, `webview`, and `foundry-local-sdk`; T3's server-mode adapter does
not invoke those interactive facilities.

Arm64 packages also contain non-target x64 `rg`/`tgrep`; Linux arm64 omits
`pvrecorder`. Both layouts are covered independently.

## Integration

`stageWindowsServerSidecar` installs the hoisted dependency tree, then stages
node-pty, creates the WSL archive, and packs the ASAR. The pruning hook belongs
between install and those three steps.

## Validation

- Artifact unit tests cover x64, arm64, no-Copilot, and required-file failure.
- A real pruned Linux x64 payload in `node:24-bookworm-slim` loaded the retained
  specialized clipboard binding and started runtime `1.0.75`, protocol 3.

## Patch paths

- `scripts/build-desktop-artifact.ts`
- `scripts/build-desktop-artifact.test.ts`
- `docs/operations/release.md`
