# Spec: copilot-cross-platform-build

## Acceptance Criteria
1. Building a Windows desktop artifact on a macOS host includes the correct `copilot.exe` binary.
2. Building a macOS desktop artifact on a Linux host includes the correct `copilot` binary.
3. All platform Copilot SDK binaries are declared as direct dependencies in the relevant package.
4. The build script resolves the correct binary based on the **target** platform, not the host.
5. Existing single-platform (host === target) builds continue to work unchanged.

## Out of Scope
- Copilot SDK version upgrades.
- ARM vs x64 binary selection (unless already supported by SDK packaging).

## Plan
1. Add all platform-specific Copilot SDK packages as dependencies.
2. Modify `scripts/build-desktop-artifact.ts` to resolve binary path by target platform arg.
3. Validate with cross-platform CI matrix.
