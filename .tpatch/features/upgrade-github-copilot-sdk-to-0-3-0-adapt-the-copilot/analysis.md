# Analysis: upgrade-github-copilot-sdk-to-0-3-0-adapt-the-copilot

## Summary

Upgrade `@github/copilot-sdk` from `0.2.2` to `0.3.0`, adapt the server-side Copilot provider to the SDK's newer runtime approval protocol, and fix Windows-local startup under Bun/Electron by resolving the real platform binary instead of the JavaScript loader. The upgrade also needs matching cross-platform desktop artifact staging so packaged builds pull the same Copilot CLI version as the upgraded SDK.

## Compatibility

- Depends on the existing `copilot-cli-provider` feature for the base provider integration.
- Touches the runtime contract between `CopilotAdapter` and the SDK because the public typings still lag the runtime approval protocol.
- Affects all platforms for permission handling and provider health checks.
- Adds a Windows-specific resolver fix because Electron-local startup plus Bun's package layout can otherwise respawn the JS loader under `process.execPath`.
- Must stay compatible with the existing `copilot-cross-platform-build` feature so staged platform packages match the upgraded SDK's nested `@github/copilot` version.

## Risk: Medium-High

- SDK typings and runtime behavior are out of sync, so the adapter must use a local structural bridge without losing safety.
- Provider status checks should preserve real startup errors; swallowing them hides genuine install/auth/binary problems.
- Windows Bun/Electron resolution is easy to get wrong because Bun resolves through `dist/cjs/index.js` and an internal shim `package.json`.
- Cross-platform build staging can silently drift if the staged platform package version does not match the upgraded SDK dependency tree.
