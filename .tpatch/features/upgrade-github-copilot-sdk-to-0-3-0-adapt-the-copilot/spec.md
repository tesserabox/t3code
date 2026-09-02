# Spec: upgrade-github-copilot-sdk-to-0-3-0-adapt-the-copilot

## Acceptance Criteria

1. `apps/server/package.json`, the workspace lockfile, and related package metadata reflect `@github/copilot-sdk` `^0.3.0`.
2. `CopilotAdapter` can translate the SDK's runtime permission requests into the newer approval result protocol, including session-wide approvals where the runtime supports them.
3. `CopilotProvider` preserves the underlying SDK startup error message when the provider health check fails.
4. On Windows-local desktop runs under Bun/Electron, Copilot CLI auto-detection resolves the real platform binary (`copilot.exe`) ahead of `npm-loader.js`.
5. Cross-platform desktop artifact staging installs Copilot platform packages at the same CLI version as the upgraded SDK dependency tree.
6. Regression tests cover the approval protocol bridge, provider error reporting, and Windows CLI path resolution.

## Out of Scope

- WSL environment management and desktop-managed environment UX.
- New Copilot provider features unrelated to the `0.3.0` upgrade.
- Reworking the entire Copilot build pipeline to infer versions dynamically from the lockfile.

## Plan

1. Upgrade the server dependency and lockfile to `@github/copilot-sdk` `^0.3.0`.
2. Keep a local structural bridge in `CopilotAdapter` for the SDK approval protocol until upstream typings catch up.
3. Preserve raw SDK startup errors in `CopilotProvider` health checks.
4. Resolve the real bundled Copilot platform binary under Bun/Electron, especially on Windows.
5. Align staged platform package installation with the upgraded Copilot CLI version.
6. Add focused regression coverage around the upgrade-specific behavior.
