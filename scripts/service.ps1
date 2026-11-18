# OpenBBS service control for Windows.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\service.ps1 [start|stop|restart|status|logs]

param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$NodeDir = Join-Path $Root '.runtime\node'
if (Test-Path (Join-Path $NodeDir 'node.exe')) {
  $env:PATH = "$NodeDir;$env:PATH"
}

$PidFile = Join-Path $Root 'data\openbbs.pid'
$LogFile = Join-Path $Root 'data\openbbs.log'
$ErrFile = Join-Path $Root 'data\openbbs.err.log'

function Write-Say([string]$Message) {
  Write-Host "[OpenBBS] $Message" -ForegroundColor Cyan
}

function Get-ServicePid {
  if (-not (Test-Path $PidFile)) { return $null }
  $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  $value = 0
  if ([int]::TryParse(([string]$raw).Trim(), [ref]$value) -and $value -gt 0) { return $value }
  return $null
}

function Test-ServiceRunning {
  $servicePid = Get-ServicePid
  if (-not $servicePid) { return $false }
  return [bool](Get-Process -Id $servicePid -ErrorAction SilentlyContinue)
}

function Get-ConfiguredPort {
  $envFile = Join-Path $Root '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -Last 1
    if ($line) {
      $value = ($line -split '=', 2)[1].Trim()
      if ($value -match '^\d+$') { return [int]$value }
    }
  }
  return 3000
}

function Stop-Service {
  if (-not (Test-ServiceRunning)) {
    Write-Say '服务未运行。'
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return
  }
  $servicePid = Get-ServicePid
  Write-Say "正在停止服务（PID $servicePid）…"
  Stop-Process -Id $servicePid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  Write-Say '服务已停止。'
}

function Start-Service {
  if (Test-ServiceRunning) {
    Write-Say "服务已在运行（PID $(Get-ServicePid)）。"
    return
  }

  $node = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  if (-not $node) {
    throw '未找到 Node.js。请重新运行安装脚本，或安装 Node.js 22.13 及以上版本。'
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
  Write-Say '正在启动服务…'
  $process = Start-Process -FilePath $node `
    -ArgumentList 'server.js' `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrFile `
    -WindowStyle Hidden `
    -PassThru

  $process.Id | Set-Content -Path $PidFile -Encoding ASCII

  $port = Get-ConfiguredPort
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { break }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $ready = $true
        break
      }
    } catch {
      # keep waiting
    }
  }

  if ($ready) {
    Write-Say "服务已启动：http://localhost:$port （PID $($process.Id)）"
  } else {
    Write-Say '服务启动失败，最近日志：'
    if (Test-Path $ErrFile) { Get-Content $ErrFile -Tail 30 }
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 30 }
    exit 1
  }
}

switch ($Action) {
  'start' { Start-Service }
  'stop' { Stop-Service }
  'restart' {
    Stop-Service
    Start-Service
  }
  'status' {
    if (Test-ServiceRunning) {
      Write-Say "服务运行中（PID $(Get-ServicePid)）。"
    } else {
      Write-Say '服务未运行。'
      exit 1
    }
  }
  'logs' {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
    if (-not (Test-Path $LogFile)) { New-Item -ItemType File -Path $LogFile | Out-Null }
    if (-not (Test-Path $ErrFile)) { New-Item -ItemType File -Path $ErrFile | Out-Null }
    Get-Content -Path $LogFile, $ErrFile -Tail 100 -Wait
  }
}
