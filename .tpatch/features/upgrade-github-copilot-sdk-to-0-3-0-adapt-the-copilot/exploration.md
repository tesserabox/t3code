# Exploration: upgrade-github-copilot-sdk-to-0-3-0-adapt-the-copilot

## Relevant Files

1. `apps/server/package.json`
   The feature's dependency entry point. The upgrade to `@github/copilot-sdk` `^0.3.0` starts here and drives the lockfile update.

2. `apps/server/src/provider/Layers/CopilotAdapter.ts`
   The adapter owns the runtime permission workflow. The SDK's runtime approval protocol changed ahead of its exported typings, so this file needs a local structural bridge and approval mapping logic.

3. `apps/server/src/provider/Layers/CopilotProvider.ts`
   The provider health check creates the SDK client, starts it, and reports readiness. This is where startup errors need to stay intact instead of collapsing into a generic failure string.

4. `apps/server/src/provider/Layers/copilotCliPath.ts`
   Auto-detection for the bundled Copilot CLI. Bun/Electron on Windows needs the real platform binary instead of the JavaScript loader.

5. `scripts/build-desktop-artifact.ts`
   Cross-platform desktop packaging already stages Copilot platform binaries. The staged package version must match the upgraded SDK's nested CLI version.

6. `apps/server/src/provider/Layers/CopilotAdapter.test.ts`, `apps/server/src/provider/Layers/CopilotProvider.test.ts`, and `apps/server/src/provider/Layers/copilotCliPath.test.ts`
   Focused regression coverage for the upgrade-specific behaviors: permission protocol bridging, health-check error reporting, and Windows binary resolution.

## Key Findings

- The runtime approval protocol is cross-platform. It affects any host that runs `@github/copilot-sdk` `0.3.0`, not only Windows.
- The Windows startup failure is more specific: when the SDK is handed `npm-loader.js`, Electron-local desktop runs can respawn that loader under `process.execPath`, which is Electron instead of standalone Node.
- Bun's package resolution is part of the Windows bug. `@github/copilot-sdk` resolves through `dist/cjs/index.js`, and the nearest `package.json` can be an internal shim rather than the real package root.
- The cross-platform build script still has to track the nested Copilot CLI version explicitly. With the SDK at `0.3.0`, the staged platform package version needs to move from `^1.0.34` to `^1.0.36`.
