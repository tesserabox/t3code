# Exploration: copilot-cross-platform-build

## Key Files
- `scripts/build-desktop-artifact.ts` — main build script; binary resolution logic lives here.

## Observations
- The original script assumes the host OS matches the target OS when locating the Copilot binary.
- Platform-specific npm packages (e.g. `@anthropic/copilot-sdk-darwin-arm64`) are optional deps; only the host's package is installed by default.
- Fix involves explicitly installing all platform variants and selecting by target platform flag passed to the build script.
