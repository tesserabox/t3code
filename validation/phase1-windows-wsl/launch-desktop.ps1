[CmdletBinding()]
param(
  [string]$WslDistro = "Ubuntu",
  [string]$RunDirectory,
  [int]$WindowsPort = 14775,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "PowerShell 7 or newer is required. Run this script with pwsh."
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
    $process.Kill($true)
    $process.WaitForExit()
  }
  Write-Host "Stopped recorded desktop PID $($launch.pid)."
  exit 0
}

$appExecutable = $summary.artifact.appExecutable
$nativeHome = $summary.nativeBackend.baseDir
$isolatedWslHome = $summary.wslBackend.isolatedHome
foreach ($required in @($appExecutable, $nativeHome)) {
  if (-not (Test-Path $required)) {
    throw "Required path is missing: $required"
  }
}

$existingLaunch = if (Test-Path $launchPath) {
  Get-Content $launchPath -Raw | ConvertFrom-Json
} else {
  $null
}
if ($null -ne $existingLaunch -and $null -ne (Get-Process -Id $existingLaunch.pid -ErrorAction SilentlyContinue)) {
  throw "The recorded desktop process is still running at PID $($existingLaunch.pid)."
}

$existingWslEnv = $env:WSLENV
$wslEnvParts = @(
  $existingWslEnv -split ":" |
    Where-Object {
      $_ -and $_ -notmatch "^(HOME|COPILOT_HOME|T3CODE_HOME)(/|$)"
    }
)
$wslEnvParts += "HOME/u"
$validationWslEnv = $wslEnvParts -join ":"

$oldHome = $env:HOME
$oldWslEnv = $env:WSLENV
$oldCopilotHome = $env:COPILOT_HOME
$oldT3CodeHome = $env:T3CODE_HOME
try {
  $env:HOME = $isolatedWslHome
  $env:WSLENV = $validationWslEnv
  $env:COPILOT_HOME = $windowsCopilotHome
  $env:T3CODE_HOME = $nativeHome
  $isolationProbe = (& wsl.exe -d $WslDistro -- bash -lc 'printf "%s\n%s\n%s" "$HOME" "${COPILOT_HOME-}" "${T3CODE_HOME-}"') -join "`n"
  $isolationLines = $isolationProbe -split "`r?`n", 3
  $observedHome = $isolationLines[0].Trim()
  $observedCopilotHome = if ($isolationLines.Count -gt 1) { $isolationLines[1].Trim() } else { "" }
  $observedT3CodeHome = if ($isolationLines.Count -gt 2) { $isolationLines[2].Trim() } else { "" }
  if (
    $LASTEXITCODE -ne 0 -or
    $observedHome -ne $isolatedWslHome -or
    $observedCopilotHome -or
    $observedT3CodeHome
  ) {
    throw "WSL HOME isolation failed. Expected '$isolatedWslHome', observed '$observedHome'."
  }
} finally {
  $env:HOME = $oldHome
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
$startInfo.Environment["HOME"] = $isolatedWslHome
$startInfo.Environment["WSLENV"] = $validationWslEnv
$startInfo.Environment["COPILOT_HOME"] = $windowsCopilotHome
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
  wslHome = $isolatedWslHome
  wslEnv = $validationWslEnv
  windowsCopilotHome = $windowsCopilotHome
  windowsPort = $WindowsPort
}
$launch | ConvertTo-Json -Depth 10 | Set-Content $launchPath -Encoding utf8

Write-Host "Launched isolated T3 Code desktop."
Write-Host "PID: $($process.Id)"
Write-Host "Launch record: $launchPath"
Write-Host "Windows T3 home: $nativeHome"
Write-Host "WSL HOME: $isolatedWslHome"
