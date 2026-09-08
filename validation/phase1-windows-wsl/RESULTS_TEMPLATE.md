# Phase 1 Windows and WSL validation results

## Host

| Field | Value |
|---|---|
| Date/time (UTC) | |
| Windows version/build | |
| Windows architecture | |
| PowerShell | |
| Node.js | |
| Visual Studio Build Tools | |
| WSL version/mode | |
| WSL distro and version | |
| WSL architecture | |
| Frozen source commit | |
| Handoff commit | |

## Automated gates

| Gate | Result | Evidence or concise failure |
|---|---|---|
| Frozen checkout | NOT RUN | |
| Focused desktop/WSL tests | NOT RUN | |
| Linux x64 `node-pty` prebuild | NOT RUN | |
| Windows x64 NSIS build | NOT RUN | |
| Windows packaged payload validation | NOT RUN | |
| Packaged dependency versions | NOT RUN | |
| Packaged native server HTTP/migrations | NOT RUN | |
| Packaged native forced restart/crash recovery | NOT RUN | |
| Packaged Copilot approval | NOT RUN | |
| SDK → native CLI → SDK persisted continuity | NOT RUN | |
| Packaged WSL server HTTP/migrations | NOT RUN | |
| Packaged WSL server restart/persistence | NOT RUN | |
| Concurrent Windows and WSL backends | NOT RUN | |
| Distinct environment IDs | NOT RUN | |
| Windows write → Linux `inotify` | NOT RUN | |
| Raw `wsl.exe` rejects unknown distro while backends stay up | NOT RUN | |

## Integrated desktop gates

| Gate | Result | Evidence or concise failure |
|---|---|---|
| Isolated Electron launch | NOT RUN | |
| WSL distro discovery | NOT RUN | |
| **Run both backends** startup | NOT RUN | |
| Windows project registration | NOT RUN | |
| WSL project registration | NOT RUN | |
| Windows T3 Copilot approval turn | NOT RUN | |
| WSL T3 Copilot approval turn | NOT RUN | |
| Both environments visible together | NOT RUN | |
| Desktop restart reconnects both | NOT RUN | |
| Projects and threads persist after restart | NOT RUN | |
| Invalid WSL distro reports recoverable error | NOT RUN | |
| Windows remains usable during WSL failure | NOT RUN | |
| Disposable WSL settings restored | NOT RUN | |

## Artifacts

| Artifact | Path | SHA-256 |
|---|---|---|
| NSIS installer | | |
| Linux `pty.node` | | |
| Packaged WSL runtime | | |

Packaged versions:

```json
{}
```

## Deviations and defects

- None recorded.

## Local handoff changes

- None.

## Cleanup

| Item | Result |
|---|---|
| Harness-owned Windows processes stopped | NOT RUN |
| Harness-owned WSL process stopped | NOT RUN |
| Synthetic Copilot session deleted | NOT RUN |
| Retained `%TEMP%` build stage deleted after evidence capture | NOT RUN |
| No product-source commit/push/PR/workflow | NOT RUN |

## Verdict

`VALIDATION_INCOMPLETE`
