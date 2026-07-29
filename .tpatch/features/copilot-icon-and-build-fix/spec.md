# Spec: copilot-icon-and-build-fix

## Acceptance Criteria

### Icon (TWO locations — both required on every reconciliation)

1. **Settings UI**: `providerDriverMeta.ts` must have `GithubCopilotIcon` in the copilot `DRIVER_OPTIONS` entry
   - File: `apps/web/src/components/settings/providerDriverMeta.ts`
   - Key: `icon: GithubCopilotIcon`

2. **Chat UI / Model Picker**: `providerIconUtils.ts` must have `GithubCopilotIcon` in `PROVIDER_ICON_BY_PROVIDER`
   - File: `apps/web/src/components/chat/providerIconUtils.ts`
   - Key: `[ProviderDriverKind.make("copilot")]: GithubCopilotIcon`
   - **This was missed in the v0.0.22 reconciliation** — the settings icon was present but the chat icon was not

3. The "coming soon" placeholder for Copilot in `ModelPickerSidebar.tsx` must be removed (it now renders as an active provider from `PROVIDER_OPTIONS`)

### Build

4. `asarUnpack` in build script includes `node_modules/@github/copilot-*/**` and `node_modules/@github/copilot/**`
5. `bun install --production` without `--omit optional`
6. npm force-install for cross-platform Copilot binaries (copilot-darwin-arm64, copilot-win32-x64, etc.)

## Reconciliation Checklist

On every upstream sync, verify BOTH icon locations:
```bash
grep "GithubCopilotIcon" apps/web/src/components/settings/providerDriverMeta.ts  # settings
grep "GithubCopilotIcon" apps/web/src/components/chat/providerIconUtils.ts       # chat UI
```

If either is missing, add the import and entry.
