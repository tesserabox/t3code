# Exploration: copilot-windows-payload-pruning

## Failure evidence

The corrected Windows rerun produced:

- 181 focused tests passed and one capability-based skip;
- Linux x64 `node-pty` prebuild passed;
- an unpacked Windows payload with 97 files;
- `WindowsPackagedPayloadValidationError` with limit 80.

No packaged runtime or integrated UI gate ran after that failure.

## Package topology

The exact pinned platform tarballs contain:

- `@github/copilot-win32-x64@1.0.75`: 17 native/executable files;
- `@github/copilot-linux-x64@1.0.75`: 12 native files;
- target Koffi packages: 3 native files.

The generic clipboard package embeds six platform bindings inside each Copilot
platform package even though a target-specific clipboard package is also
present. The Linux Koffi package contains both glibc and musl bindings. The
Copilot SDK entrypoint uses existence-checked optional loaders for
`pvrecorder`, `webview`, and `foundry-local-sdk`; T3's server-mode adapter does
not invoke those interactive facilities.

## Integration point

`stageWindowsServerSidecar` installs one hoisted server dependency tree, then:

1. stages Linux `node-pty`;
2. builds `wsl-runtime.tar.gz`;
3. packs `server.asar`.

Pruning between install and node-pty staging modifies the common source tree
once and therefore applies identically to both emitted runtime forms.

## Affected paths

- `scripts/build-desktop-artifact.ts`
- `scripts/build-desktop-artifact.test.ts`
- `docs/operations/release.md`
- tpatch metadata for this feature
