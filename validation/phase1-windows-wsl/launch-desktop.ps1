[CmdletBinding()]
param(
  [string]$WslDistro = "Ubuntu",
  [string]$RunDirectory,
  [int]$WindowsPort = 14775,
  [switch]$Stop,
  [switch]$CleanupWslState
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion -lt [version]"7.3") {
  throw "PowerShell 7.3 or newer is required. Run this script with pwsh."
}

$outputRoot = Join-Path $PSScriptRoot "output"
if (-not $RunDirectory) {
  $RunDirectory = Get-ChildItem $outputRoot -Directory -Filter "run-*" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $RunDirectory) {
  throw "No validation run directory was found under $outputRoot."
}

$summaryPath = Join-Path $RunDirectory "run-summary.json"
$launchPath = Join-Path $RunDirectory "desktop-launch.json"
if (-not (Test-Path $summaryPath)) {
  throw "Missing run summary: $summaryPath"
}
$summary = Get-Content $summaryPath -Raw | ConvertFrom-Json
if ($summary.status -ne "passed") {
  throw "The automated run must pass before integrated desktop validation."
}
$windowsCopilotHome = Join-Path $env:USERPROFILE ".copilot"

function Remove-OwnedWslState($Launch) {
  $requiredProperties = @(
    "ownsWslT3Home",
    "ownsWslCopilotHome",
    "wslAccountHome",
    "wslT3Home",
    "wslCopilotHome",
    "wslDistro"
  )
  if ($requiredProperties | Where-Object { $null -eq $Launch.PSObject.Properties[$_] }) {
    throw "The launch record predates WSL state ownership tracking."
  }
  if (-not $Launch.ownsWslT3Home -or -not $Launch.ownsWslCopilotHome) {
    throw "The launch record does not prove ownership of both WSL state directories."
  }
  $expectedT3Home = "$($Launch.wslAccountHome)/.t3"
  $expectedCopilotHome = "$($Launch.wslAccountHome)/.copilot"
  if (
    $Launch.wslT3Home -ne $expectedT3Home -or
    $Launch.wslCopilotHome -ne $expectedCopilotHome
  ) {
    throw "The recorded WSL state paths do not match the guarded account-home paths."
  }

  $cleanupScript = @'
set -eu
home=$1
shift
runtime_in_use() {
  for cmdline in /proc/[0-9]*/cmdline; do
    [ -r "$cmdline" ] || continue
    command=$(tr '\0' ' ' <"$cmdline" 2>/dev/null || true)
    case "$command" in
      *apps/server/dist/bin.mjs*"--bootstrap-fd 0"*) return 0 ;;
      *"$home/.t3/wsl-runtime/"*) return 0 ;;
    esac
  done
  return 1
}
runtime_install_in_use() {
  runtime_parent="$home/.t3/wsl-runtime"
  [ -d "$runtime_parent" ] || return 1
  for lock in "$runtime_parent"/.*.install.lock; do
    [ -e "$lock" ] || continue
    if ! (flock -n 9) 9>"$lock"; then
      return 0
    fi
  done
  return 1
}
for _ in $(seq 1 50); do
  if ! runtime_in_use && ! runtime_install_in_use; then
    break
  fi
  sleep 0.2
done
if runtime_in_use || runtime_install_in_use; then
  printf 'A WSL backend or runtime installer is still using validation state.\n' >&2
  exit 4
fi
for candidate in "$@"; do
  case "$candidate" in
    "$home/.t3"|"$home/.copilot") rm -rf -- "$candidate" ;;
    *) printf 'Refusing unexpected cleanup path: %s\n' "$candidate" >&2; exit 3 ;;
  esac
done
for candidate in "$@"; do
  if [ -e "$candidate" ] || [ -L "$candidate" ]; then
    printf 'Validation state remains after cleanup: %s\n' "$candidate" >&2
    exit 5
  fi
done
'@
  & wsl.exe -d $Launch.wslDistro --exec sh -c `
    $cleanupScript sh $Launch.wslAccountHome $Launch.wslT3Home $Launch.wslCopilotHome
  if ($LASTEXITCODE -ne 0) {
    throw "Could not remove the validation-owned WSL state."
  }
}

if ($Stop) {
  if (-not (Test-Path $launchPath)) {
    throw "Missing desktop launch record: $launchPath"
  }
  $launch = Get-Content $launchPath -Raw | ConvertFrom-Json
  $process = Get-Process -Id $launch.pid -ErrorAction SilentlyContinue
  if ($null -ne $process) {
    $actualPath = $process.Path
    $actualStartTime = $process.StartTime.ToUniversalTime().ToString("o")
    if (
      $actualPath -ne $launch.appExecutable -or
      $actualStartTime -ne $launch.processStartTime
    ) {
      throw "PID $($launch.pid) no longer matches the recorded T3 process."
    }
    if (-not $process.CloseMainWindow()) {
      throw "The recorded desktop process has no closable main window. Close it normally before cleanup."
    }
    if (-not $process.WaitForExit(20000)) {
      throw "The desktop did not exit gracefully. Close it normally before cleanup."
    }
  }
  if ($CleanupWslState) {
    Remove-OwnedWslState $launch
    Write-Host "Removed validation-owned WSL .t3 and .copilot directories."
  }
  Write-Host "Stopped recorded desktop PID $($launch.pid)."
  exit 0
}
if ($CleanupWslState) {
  throw "-CleanupWslState requires -Stop."
}

$appExecutable = $summary.artifact.appExecutable
$nativeHome = $summary.nativeBackend.baseDir
$wslAccountHome = $summary.prerequisites.wslAccountHome
$wslT3Home = "$wslAccountHome/.t3"
$wslCopilotHome = "$wslAccountHome/.copilot"
foreach ($required in @($appExecutable, $nativeHome)) {
  if (-not (Test-Path $required)) {
    throw "Required path is missing: $required"
  }
}
if (-not $wslAccountHome -or $wslAccountHome -like "/mnt/*") {
  throw "The summary does not contain a native Linux account home."
}
if ($WslDistro -ne $summary.prerequisites.wslDistro) {
  throw "The launcher distro '$WslDistro' differs from the automated run distro '$($summary.prerequisites.wslDistro)'."
}

$existingLaunch = if (Test-Path $launchPath) {
  Get-Content $launchPath -Raw | ConvertFrom-Json
} else {
  $null
}
if ($null -ne $existingLaunch -and $null -ne (Get-Process -Id $existingLaunch.pid -ErrorAction SilentlyContinue)) {
  throw "The recorded desktop process is still running at PID $($existingLaunch.pid)."
}

function Test-ExistingLaunchOwnsWslState($Launch) {
  if ($null -eq $Launch) {
    return $false
  }
  foreach ($property in @(
    "ownsWslT3Home",
    "ownsWslCopilotHome",
    "wslDistro",
    "wslAccountHome",
    "wslT3Home",
    "wslCopilotHome"
  )) {
    if ($null -eq $Launch.PSObject.Properties[$property]) {
      return $false
    }
  }
  return (
    $Launch.ownsWslT3Home -and
    $Launch.ownsWslCopilotHome -and
    $Launch.wslDistro -eq $WslDistro -and
    $Launch.wslAccountHome -eq $wslAccountHome -and
    $Launch.wslT3Home -eq $wslT3Home -and
    $Launch.wslCopilotHome -eq $wslCopilotHome
  )
}

$ownsExistingWslState = Test-ExistingLaunchOwnsWslState $existingLaunch
if (-not $ownsExistingWslState) {
  foreach ($candidate in @($wslT3Home, $wslCopilotHome)) {
    $stateProbeScript = @'
if [ -e "$1" ] || [ -L "$1" ]; then
  printf 'State path already exists: %s\n' "$1" >&2
  exit 10
fi
'@
    & wsl.exe -d $WslDistro --exec sh -c $stateProbeScript sh $candidate
    if ($LASTEXITCODE -eq 10) {
      throw "Refusing to use existing WSL state at '$candidate'. Use a disposable WSL distro or a WSL account with no .t3 and .copilot directories."
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Could not inspect WSL state path '$candidate'."
    }
  }
}

$existingWslEnv = $env:WSLENV
$wslEnvParts = @(
  $existingWslEnv -split ":" |
    Where-Object {
      $_ -and $_ -notmatch "^(HOME|COPILOT_HOME|T3CODE_HOME)(/|$)"
    }
)
$validationWslEnv = $wslEnvParts -join ":"

$oldWslEnv = $env:WSLENV
$oldCopilotHome = $env:COPILOT_HOME
$oldT3CodeHome = $env:T3CODE_HOME
try {
  $env:WSLENV = $validationWslEnv
  $env:COPILOT_HOME = $windowsCopilotHome
  $env:T3CODE_HOME = $nativeHome
  $isolationProbe = (& wsl.exe -d $WslDistro --exec sh -c 'printf "%s\n%s\n%s" "$HOME" "${COPILOT_HOME-}" "${T3CODE_HOME-}"') -join "`n"
  $isolationLines = $isolationProbe -split "`r?`n", 3
  $observedHome = $isolationLines[0].Trim()
  $observedCopilotHome = if ($isolationLines.Count -gt 1) { $isolationLines[1].Trim() } else { "" }
  $observedT3CodeHome = if ($isolationLines.Count -gt 2) { $isolationLines[2].Trim() } else { "" }
  if (
    $LASTEXITCODE -ne 0 -or
    $observedHome -ne $wslAccountHome -or
    $observedCopilotHome -or
    $observedT3CodeHome
  ) {
    throw "WSL environment isolation failed. Expected HOME '$wslAccountHome' with no imported Copilot or T3 home overrides."
  }
} finally {
  $env:WSLENV = $oldWslEnv
  $env:COPILOT_HOME = $oldCopilotHome
  $env:T3CODE_HOME = $oldT3CodeHome
}

$appData = Join-Path $RunDirectory "integrated-appdata"
New-Item -ItemType Directory -Force -Path $appData | Out-Null

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $appExecutable
$startInfo.UseShellExecute = $false
$startInfo.Environment["T3CODE_HOME"] = $nativeHome
$startInfo.Environment["T3CODE_PORT"] = [string]$WindowsPort
$startInfo.Environment["APPDATA"] = $appData
$startInfo.Environment["WSLENV"] = $validationWslEnv
$startInfo.Environment["COPILOT_HOME"] = $windowsCopilotHome
[void]$startInfo.Environment.Remove("HOME")
$process = [Diagnostics.Process]::Start($startInfo)
if ($null -eq $process) {
  throw "Electron did not return a process handle."
}

$launch = [ordered]@{
  launchedAt = (Get-Date).ToUniversalTime().ToString("o")
  pid = $process.Id
  processStartTime = $process.StartTime.ToUniversalTime().ToString("o")
  appExecutable = $appExecutable
  windowsT3Home = $nativeHome
  windowsAppData = $appData
  wslDistro = $WslDistro
  wslAccountHome = $wslAccountHome
  wslT3Home = $wslT3Home
  wslCopilotHome = $wslCopilotHome
  ownsWslT3Home = $true
  ownsWslCopilotHome = $true
  wslEnv = $validationWslEnv
  windowsCopilotHome = $windowsCopilotHome
  windowsPort = $WindowsPort
}
$launch | ConvertTo-Json -Depth 10 | Set-Content $launchPath -Encoding utf8

Write-Host "Launched isolated T3 Code desktop."
Write-Host "PID: $($process.Id)"
Write-Host "Launch record: $launchPath"
Write-Host "Windows T3 home: $nativeHome"
Write-Host "Guarded WSL T3 home: $wslT3Home"
Write-Host "Guarded WSL Copilot home: $wslCopilotHome"
