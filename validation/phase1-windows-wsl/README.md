# Phase 1 Windows and WSL validation handoff

This temporary branch carries the cross-machine validation harness for the
Phase 1 foundation. It is not intended to merge into `main` or
`phase1/foundation`.

## Frozen source under test

- Repository: `https://github.com/tesseracode/t3code.git`
- Validation baseline:
  `7032ad0c135d451554c552daa9178783a11b5cd7` or a descendant on
  `validation/phase1-windows-wsl`
- Source branch: `phase1/foundation`
- Source commit: `1910f22c210836cde7e13e9d7fcae0819d431c2a`
- Desktop version: `0.0.37`
- Target: Windows x64 plus an x64 Ubuntu WSL2 distro

The runner uses a separate detached checkout at the frozen source commit. The
validation-only files on this branch never enter the packaged app.

## Safety boundaries

- Do not point T3 Code at an existing Windows or WSL T3 home.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL`.
- Do not copy or print Copilot credentials.
- The Windows Copilot probe uses the current user's normal Copilot home only
  for authentication and deletes the synthetic session it creates.
- The WSL smoke test and integrated desktop launch use a run-specific Linux
  `HOME`. `launch-desktop.ps1` refuses to launch unless WSL proves that this
  value crosses the Windows/WSL boundary.
- Raw server logs remain local because logs can contain machine paths and
  runtime identifiers. Report only the sanitized summary.
- Every process stopped by the harness was started by the harness and is
  tracked by its exact PID.
- Do not commit, push, open a pull request, or modify the frozen source while
  validating. Local fixes to this handoff are allowed only when recorded in
  the final report.

## Files

| File | Purpose |
|---|---|
| `AGENT_PROMPT.md` | Paste-ready instructions for the Windows agent |
| `run.ps1` | Automated build and packaged backend validation |
| `build-wsl-prebuild.sh` | Builds the Linux x64 `node-pty` binary inside WSL |
| `wsl-runtime-smoke.sh` | Starts, restarts, and stops the packaged Linux backend |
| `package-probe.cjs` | Reads packaged dependency versions through Electron ASAR support |
| `copilot-probe.mjs` | Runs approval and SDK/CLI session-reuse checks |
| `launch-desktop.ps1` | Launches the unpacked desktop app with isolated Windows and WSL state |
| `RESULTS_TEMPLATE.md` | Required sanitized report format |

Generated files go under `output/`, which is ignored by Git.

## Host prerequisites

The agent should inspect these before installing anything:

### Windows

- Windows 11 x64
- PowerShell 7 (`pwsh`)
- Git for Windows
- Node.js 24.x with Corepack
- Rustup and stable `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools:
  - Desktop development with C++
  - MSVC x64 tools
  - Spectre-mitigated x64 libraries
- A Windows Copilot CLI login for the current user

### WSL

- An x64 WSL2 distro, normally `Ubuntu`
- `bash`, `git`, `curl`, `file`, `tar`, `make`, `g++`, `python3`,
  `sha256sum`, `flock`, and `inotifywait`

On Ubuntu, the usual package command is:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl file git build-essential python3 inotify-tools util-linux
```

The helper installs Node `24.20.0` below the current WSL user's home when no
compatible Node 24 is available. It does not use `sudo` for Node.

## Automated validation

From a PowerShell 7 prompt at the handoff checkout:

```powershell
pwsh -NoLogo -NoProfile -File .\validation\phase1-windows-wsl\run.ps1 `
  -WslDistro Ubuntu
```

The runner:

1. verifies Windows x64, PowerShell, Node, Rust, MSVC/Spectre, WSL2, and distro
   architecture;
2. checks out the frozen source commit separately;
3. installs only the root, desktop, server, and script dependency closures;
4. runs the seven focused desktop packaging/backend/WSL test files;
5. builds Linux x64 `node-pty` inside WSL;
6. builds the unsigned Windows x64 NSIS artifact with `--wsl-prebuild`;
   the runner clears ambient desktop/Vite overrides, refuses root `.env` files,
   and forces a fresh unsigned non-mock build;
7. validates `server.asar`, smart-unpacked native files, the resource monitor,
   the WSL archive and digest, and exact Copilot/Koffi versions;
8. starts and restarts the packaged Windows backend against disposable state;
9. runs one packaged Copilot tool approval, resumes the same session with the
   packaged native CLI, verifies the CLI turn landed in the original persisted
   event history, resumes it again with a fresh packaged SDK client, verifies
   continuity again, then deletes it;
10. starts and restarts the packaged Linux backend inside WSL;
11. keeps Windows and WSL backends live together on different ports and
    confirms distinct environment IDs;
12. writes from Windows into the Linux filesystem and requires a native
    `inotify` close-write event;
13. proves raw `wsl.exe` rejects a missing distro while both unrelated backend
    processes remain responsive. The real T3 fallback is a separate integrated
    desktop gate below.

The final console output gives the run directory, `run-summary.json`, NSIS
installer, and retained `win-unpacked` app.

If the packaged Copilot runtime reports unauthenticated, use the exact
`copilot.exe` path recorded in the partial summary to run:

```powershell
& "<recorded-copilot-exe>" login
```

Complete the device flow without pasting its token into chat, then rerun the
harness. `-SkipDependencyInstall` and `-SkipFocusedTests` may be used only
after those stages passed once in the same frozen source checkout.

## Integrated desktop validation

The automated run proves the payload and both packaged backends. The following
checks exercise the actual Electron orchestration and UI.

Launch the latest successful unpacked app:

```powershell
pwsh -NoLogo -NoProfile -File .\validation\phase1-windows-wsl\launch-desktop.ps1 `
  -WslDistro Ubuntu
```

The launcher reuses the automated run's disposable Windows T3 home and
run-specific WSL home. It also isolates Electron `APPDATA`. It prints and
records the exact PID. The Windows process receives an explicit
`COPILOT_HOME=%USERPROFILE%\.copilot`, so forwarding Linux `HOME` does not move
the Windows Copilot credential lookup.

Perform these checks:

1. Open **Settings → Connections**.
2. In **WSL backend**, select `Ubuntu`, then choose **Run both backends**.
3. Confirm the primary Windows environment remains connected while the local
   WSL environment transitions from Connecting to connected.
4. Create a small Git repository on Windows and one in the isolated Linux home:

   ```powershell
   $winProject = Join-Path $env:USERPROFILE "t3-phase1-ui-windows"
   New-Item -ItemType Directory -Force $winProject | Out-Null
   git -C $winProject init

   $launch = Get-Content "<run-directory>\desktop-launch.json" -Raw |
     ConvertFrom-Json
   $oldHome = $env:HOME
   $oldWslEnv = $env:WSLENV
   try {
     $env:HOME = $launch.wslHome
     $env:WSLENV = $launch.wslEnv
     wsl.exe -d Ubuntu -- bash -lc `
       'mkdir -p "$HOME/t3-phase1-ui-wsl" && git -C "$HOME/t3-phase1-ui-wsl" init'
   } finally {
     $env:HOME = $oldHome
     $env:WSLENV = $oldWslEnv
   }
   ```

   Replace `<run-directory>` with the path printed by `run.ps1`.
5. Add the Windows repository to the Windows environment and the Linux
   repository to the WSL environment.
6. Start a GitHub Copilot thread in the Windows project. Ask it to run
   `Write-Output WINDOWS_UI_APPROVAL_OK`, approve the command in T3, and require
   the final response `WINDOWS_UI_TURN_OK`.
7. If the isolated WSL Copilot home is unauthenticated, run the packaged Linux
   Copilot executable from the WSL runtime with `login` and complete its device
   flow. Use the same isolated environment:

   ```powershell
   $summary = Get-Content "<run-directory>\run-summary.json" -Raw |
     ConvertFrom-Json
   $launch = Get-Content "<run-directory>\desktop-launch.json" -Raw |
     ConvertFrom-Json
   $linuxCopilot = "$($summary.wslBackend.runtimeRoot)/node_modules/@github/copilot-linux-x64/copilot"
   $oldHome = $env:HOME
   $oldWslEnv = $env:WSLENV
   try {
     $env:HOME = $launch.wslHome
     $env:WSLENV = $launch.wslEnv
     wsl.exe -d Ubuntu -- $linuxCopilot login
   } finally {
     $env:HOME = $oldHome
     $env:WSLENV = $oldWslEnv
   }
   ```

   Do not expose the device code or token.
8. Start a GitHub Copilot thread in the WSL project. Ask it to run
   `printf 'WSL_UI_APPROVAL_OK\n'`, approve it in T3, and require the final
   response `WSL_UI_TURN_OK`.
9. Confirm both projects/threads remain visible and are labeled as different
   local environments.
10. Close T3 normally and relaunch it with `launch-desktop.ps1`. Confirm both
    environments reconnect and both projects/threads remain present.
11. With T3 closed, back up the disposable
    `userdata\desktop-settings.json`, set its WSL distro to
    `T3-Intentionally-Missing-Distro`, and relaunch. Confirm the Windows
    backend stays usable and Settings shows an explicit recoverable WSL error.
    Restore the backed-up disposable settings file afterward.
12. After results are captured, delete the retained stage path recorded in
    `run-summary.json`. It is a disposable multi-gigabyte build tree under
    `%TEMP%`; keep the NSIS installer and sanitized run evidence.

Record each check as `PASS`, `FAIL`, or `NOT RUN`. A failure is useful evidence;
do not change product code merely to make the report green.

## Returning results

Copy `RESULTS_TEMPLATE.md` to `<run-directory>\RESULTS.md`, fill every row, and
return:

1. the complete sanitized `RESULTS.md`;
2. `run-summary.json`;
3. the exact local handoff changes, if any;
4. only the relevant redacted error excerpts for failed checks.

Do not return raw logs, pairing URLs, auth files, device codes, tokens, or the
contents of `.copilot`.
