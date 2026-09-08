[CmdletBinding()]
param(
  [string]$Repository = "https://github.com/tesseracode/t3code.git",
  [string]$SourceBranch = "phase1/foundation",
  [string]$ExpectedSourceCommit = "39295aed7a950a925791579661e79c4ff6b9072e",
  [string]$ExpectedServerVersion = "t3 v0.0.37",
  [string]$SourceRoot = "$env:USERPROFILE\src\t3code-phase1-validation-source",
  [string]$WslDistro = "Ubuntu",
  [int]$NativePort = 13773,
  [int]$WslPort = 13774,
  [switch]$SkipDependencyInstall,
  [switch]$SkipFocusedTests,
  [switch]$SkipCopilotProbe
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($PSVersionTable.PSVersion -lt [version]"7.3") {
  throw "PowerShell 7.3 or newer is required. Run this script with pwsh."
}
if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) {
  throw "This harness requires native Windows x64."
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outputRoot = Join-Path $PSScriptRoot "output"
$runRoot = Join-Path $outputRoot "run-$runId"
$logRoot = Join-Path $runRoot "logs"
$summaryPath = Join-Path $runRoot "run-summary.json"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$summary = [ordered]@{
  schemaVersion = 1
  status = "running"
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  handoffCommit = $null
  source = [ordered]@{
    repository = $Repository
    branch = $SourceBranch
    expectedCommit = $ExpectedSourceCommit
    expectedServerVersion = $ExpectedServerVersion
    checkout = $SourceRoot
  }
  prerequisites = [ordered]@{}
  focusedTests = [ordered]@{ status = "not-run" }
  wslPrebuild = [ordered]@{ status = "not-run" }
  artifact = [ordered]@{ status = "not-run" }
  nativeBackend = [ordered]@{ status = "not-run" }
  copilot = [ordered]@{ status = "not-run" }
  wslBackend = [ordered]@{ status = "not-run" }
  concurrency = [ordered]@{ status = "not-run" }
  inotify = [ordered]@{ status = "not-run" }
  rawWslFailure = [ordered]@{ status = "not-run" }
  error = $null
}

$processHandles = [Collections.Generic.List[object]]::new()
$cleanupErrors = [Collections.Generic.List[string]]::new()
$nativeHandle = $null
$wslStarted = $false
$wslRuntimeScript = $null
$wslArchivePath = $null
$wslArchiveHash = $null
$originalWslEnv = $env:WSLENV
$originalT3CodeHome = $env:T3CODE_HOME
$originalCopilotHome = $env:COPILOT_HOME

$sanitizedWslEnvParts = @(
  $originalWslEnv -split ":" |
    Where-Object {
      $_ -and $_ -notmatch "^(HOME|COPILOT_HOME|T3CODE_HOME)(/|$)"
    }
)
$env:WSLENV = $sanitizedWslEnvParts -join ":"
$env:T3CODE_HOME = $null
$env:COPILOT_HOME = $null

function Save-Summary {
  $summary | ConvertTo-Json -Depth 20 | Set-Content $summaryPath -Encoding utf8
}

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command([string]$Name, [string]$Hint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Missing command '$Name'. $Hint"
  }
  return $command.Source
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory
  )
  $previous = Get-Location
  try {
    if ($WorkingDirectory) {
      Set-Location $WorkingDirectory
    }
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "'$FilePath' exited with code $LASTEXITCODE."
    }
  } finally {
    Set-Location $previous
  }
}

function Invoke-Captured {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory
  )
  $previous = Get-Location
  $stderrPath = Join-Path $logRoot ("captured-{0}.stderr.log" -f [guid]::NewGuid().ToString("N"))
  try {
    if ($WorkingDirectory) {
      Set-Location $WorkingDirectory
    }
    $output = & $FilePath @Arguments 2> $stderrPath
    if ($LASTEXITCODE -ne 0) {
      throw "'$FilePath' exited with code $LASTEXITCODE. See local stderr log: $stderrPath"
    }
    return ($output -join "`n").Trim()
  } finally {
    Set-Location $previous
  }
}

function Convert-ToWslPath([string]$WindowsPath) {
  return Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "wslpath", "-a", "-u", $WindowsPath
  )
}

function Convert-KeyValueOutput([string]$Output) {
  $result = [ordered]@{}
  foreach ($line in ($Output -split "`r?`n")) {
    $separator = $line.IndexOf("=")
    if ($separator -le 0) {
      continue
    }
    $result[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
  }
  return $result
}

function Start-CapturedProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [hashtable]$Environment = @{},
    [Parameter(Mandatory)][string]$StdoutPath,
    [Parameter(Mandatory)][string]$StderrPath
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in $Arguments) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  foreach ($entry in $Environment.GetEnumerator()) {
    if ($null -eq $entry.Value) {
      [void]$startInfo.Environment.Remove([string]$entry.Key)
    } else {
      $startInfo.Environment[[string]$entry.Key] = [string]$entry.Value
    }
  }

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start $FilePath."
  }
  $handle = [pscustomobject]@{
    Process = $process
    StdoutTask = $process.StandardOutput.ReadToEndAsync()
    StderrTask = $process.StandardError.ReadToEndAsync()
    StdoutPath = $StdoutPath
    StderrPath = $StderrPath
    Collected = $false
  }
  $processHandles.Add($handle)
  return $handle
}

function Complete-CapturedProcess {
  param(
    [Parameter(Mandatory)]$Handle,
    [int]$TimeoutMilliseconds = 10000,
    [switch]$KillOnTimeout
  )
  if ($Handle.Collected) {
    return [ordered]@{
      exitCode = $Handle.Process.ExitCode
      stdout = Get-Content $Handle.StdoutPath -Raw -ErrorAction SilentlyContinue
      stderr = Get-Content $Handle.StderrPath -Raw -ErrorAction SilentlyContinue
    }
  }
  if (-not $Handle.Process.WaitForExit($TimeoutMilliseconds)) {
    if (-not $KillOnTimeout) {
      throw "PID $($Handle.Process.Id) did not exit within the timeout."
    }
    $Handle.Process.Kill($true)
    $Handle.Process.WaitForExit()
  }
  $stdout = $Handle.StdoutTask.GetAwaiter().GetResult()
  $stderr = $Handle.StderrTask.GetAwaiter().GetResult()
  $stdout | Set-Content $Handle.StdoutPath -Encoding utf8
  $stderr | Set-Content $Handle.StderrPath -Encoding utf8
  $Handle.Collected = $true
  return [ordered]@{
    exitCode = $Handle.Process.ExitCode
    stdout = $stdout
    stderr = $stderr
  }
}

function Stop-CapturedProcess($Handle) {
  if ($null -eq $Handle) {
    return $null
  }
  return Complete-CapturedProcess $Handle -TimeoutMilliseconds 1000 -KillOnTimeout
}

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [hashtable]$Environment = @{},
    [Parameter(Mandatory)][string]$LogName,
    [int]$TimeoutMilliseconds = 60000
  )
  $handle = Start-CapturedProcess `
    -FilePath $FilePath `
    -Arguments $Arguments `
    -Environment $Environment `
    -StdoutPath (Join-Path $logRoot "$LogName.stdout.log") `
    -StderrPath (Join-Path $logRoot "$LogName.stderr.log")
  return Complete-CapturedProcess `
    -Handle $handle `
    -TimeoutMilliseconds $TimeoutMilliseconds `
    -KillOnTimeout
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -NoProxy -TimeoutSec 3
      if ($response.StatusCode -eq 200) {
        return $response.StatusCode
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for HTTP 200 from $Url."
}

function Assert-PortAvailable([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($null -ne $listener) {
    throw "TCP port $Port already has a listener. Stop that exact process or choose another port."
  }
}

function Start-NativeBackend {
  param(
    [Parameter(Mandatory)][string]$AppExecutable,
    [Parameter(Mandatory)][string]$ServerAsar,
    [Parameter(Mandatory)][string]$BaseDir,
    [Parameter(Mandatory)][string]$LogSuffix
  )
  return Start-CapturedProcess `
    -FilePath $AppExecutable `
    -Arguments @(
      (Join-Path $ServerAsar "apps\server\dist\bin.mjs"),
      "start",
      "--mode", "desktop",
      "--base-dir", $BaseDir,
      "--host", "127.0.0.1",
      "--port", [string]$NativePort,
      "--no-browser"
    ) `
    -Environment @{ ELECTRON_RUN_AS_NODE = "1" } `
    -StdoutPath (Join-Path $logRoot "native-$LogSuffix.stdout.log") `
    -StderrPath (Join-Path $logRoot "native-$LogSuffix.stderr.log")
}

try {
  Save-Summary

  Write-Step "Checking host prerequisites"
  $git = Assert-Command "git.exe" "Install Git for Windows."
  $node = Assert-Command "node.exe" "Install Node.js 24.x."
  $corepack = Assert-Command "corepack.cmd" "Install Node.js with Corepack."
  $rustup = Assert-Command "rustup.exe" "Install Rustup."
  [void](Assert-Command "wsl.exe" "Enable WSL2 and install an x64 Ubuntu distro.")
  [void](Assert-Command "tar.exe" "Install a current Windows tar implementation.")

  $nodeVersion = (& $node --version).Trim()
  $nodeSemver = [version]$nodeVersion.TrimStart("v")
  if ($nodeSemver.Major -ne 24 -or $nodeSemver -lt [version]"24.13.1") {
    throw "Node.js >=24.13.1 <25 is required; found $nodeVersion."
  }

  $distroNames = (& wsl.exe --list --quiet) |
    ForEach-Object {
      $_.Replace([string][char]0, "").Trim().TrimStart([char]0xFEFF).TrimStart([char]0xFFFD)
    } |
    Where-Object { $_ }
  if (-not ($distroNames | Where-Object { $_ -ieq $WslDistro })) {
    throw "WSL distro '$WslDistro' was not found. Available: $($distroNames -join ', ')"
  }
  $wslList = ((& wsl.exe --list --verbose) -join "`n").
    Replace([string][char]0, "").
    TrimStart([char]0xFEFF).
    TrimStart([char]0xFFFD)
  $escapedDistro = [Regex]::Escape($WslDistro)
  if ($wslList -notmatch "(?m)^\s*\*?\s*$escapedDistro\s+\S+\s+2\s*$") {
    throw "Distro '$WslDistro' is not WSL2.`n$wslList"
  }
  $wslArchitecture = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "uname", "-m"
  )
  if ($wslArchitecture -ne "x86_64") {
    throw "The WSL distro must be x86_64; found '$wslArchitecture'."
  }
  Invoke-Checked "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", "-lc",
    "for tool in bash curl file flock g++ git inotifywait make python3 sha256sum tar; do command -v `"`$tool`" >/dev/null || { printf 'Missing WSL tool: %s\n' `"`$tool`" >&2; exit 3; }; done"
  )
  $wslAccountHome = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", "-lc",
    "getent passwd `"`$(id -u)`" | cut -d: -f6"
  )
  $wslObservedHome = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", "-lc",
    "printf '%s' `"`$HOME`""
  )
  if (-not $wslAccountHome -or $wslObservedHome -ne $wslAccountHome) {
    throw "WSL HOME is not the selected account's native home. Expected '$wslAccountHome', observed '$wslObservedHome'."
  }
  Assert-PortAvailable $NativePort
  Assert-PortAvailable $WslPort

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) {
    throw "Visual Studio 2022 Build Tools with Desktop development with C++ is required."
  }
  $vsInstall = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) -join "`n"
  if (-not $vsInstall.Trim()) {
    throw "MSVC x64 build tools were not found."
  }
  $vsSpectre = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre -property installationPath) -join "`n"
  if (-not $vsSpectre.Trim()) {
    throw "Install Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre."
  }

  $summary.handoffCommit = Invoke-Captured $git @("-C", $PSScriptRoot, "rev-parse", "HEAD")
  $summary.prerequisites = [ordered]@{
    status = "passed"
    windowsVersion = [Environment]::OSVersion.VersionString
    windowsArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    powershell = $PSVersionTable.PSVersion.ToString()
    node = $nodeVersion
    visualStudio = $vsInstall.Trim()
    wslDistro = $WslDistro
    wslList = $wslList
    wslArchitecture = $wslArchitecture
    wslAccountHome = $wslAccountHome
  }
  Save-Summary

  Write-Step "Preparing frozen source checkout"
  $sourceCreated = $false
  if (-not (Test-Path (Join-Path $SourceRoot ".git"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $SourceRoot) | Out-Null
    Invoke-Checked $git @("clone", "--filter=blob:none", "--no-checkout", $Repository, $SourceRoot)
    $sourceCreated = $true
  }
  if (-not $sourceCreated) {
    $trackedChanges = Invoke-Captured $git @("-C", $SourceRoot, "status", "--porcelain", "--untracked-files=no")
    if ($trackedChanges) {
      throw "The frozen source checkout has tracked changes:`n$trackedChanges"
    }
  }
  Invoke-Checked $git @("-C", $SourceRoot, "fetch", "--no-tags", "origin", $SourceBranch)
  Invoke-Checked $git @("-C", $SourceRoot, "merge-base", "--is-ancestor", $ExpectedSourceCommit, "FETCH_HEAD")
  Invoke-Checked $git @("-C", $SourceRoot, "checkout", "--detach", $ExpectedSourceCommit)
  $trackedChanges = Invoke-Captured $git @("-C", $SourceRoot, "status", "--porcelain", "--untracked-files=no")
  if ($trackedChanges) {
    throw "The frozen source checkout is not clean after checkout:`n$trackedChanges"
  }
  $actualSourceCommit = Invoke-Captured $git @("-C", $SourceRoot, "rev-parse", "HEAD")
  if ($actualSourceCommit -ne $ExpectedSourceCommit) {
    throw "Expected $ExpectedSourceCommit, found $actualSourceCommit."
  }
  $summary.source.actualCommit = $actualSourceCommit
  Save-Summary

  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
  Invoke-Checked $rustup @("toolchain", "install", "stable", "--profile", "minimal")
  Invoke-Checked $rustup @("target", "add", "x86_64-pc-windows-msvc")

  if (-not $SkipDependencyInstall) {
    Write-Step "Installing filtered Windows dependencies"
    Invoke-Checked $corepack @(
      "pnpm", "install",
      "--frozen-lockfile",
      "--filter=@t3tools/monorepo",
      "--filter=t3...",
      "--filter=@t3tools/desktop...",
      "--filter=@t3tools/scripts...",
      "--reporter=append-only"
    ) $SourceRoot
  }
  $vp = Join-Path $SourceRoot "node_modules\.bin\vp.cmd"
  if (-not (Test-Path $vp)) {
    throw "The filtered install did not produce the local Vite+ CLI at $vp."
  }
  $env:PATH = "$(Split-Path $vp);$env:PATH"

  if (-not $SkipFocusedTests) {
    Write-Step "Running focused desktop and WSL tests"
    $summary.focusedTests = [ordered]@{ status = "running"; files = 7 }
    Save-Summary
    try {
      Invoke-Checked $vp @(
        "test", "run",
        "scripts/build-desktop-artifact.test.ts",
        "apps/desktop/src/backend/DesktopBackendConfiguration.test.ts",
        "apps/desktop/src/backend/DesktopBackendManager.test.ts",
        "apps/desktop/src/backend/DesktopBackendPool.test.ts",
        "apps/desktop/src/wsl/DesktopWslBackend.test.ts",
        "apps/desktop/src/wsl/DesktopWslEnvironment.test.ts",
        "apps/desktop/src/wsl/DesktopWslServerTree.test.ts"
      ) $SourceRoot
    } catch {
      $summary.focusedTests.status = "failed"
      Save-Summary
      throw
    }
  }
  $summary.focusedTests = [ordered]@{
    status = if ($SkipFocusedTests) { "skipped-by-operator" } else { "passed" }
    files = 7
  }
  Save-Summary

  Write-Step "Building Linux x64 node-pty in WSL"
  $prebuildDirectory = Join-Path $runRoot "wsl-prebuild"
  New-Item -ItemType Directory -Force -Path $prebuildDirectory | Out-Null
  $prebuild = Join-Path $prebuildDirectory "pty.node"
  $buildWslScript = Convert-ToWslPath (Join-Path $PSScriptRoot "build-wsl-prebuild.sh")
  $prebuildWsl = Convert-ToWslPath $prebuild
  Invoke-Checked "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", $buildWslScript,
    $Repository, $SourceBranch, $ExpectedSourceCommit, $prebuildWsl
  )
  if (-not (Test-Path $prebuild)) {
    throw "WSL did not produce $prebuild."
  }
  $summary.wslPrebuild = [ordered]@{
    status = "passed"
    path = $prebuild
    sha256 = (Get-FileHash $prebuild -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item $prebuild).Length
  }
  Save-Summary

  Write-Step "Building Windows x64 NSIS artifact"
  foreach ($envFile in @(
    (Join-Path $SourceRoot ".env"),
    (Join-Path $SourceRoot ".env.local")
  )) {
    if (Test-Path $envFile) {
      throw "Refusing to package with repository environment file present: $envFile"
    }
  }
  $releaseDirectory = Join-Path $runRoot "release"
  New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
  $buildStarted = Get-Date
  $buildEnvironmentNames = @(
    Get-ChildItem Env: |
      Where-Object {
        $_.Name -match "^(VITE_|T3CODE_DESKTOP_|T3CODE_CLERK_|T3CODE_RELAY_)" -or
        $_.Name -in @("APP_VERSION", "T3CODE_SINGLE_ORIGIN_DEV")
      } |
      Select-Object -ExpandProperty Name
  ) + @(
    "T3CODE_DESKTOP_SKIP_BUILD",
    "T3CODE_DESKTOP_SIGNED",
    "T3CODE_DESKTOP_MOCK_UPDATES",
    "T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR"
  )
  $buildEnvironmentNames = $buildEnvironmentNames | Sort-Object -Unique
  $buildEnvironmentOriginals = @{}
  foreach ($name in $buildEnvironmentNames) {
    $buildEnvironmentOriginals[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  [Environment]::SetEnvironmentVariable("T3CODE_DESKTOP_SKIP_BUILD", "false", "Process")
  [Environment]::SetEnvironmentVariable("T3CODE_DESKTOP_SIGNED", "false", "Process")
  [Environment]::SetEnvironmentVariable("T3CODE_DESKTOP_MOCK_UPDATES", "false", "Process")
  [Environment]::SetEnvironmentVariable(
    "T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR",
    "false",
    "Process"
  )
  try {
    Invoke-Checked $node @(
      "scripts/build-desktop-artifact.ts",
      "--platform", "win",
      "--target", "nsis",
      "--arch", "x64",
      "--wsl-prebuild", $prebuild,
      "--output-dir", $releaseDirectory,
      "--keep-stage",
      "--verbose"
    ) $SourceRoot
  } finally {
    foreach ($name in $buildEnvironmentNames) {
      [Environment]::SetEnvironmentVariable(
        $name,
        $buildEnvironmentOriginals[$name],
        "Process"
      )
    }
  }

  $installer = Get-ChildItem $releaseDirectory -File -Filter "*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $installer) {
    throw "No NSIS installer was produced in $releaseDirectory."
  }
  $stage = Get-ChildItem $env:TEMP -Directory -Filter "t3code-desktop-win-stage-*" |
    Where-Object LastWriteTime -ge $buildStarted.AddMinutes(-1) |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $stage) {
    throw "The retained Windows stage could not be found under $env:TEMP."
  }
  $packagedApp = Join-Path $stage.FullName "app\dist\win-unpacked"
  $appExecutable = Join-Path $packagedApp "T3 Code (Alpha).exe"
  $resources = Join-Path $packagedApp "resources"
  $serverAsar = Join-Path $resources "server.asar"
  $serverAsarUnpacked = Join-Path $resources "server.asar.unpacked"
  $copilotExecutable = Join-Path $serverAsarUnpacked "node_modules\@github\copilot-win32-x64\copilot.exe"
  $resourceMonitor = Join-Path $resources "resource-monitor\t3-resource-monitor.exe"
  $wslArchive = Join-Path $resources "wsl-runtime.tar.gz"
  $wslHashFile = "$wslArchive.sha256"
  foreach ($required in @(
    $appExecutable,
    $serverAsar,
    $copilotExecutable,
    $resourceMonitor,
    $wslArchive,
    $wslHashFile
  )) {
    if (-not (Test-Path $required -PathType Leaf)) {
      throw "Required packaged file is missing: $required"
    }
  }
  $recordedWslHash = (Get-Content $wslHashFile -Raw).Trim().ToLowerInvariant()
  if ($recordedWslHash -notmatch "^[0-9a-f]{64}$") {
    throw "The WSL runtime hash sidecar is invalid."
  }
  $actualWslHash = (Get-FileHash $wslArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($recordedWslHash -ne $actualWslHash) {
    throw "The packaged WSL runtime does not match its SHA-256 sidecar."
  }

  $versionProbe = Invoke-CapturedProcess `
    -FilePath $appExecutable `
    -Arguments @(
      (Join-Path $PSScriptRoot "package-probe.cjs"),
      $serverAsar
    ) `
    -Environment @{ ELECTRON_RUN_AS_NODE = "1" } `
    -LogName "package-versions"
  if ($versionProbe.exitCode -ne 0) {
    throw "The packaged dependency probe failed with exit code $($versionProbe.exitCode)."
  }
  $versionJson = $versionProbe.stdout.Trim()
  $serverVersionProbe = Invoke-CapturedProcess `
    -FilePath $appExecutable `
    -Arguments @(
      (Join-Path $serverAsar "apps\server\dist\bin.mjs"),
      "--version"
    ) `
    -Environment @{ ELECTRON_RUN_AS_NODE = "1" } `
    -LogName "server-version"
  if ($serverVersionProbe.exitCode -ne 0) {
    throw "The packaged server version probe failed with exit code $($serverVersionProbe.exitCode)."
  }
  $packagedServerVersion = $serverVersionProbe.stdout.Trim()
  if ($packagedServerVersion -ne $ExpectedServerVersion) {
    throw "Expected packaged server '$ExpectedServerVersion', found '$packagedServerVersion'."
  }
  $packagedVersions = $versionJson | ConvertFrom-Json -AsHashtable
  $expectedVersions = [ordered]@{
    "@github/copilot-sdk" = "1.0.8"
    "@github/copilot" = "1.0.75"
    "@github/copilot-win32-x64" = "1.0.75"
    "koffi" = "3.1.6"
  }
  foreach ($name in $expectedVersions.Keys) {
    if ($packagedVersions[$name] -ne $expectedVersions[$name]) {
      throw "Expected packaged $name@$($expectedVersions[$name]), found $($packagedVersions[$name])."
    }
  }

  $summary.artifact = [ordered]@{
    status = "passed"
    installer = $installer.FullName
    installerSha256 = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    installerSize = $installer.Length
    retainedStage = $stage.FullName
    packagedApp = $packagedApp
    appExecutable = $appExecutable
    serverAsar = $serverAsar
    serverVersion = $packagedServerVersion
    copilotExecutable = $copilotExecutable
    copilotVersion = (Invoke-Captured $copilotExecutable @("--version"))
    resourceMonitor = $resourceMonitor
    wslRuntime = $wslArchive
    wslRuntimeSha256 = $actualWslHash
    packagedVersions = $packagedVersions
  }
  $wslRuntimeScript = Convert-ToWslPath (Join-Path $PSScriptRoot "wsl-runtime-smoke.sh")
  $wslArchivePath = Convert-ToWslPath $wslArchive
  $wslArchiveHash = $actualWslHash
  Save-Summary

  Write-Step "Starting packaged native Windows backend"
  $nativeBase = Join-Path $runRoot "native-home"
  New-Item -ItemType Directory -Force -Path $nativeBase | Out-Null
  $nativeHandle = Start-NativeBackend $appExecutable $serverAsar $nativeBase "initial"
  $nativeStatus = Wait-Http "http://127.0.0.1:$NativePort/"
  if ($nativeHandle.Process.HasExited) {
    throw "The packaged native backend exited before becoming ready."
  }
  $nativeEnvironmentIdPath = Join-Path $nativeBase "userdata\environment-id"
  if (-not (Test-Path $nativeEnvironmentIdPath)) {
    throw "The native backend did not persist an environment ID."
  }
  $nativeEnvironmentId = (Get-Content $nativeEnvironmentIdPath -Raw).Trim()
  $summary.nativeBackend = [ordered]@{
    status = "passed"
    port = $NativePort
    httpStatus = $nativeStatus
    baseDir = $nativeBase
    environmentId = $nativeEnvironmentId
    initialPid = $nativeHandle.Process.Id
    restartStatus = "not-run"
  }
  Save-Summary

  if (-not $SkipCopilotProbe) {
    Write-Step "Running packaged Copilot approval and session reuse probe"
    $copilotEvidence = Join-Path $runRoot "copilot-evidence.json"
    $sdkPath = Join-Path $serverAsar "node_modules\@github\copilot-sdk\dist\index.js"
    $copilotHome = Join-Path $env:USERPROFILE ".copilot"
    $copilotWorkspace = Join-Path $runRoot "copilot-workspace"
    New-Item -ItemType Directory -Force -Path $copilotWorkspace | Out-Null
    Invoke-Checked $git @("init", $copilotWorkspace)
    $copilotProbeResult = Invoke-CapturedProcess `
      -FilePath $appExecutable `
      -Arguments @(
        (Join-Path $PSScriptRoot "copilot-probe.mjs"),
        $sdkPath,
        $copilotExecutable,
        $copilotWorkspace,
        $copilotHome,
        $copilotEvidence
      ) `
      -Environment @{ ELECTRON_RUN_AS_NODE = "1" } `
      -LogName "copilot-probe" `
      -TimeoutMilliseconds 720000
    $copilotExit = $copilotProbeResult.exitCode
    if (-not (Test-Path $copilotEvidence)) {
      throw "The packaged Copilot probe exited without writing evidence."
    }
    $copilotResult = Get-Content $copilotEvidence -Raw | ConvertFrom-Json -AsHashtable
    if ($copilotExit -eq 4) {
      $summary.copilot = [ordered]@{
        status = "authentication-required"
        copilotExecutable = $copilotExecutable
        evidence = $copilotEvidence
      }
      Save-Summary
      throw "Packaged Copilot authentication is required. Run '$copilotExecutable login' without sharing its device code, then rerun."
    }
    if ($copilotExit -ne 0) {
      $summary.copilot = [ordered]@{
        status = "failed"
        evidence = $copilotEvidence
        error = $copilotResult.error
      }
      Save-Summary
      throw "The packaged Copilot probe failed with exit code $copilotExit."
    }
    if (
      -not $copilotResult.cleanedUp -or
      $copilotResult.runtimeVersion -ne "1.0.75" -or
      $copilotResult.permissionKinds.Count -lt 1 -or
      $copilotResult.unexpectedPermissionKinds.Count -gt 0 -or
      -not $copilotResult.toolExecutionSucceeded -or
      -not $copilotResult.toolOutputMarkerObserved -or
      $copilotResult.clientCleanup.Count -lt 3 -or
      -not $copilotResult.sdkListedAfterCliResume -or
      -not $copilotResult.resumedSessionIdMatched -or
      -not $copilotResult.cliTurnPersistedInOriginalSession -or
      -not $copilotResult.sdkTurnPersistedAfterResume
    ) {
      throw "The packaged Copilot probe returned incomplete evidence."
    }
    $copilotWorkspaceStatus = Invoke-Captured $git @(
      "-C", $copilotWorkspace, "status", "--porcelain"
    )
    if ($copilotWorkspaceStatus) {
      throw "The packaged Copilot probe modified its disposable workspace:`n$copilotWorkspaceStatus"
    }
    $summary.copilot = [ordered]@{
      status = "passed"
      runtimeVersion = $copilotResult.runtimeVersion
      authType = $copilotResult.authType
      approvalRequests = $copilotResult.permissionKinds.Count
      permissionKinds = $copilotResult.permissionKinds
      approvedCommand = $copilotResult.approvedCommand
      toolExecutionSucceeded = $copilotResult.toolExecutionSucceeded
      toolOutputMarkerObserved = $copilotResult.toolOutputMarkerObserved
      sdkCreateResponse = $copilotResult.sdkCreateResponse
      nativeCliResponse = $copilotResult.nativeCliResponse
      sdkListedAfterCliResume = $copilotResult.sdkListedAfterCliResume
      resumedSessionIdMatched = $copilotResult.resumedSessionIdMatched
      cliTurnPersistedInOriginalSession = $copilotResult.cliTurnPersistedInOriginalSession
      sdkResumeResponse = $copilotResult.sdkResumeResponse
      sdkTurnPersistedAfterResume = $copilotResult.sdkTurnPersistedAfterResume
      syntheticSessionDeleted = $copilotResult.cleanedUp
      clientCleanup = $copilotResult.clientCleanup
      evidence = $copilotEvidence
    }
  } else {
    $summary.copilot.status = "skipped-by-operator"
  }
  Save-Summary

  Write-Step "Starting packaged WSL backend"
  $wslStarted = $true
  $wslOutput = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", $wslRuntimeScript,
    "start", $runId, [string]$WslPort, $wslArchivePath, $wslArchiveHash
  )
  $wslMetadata = Convert-KeyValueOutput $wslOutput
  if (-not $wslMetadata.environmentId) {
    throw "The WSL backend did not return an environment ID."
  }
  if ($wslMetadata.serverVersion -ne $ExpectedServerVersion) {
    throw "Expected WSL server '$ExpectedServerVersion', found '$($wslMetadata.serverVersion)'."
  }
  if ($wslMetadata.serverVersion -ne $packagedServerVersion) {
    throw "Windows and WSL packaged server versions differ."
  }
  $wslUrl = "http://127.0.0.1:$WslPort/"
  try {
    $wslHttpStatus = Wait-Http $wslUrl 30
  } catch {
    $wslIp = (Invoke-Captured "wsl.exe" @(
      "-d", $WslDistro, "--exec", "hostname", "-I"
    )).Split(" ")[0]
    $wslUrl = "http://${wslIp}:$WslPort/"
    $wslHttpStatus = Wait-Http $wslUrl 30
  }
  if ($wslMetadata.environmentId -eq $nativeEnvironmentId) {
    throw "Windows and WSL returned the same environment ID."
  }
  $summary.wslBackend = [ordered]@{
    status = "passed"
    port = $WslPort
    httpStatus = $wslHttpStatus
    httpUrl = $wslUrl
    pid = [int]$wslMetadata.pid
    isolatedHome = $wslMetadata.isolatedHome
    runtimeRoot = $wslMetadata.runtimeRoot
    stateRoot = $wslMetadata.stateRoot
    logFile = $wslMetadata.logFile
    environmentId = $wslMetadata.environmentId
    serverVersion = $wslMetadata.serverVersion
    copilotVersion = $wslMetadata.copilotVersion
    nodePath = $wslMetadata.nodePath
    restartStatus = "not-run"
  }
  $summary.concurrency = [ordered]@{
    status = "passed"
    nativeHttpStatus = Wait-Http "http://127.0.0.1:$NativePort/"
    wslHttpStatus = Wait-Http $wslUrl
    distinctEnvironmentIds = $true
  }
  Save-Summary

  Write-Step "Verifying Windows write to Linux inotify"
  $wslProject = "$($wslMetadata.isolatedHome)/inotify-project"
  Invoke-Checked "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", "-lc",
    "mkdir -p '$wslProject'; rm -f '$wslProject/watcher-ready.txt'; printf 'before\n' > '$wslProject/watched.txt'"
  )
  $windowsProject = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "wslpath", "-w", "$wslProject"
  )
  $inotifyHandle = Start-CapturedProcess `
    -FilePath "wsl.exe" `
    -Arguments @(
      "-d", $WslDistro, "--exec", "bash", "-lc",
      "timeout 20s bash -c `"inotifywait -m -e close_write --format '%e %w%f' '$wslProject/watched.txt' 2> >(tee '$wslProject/watcher-ready.txt' >&2) | head -n 1`""
    ) `
    -StdoutPath (Join-Path $logRoot "inotify.stdout.log") `
    -StderrPath (Join-Path $logRoot "inotify.stderr.log")
  $watchReadyPath = Join-Path $windowsProject "watcher-ready.txt"
  $watchDeadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $watchDeadline) {
    if (
      (Test-Path $watchReadyPath) -and
      ((Get-Content $watchReadyPath -Raw -ErrorAction SilentlyContinue) -match "Watches established")
    ) {
      break
    }
    Start-Sleep -Milliseconds 200
  }
  if (
    -not (Test-Path $watchReadyPath) -or
    ((Get-Content $watchReadyPath -Raw -ErrorAction SilentlyContinue) -notmatch "Watches established")
  ) {
    [void](Stop-CapturedProcess $inotifyHandle)
    throw "The Linux inotify watcher did not report readiness."
  }
  "after" | Set-Content (Join-Path $windowsProject "watched.txt") -Encoding utf8
  $inotifyResult = Complete-CapturedProcess $inotifyHandle -TimeoutMilliseconds 25000 -KillOnTimeout
  if ($inotifyResult.exitCode -ne 0 -or $inotifyResult.stdout -notmatch "CLOSE_WRITE") {
    throw "Windows-to-WSL inotify validation failed."
  }
  $summary.inotify = [ordered]@{
    status = "passed"
    windowsPath = $windowsProject
    wslPath = $wslProject
    event = $inotifyResult.stdout.Trim()
  }
  Save-Summary

  Write-Step "Restarting packaged Windows and WSL backends"
  $initialNativeOutput = Stop-CapturedProcess $nativeHandle
  $initialNativeLog = "$($initialNativeOutput.stdout)`n$($initialNativeOutput.stderr)"
  $migration44Applied = $initialNativeLog -match "44_ProjectionThreadAttentionAudit"
  $migration45Applied = $initialNativeLog -match "45_TwsBindings"
  if (-not $migration44Applied -or -not $migration45Applied) {
    throw "The native backend log did not prove migrations 44 and 45 were applied."
  }
  $summary.nativeBackend.migration44Applied = $migration44Applied
  $summary.nativeBackend.migration45Applied = $migration45Applied
  $nativeHandle = Start-NativeBackend $appExecutable $serverAsar $nativeBase "restart"
  $nativeRestartStatus = Wait-Http "http://127.0.0.1:$NativePort/"
  if ($nativeHandle.Process.HasExited) {
    throw "The restarted native backend exited before becoming ready."
  }
  $nativeEnvironmentIdAfterRestart = (Get-Content $nativeEnvironmentIdPath -Raw).Trim()
  if ($nativeEnvironmentIdAfterRestart -ne $nativeEnvironmentId) {
    throw "The native environment ID changed after restart."
  }
  $summary.nativeBackend.restartStatus = "passed"
  $summary.nativeBackend.restartHttpStatus = $nativeRestartStatus
  $summary.nativeBackend.restartEnvironmentId = $nativeEnvironmentIdAfterRestart
  $summary.nativeBackend.restartPid = $nativeHandle.Process.Id

  $wslRestartOutput = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", $wslRuntimeScript,
    "restart", $runId, [string]$WslPort, $wslArchivePath, $wslArchiveHash
  )
  $wslRestartMetadata = Convert-KeyValueOutput $wslRestartOutput
  if ($wslRestartMetadata.environmentId -ne $wslMetadata.environmentId) {
    throw "The WSL environment ID changed after restart."
  }
  $summary.wslBackend.restartStatus = "passed"
  $summary.wslBackend.restartHttpStatus = Wait-Http $wslUrl
  $summary.wslBackend.restartEnvironmentId = $wslRestartMetadata.environmentId
  $summary.wslBackend.restartPid = [int]$wslRestartMetadata.pid
  $wslLog = Invoke-Captured "wsl.exe" @(
    "-d", $WslDistro, "--exec", "bash", "-lc",
    "cat '$($wslMetadata.logFile)'"
  )
  $summary.wslBackend.migration44Applied = $wslLog -match "44_ProjectionThreadAttentionAudit"
  $summary.wslBackend.migration45Applied = $wslLog -match "45_TwsBindings"
  if (-not $summary.wslBackend.migration44Applied -or -not $summary.wslBackend.migration45Applied) {
    throw "The WSL backend log did not prove migrations 44 and 45 were applied."
  }
  Save-Summary

  Write-Step "Verifying raw missing-distro isolation"
  & wsl.exe -d "T3-Intentionally-Missing-Distro" --exec true 2>$null
  $missingDistroExit = $LASTEXITCODE
  if ($missingDistroExit -eq 0) {
    throw "The intentionally missing distro unexpectedly succeeded."
  }
  $summary.rawWslFailure = [ordered]@{
    status = "passed"
    scope = "wsl-command-only"
    missingDistroExitCode = $missingDistroExit
    nativeHttpStatusAfterFailure = Wait-Http "http://127.0.0.1:$NativePort/"
    wslHttpStatusAfterFailure = Wait-Http $wslUrl
  }

  $summary.status = if ($SkipFocusedTests -or $SkipCopilotProbe) { "partial" } else { "passed" }
  $summary.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
  Copy-Item (Join-Path $PSScriptRoot "RESULTS_TEMPLATE.md") (Join-Path $runRoot "RESULTS.md")
  Save-Summary
} catch {
  $summary.status = "failed"
  $summary.error = [ordered]@{
    type = $_.Exception.GetType().FullName
    message = $_.Exception.Message
    scriptStackTrace = $_.ScriptStackTrace
  }
  $summary.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
  Save-Summary
  throw
} finally {
  if ($null -ne $nativeHandle) {
    try {
      [void](Stop-CapturedProcess $nativeHandle)
    } catch {
      $cleanupErrors.Add("Windows backend: $($_.Exception.Message)")
      Write-Warning "Could not stop the recorded Windows backend: $($_.Exception.Message)"
    }
  }
  if ($wslStarted -and $wslRuntimeScript) {
    try {
      Invoke-Checked "wsl.exe" @(
        "-d", $WslDistro, "--exec", "bash", $wslRuntimeScript,
        "stop", $runId, [string]$WslPort
      )
    } catch {
      $cleanupErrors.Add("WSL backend: $($_.Exception.Message)")
      Write-Warning "Could not stop the recorded WSL backend: $($_.Exception.Message)"
    }
  }
  foreach ($handle in $processHandles) {
    if (-not $handle.Collected) {
      try {
        [void](Stop-CapturedProcess $handle)
      } catch {
        $cleanupErrors.Add("PID $($handle.Process.Id): $($_.Exception.Message)")
        Write-Warning "Could not collect recorded PID $($handle.Process.Id): $($_.Exception.Message)"
      }
    }
  }
  $summary.cleanup = [ordered]@{
    status = if ($cleanupErrors.Count -eq 0) { "passed" } else { "failed" }
    errors = $cleanupErrors
  }
  if ($cleanupErrors.Count -gt 0 -and $summary.status -in @("passed", "partial")) {
    $summary.status = "failed"
    $summary.error = [ordered]@{
      type = "HarnessCleanupError"
      message = "One or more harness-owned processes could not be stopped."
    }
  }
  $env:WSLENV = $originalWslEnv
  $env:T3CODE_HOME = $originalT3CodeHome
  $env:COPILOT_HOME = $originalCopilotHome
  Save-Summary
}

if ($summary.status -eq "failed") {
  throw "Validation failed; inspect $summaryPath."
}

Write-Host ""
Write-Host "Automated Phase 1 Windows/WSL validation completed with status $($summary.status)." -ForegroundColor Green
Write-Host "Run directory: $runRoot"
Write-Host "Summary: $summaryPath"
Write-Host "Installer: $($summary.artifact.installer)"
Write-Host "Unpacked app: $($summary.artifact.packagedApp)"
