# OpenBBS updater for Windows.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\update.ps1
#
# Optional environment variables: OPENBBS_DIR, OPENBBS_BRANCH

param(
  [string]$Branch = $(if ($env:OPENBBS_BRANCH) { $env:OPENBBS_BRANCH } else { 'main' })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'yaoyue996/OpenBBS'
$Root = if ($env:OPENBBS_DIR) { $env:OPENBBS_DIR } else { Split-Path -Parent $PSScriptRoot }

function Write-Say([string]$Message) {
  Write-Host "[OpenBBS] $Message" -ForegroundColor Cyan
}

function Write-Fail([string]$Message) {
  Write-Host "[OpenBBS] 错误：$Message" -ForegroundColor Red
  throw $Message
}

if (-not (Test-Path (Join-Path $Root 'server.js'))) {
  Write-Fail "未找到 OpenBBS 安装：$Root。"
}

Set-Location $Root

# --------------------------------------------------------------------- Node
$NodeDir = Join-Path $Root '.runtime\node'
if (Test-Path (Join-Path $NodeDir 'node.exe')) {
  $env:PATH = "$NodeDir;$env:PATH"
}

$NodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$NpmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $NodeCmd -or -not $NpmCmd) {
  Write-Fail '未找到 Node.js / npm。请重新运行安装脚本。'
}

try {
  $Version = (& $NodeCmd.Source -p "process.versions.node").Trim()
  $Parts = $Version.Split('.')
  $Major = [int]$Parts[0]
  $Minor = [int]$Parts[1]
  if (-not ($Major -gt 22 -or ($Major -eq 22 -and $Minor -ge 13))) {
    Write-Fail "Node.js 版本过低（$Version），需要 22.13 或更高版本。请重新运行安装脚本。"
  }
} catch {
  Write-Fail "无法检测 Node.js 版本：$($_.Exception.Message)"
}

$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("openbbs-update-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  # ------------------------------------------------------------------- stop
  Write-Say '停止服务…'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\service.ps1') stop

  # ----------------------------------------------------------------- backup
  New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
  $DbPath = Join-Path $Root 'data\openbbs.db'
  if (Test-Path $DbPath) {
    $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $BackupPath = Join-Path $Root "data\backup-$Stamp.db"
    Write-Say '备份数据库…'
    # Checkpoint the WAL first so copying the main database file is safe.
    & $NodeCmd.Source -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA wal_checkpoint(FULL);'); db.close();" $DbPath
    if ($LASTEXITCODE -ne 0) { Write-Fail '数据库备份失败（无法检查点数据库）。' }
    Copy-Item -LiteralPath $DbPath -Destination $BackupPath -Force
    Write-Say "数据库已备份：$BackupPath"
  }

  # ---------------------------------------------------------------- download
  Write-Say "下载最新源码（$Branch 分支）…"
  $ZipPath = Join-Path $TempDir 'openbbs.zip'
  try {
    Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $ZipPath -UseBasicParsing
  } catch {
    Write-Fail '下载失败，请检查网络。'
  }

  $ExtractDir = Join-Path $TempDir 'src'
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force
  $SourceDir = Get-ChildItem -LiteralPath $ExtractDir -Directory -Force | Where-Object { $_.Name -like 'OpenBBS-*' } | Select-Object -First 1
  if (-not $SourceDir -or -not (Test-Path (Join-Path $SourceDir.FullName 'server.js'))) {
    Write-Fail '源码包结构不正确。'
  }

  # ------------------------------------------------------------------- copy
  Write-Say '更新程序文件（保留 .env、data、.runtime、node_modules）…'
  $Items = @(
    'server.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE',
    'CONTRIBUTING.md', 'SECURITY.md', '.env.example',
    'Dockerfile', 'docker-compose.yml', '.dockerignore',
    'src', 'views', 'public', 'scripts', 'docs', 'test', '.github'
  )
  foreach ($Item in $Items) {
    $Source = Join-Path $SourceDir.FullName $Item
    if (-not (Test-Path $Source)) { continue }
    $Target = Join-Path $Root $Item
    if (Test-Path $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
    Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
  }

  # -------------------------------------------------------------- dependencies
  Write-Say '更新依赖…'
  & $NpmCmd.Source install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install 失败。' }

  Write-Say '执行数据库迁移…'
  & $NpmCmd.Source run init
  if ($LASTEXITCODE -ne 0) { Write-Fail '数据库迁移失败。' }

  # ------------------------------------------------------------------ start
  Write-Say '启动服务…'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\service.ps1') start
  if ($LASTEXITCODE -ne 0) { Write-Fail '服务启动失败，请查看 data\openbbs.err.log。' }

  Write-Host ''
  Write-Say '更新完成。'
  Write-Host '  常用命令:'
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$Root\scripts\service.ps1`" status"
  Write-Host "    powershell -ExecutionPolicy Bypass -File `"$Root\scripts\service.ps1`" logs"
  Write-Host ''
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
