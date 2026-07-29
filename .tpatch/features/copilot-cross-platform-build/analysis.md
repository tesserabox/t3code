# Analysis: copilot-cross-platform-build

## Summary
Cross-platform desktop builds (e.g. building a Windows installer on macOS) fail to include the correct Copilot SDK native binary. The fix adds all platform-specific Copilot binaries as direct dependencies so the build script can select the correct one for the target platform.

## Compatibility
- Build-time only change; no runtime behavior change for end users.
- Affects `scripts/build-desktop-artifact.ts` — the desktop packaging pipeline.
- No impact on web or server builds.

## Risk: Low
- Worst case: build script regression producing broken installers (caught by CI/smoke test).
- No user-facing logic changes; purely infrastructure.
