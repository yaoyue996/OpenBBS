# OpenBBS one-click installer for Windows.
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/yaoyue996/OpenBBS/main/scripts/install.ps1 | iex
#
# Optional environment variables:
#   OPENBBS_DIR, OPENBBS_PORT, OPENBBS_SITE_URL, OPENBBS_BRANCH,
#   OPENBBS_NODE_VERSION, OPENBBS_ADMIN_USERNAME, OPENBBS_ADMIN_EMAIL
#
# NOTE: Keep this file ASCII-only and without a UTF-8 BOM. Windows PowerShell
# 5.1 does not strip a BOM when the script is piped from Invoke-RestMethod into
# Invoke-Expression. The service/update scripts are loaded with -File and are
# stored as UTF-8 with BOM so their Chinese messages decode correctly.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'yaoyue996/OpenBBS'
$Branch = if ($env:OPENBBS_BRANCH) { $env:OPENBBS_BRANCH } else { 'main' }
$NodeVersion = if ($env:OPENBBS_NODE_VERSION) { $env:OPENBBS_NODE_VERSION } else { '24.22.3' }
$InstallDir = if ($env:OPENBBS_DIR) { $env:OPENBBS_DIR } else { Join-Path $HOME 'OpenBBS' }
$Port = if ($env:OPENBBS_PORT) { $env:OPENBBS_PORT } else { '3000' }
$SiteUrl = if ($env:OPENBBS_SITE_URL) { $env:OPENBBS_SITE_URL } else { "http://localhost:$Port" }
$AdminUsername = if ($env:OPENBBS_ADMIN_USERNAME) { $env:OPENBBS_ADMIN_USERNAME } else { 'admin' }
$AdminEmail = if ($env:OPENBBS_ADMIN_EMAIL) { $env:OPENBBS_ADMIN_EMAIL } else { 'admin@example.com' }

function Write-Say([string]$Message) {
  Write-Host "[OpenBBS] $Message" -ForegroundColor Cyan
}

function Write-Fail([string]$Message) {
  Write-Host "[OpenBBS] Error: $Message" -ForegroundColor Red
  throw $Message
}

if (Test-Path (Join-Path $InstallDir 'server.js')) {
  Write-Fail "An existing installation was found at $InstallDir. To update, run: powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\update.ps1`""
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("openbbs-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  # ---------------------------------------------------------------- source
  Write-Say "Downloading OpenBBS source ($Branch branch)..."
  $ZipPath = Join-Path $TempDir 'openbbs.zip'
  try {
    Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $ZipPath -UseBasicParsing
  } catch {
    Write-Fail 'Failed to download the source archive. Check your network connection.'
  }
  $ExtractDir = Join-Path $TempDir 'src'
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force
  $SourceDir = Get-ChildItem -LiteralPath $ExtractDir -Directory -Force | Where-Object { $_.Name -like 'OpenBBS-*' } | Select-Object -First 1
  if (-not $SourceDir) { Write-Fail 'The source archive has an unexpected structure.' }
  Get-ChildItem -LiteralPath $SourceDir.FullName -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
  }

  # ------------------------------------------------------------------ Node
  $NodeOk = $false
  $NodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  $NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($NodeCmd -and $NpmCmd) {
    try {
      $Version = (& $NodeCmd.Source -p "process.versions.node").Trim()
      $Parts = $Version.Split('.')
      $Major = [int]$Parts[0]
      $Minor = [int]$Parts[1]
      if ($Major -gt 22 -or ($Major -eq 22 -and $Minor -ge 13)) { $NodeOk = $true }
    } catch {
      $NodeOk = $false
    }
  }

  if (-not $NodeOk) {
    Write-Say "System Node.js is missing or too old. Downloading Node.js v$NodeVersion (local install, no admin rights)..."
    $Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    switch ($Architecture) {
      'X64' { $NodeArch = 'x64' }
      'Arm64' { $NodeArch = 'arm64' }
      default { Write-Fail "Unsupported CPU architecture: $Architecture" }
    }
    $NodeZipName = "node-v$NodeVersion-win-$NodeArch"
    $NodeUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName.zip"
    $NodeZip = Join-Path $TempDir 'node.zip'
    try {
      Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
    } catch {
      Write-Fail "Failed to download Node.js: $NodeUrl"
    }
    $RuntimeDir = Join-Path $InstallDir '.runtime'
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $NodeExtract = Join-Path $TempDir 'node'
    Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeExtract -Force
    $NodeFolder = Join-Path $NodeExtract $NodeZipName
    $TargetNode = Join-Path $RuntimeDir 'node'
    if (Test-Path $TargetNode) { Remove-Item $TargetNode -Recurse -Force }
    Move-Item -LiteralPath $NodeFolder -Destination $TargetNode
  }

  if (-not (Test-Path (Join-Path $InstallDir '.runtime\node\node.exe'))) {
    $RuntimeDir = Join-Path $InstallDir '.runtime'
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  }
  if (Test-Path (Join-Path $InstallDir '.runtime\node')) {
    $env:PATH = "$(Join-Path $InstallDir '.runtime\node');$env:PATH"
  }

  $NodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  $NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $NodeCmd -or -not $NpmCmd) { Write-Fail 'Node.js / npm was not found.' }

  # -------------------------------------------------------- configuration
  Set-Location $InstallDir
  $EnvPath = Join-Path $InstallDir '.env'
  if (-not (Test-Path $EnvPath)) {
    Write-Say 'Creating configuration file .env...'
    $EnvContent = @"
# Generated by OpenBBS installer
HOST=0.0.0.0
PORT=$Port
SITE_URL=$SiteUrl
DATABASE_PATH=data/openbbs.db
TRUST_PROXY=0
COOKIE_SECURE=auto
NODE_ENV=production
ADMIN_USERNAME=$AdminUsername
ADMIN_PASSWORD=
ADMIN_EMAIL=$AdminEmail
"@
    [IO.File]::WriteAllText($EnvPath, $EnvContent, [Text.UTF8Encoding]::new($false))
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data') | Out-Null

  Write-Say 'Installing dependencies (no native modules to compile)...'
  & $NpmCmd.Source install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install failed.' }

  Write-Say 'Initializing the database...'
  & $NpmCmd.Source run init
  if ($LASTEXITCODE -ne 0) { Write-Fail 'Database initialization failed.' }

  Write-Say 'Starting the service...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallDir 'scripts\service.ps1') start
  if ($LASTEXITCODE -ne 0) { Write-Fail 'The service failed to start.' }

  Write-Host ''
  Write-Say 'Installation complete!'
  Write-Host "  URL:          http://localhost:$Port"
  Write-Host "  Install dir:  $InstallDir"
  Write-Host "  Admin user:   $AdminUsername (password: $InstallDir\data\initial-admin.txt)"
  Write-Host ''
  Write-Host '  Useful commands:'
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\service.ps1`" status"
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\service.ps1`" restart"
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\service.ps1`" logs"
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$InstallDir\scripts\update.ps1`""
  Write-Host ''
  if ($SiteUrl -eq "http://localhost:$Port") {
    Write-Host "  Tip: when deploying to the public internet, edit $InstallDir\.env and set SITE_URL to your domain."
  }
  Write-Host '  Please change the administrator password in Settings after logging in.'
  Write-Host ''
} finally {
  Set-Location $HOME
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
