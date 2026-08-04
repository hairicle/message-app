#!/usr/bin/env pwsh
<#
  Starts (or stops) the full Messenger App stack:
    - Docker Desktop (Postgres + Redis containers)
    - NestJS API dev server  (http://localhost:4000)
    - Next.js web dev server (http://localhost:3100)

  Usage:
    ./run.ps1          Start everything (frees stale ports first, waits until ready)
    ./run.ps1 -Stop     Stop the dev servers and the Postgres/Redis containers
#>

param(
    [switch]$Stop
)

# Rebuild PATH from the registry (Machine + User) instead of trusting this session's inherited
# PATH. Fixes "npm/node not recognized" when this script is launched from a terminal/IDE window
# that was already open before Node.js was installed or added to PATH — those windows never see
# PATH updates until relaunched, but this script can just self-correct instead.
$machinePath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$env:PATH = "$machinePath;$userPath"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "node/npm still not found on PATH even after refreshing from the registry." -ForegroundColor Red
    Write-Host "Install Node.js (https://nodejs.org) or check that its install location was added to PATH, then try again." -ForegroundColor Red
    exit 1
}

$root = $PSScriptRoot
$ApiPort = 4000
$WebPort = 3100

function Get-PortOwnerPid($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Stop-Port($port, $label) {
    $procId = Get-PortOwnerPid $port
    if ($procId) {
        Write-Host "Stopping stale process on port $port ($label, PID $procId)..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

function Wait-ForHttp($url, $label, $timeoutSeconds = 60) {
    Write-Host "Waiting for $label..." -ForegroundColor Cyan -NoNewline
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    do {
        Start-Sleep -Seconds 2
        Write-Host "." -ForegroundColor Cyan -NoNewline
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) {
                Write-Host " ready." -ForegroundColor Green
                return $true
            }
        } catch {}
    } while ((Get-Date) -lt $deadline)
    Write-Host " timed out after ${timeoutSeconds}s (it may still be compiling — check its window)." -ForegroundColor Red
    return $false
}

# ── Stop mode ────────────────────────────────────────────────────────────────
if ($Stop) {
    Write-Host "Stopping dev servers..." -ForegroundColor Cyan
    Stop-Port $ApiPort "API"
    Stop-Port $WebPort "Web"

    Write-Host "Stopping Postgres + Redis containers..." -ForegroundColor Cyan
    Push-Location "$root"
    docker compose stop postgres redis
    Pop-Location

    Write-Host "Stack stopped." -ForegroundColor Green
    exit 0
}

# ── Start mode ───────────────────────────────────────────────────────────────

# 1. Make sure Docker is running
Write-Host "Checking Docker..." -ForegroundColor Cyan
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker is not running. Launching Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"

    Write-Host "Waiting for Docker to be ready (this can take a minute)..." -ForegroundColor Yellow
    do {
        Start-Sleep -Seconds 5
        docker info > $null 2>&1
    } while ($LASTEXITCODE -ne 0)
}
Write-Host "Docker is ready." -ForegroundColor Green

# 2. Start Postgres + Redis containers
Write-Host "Starting Postgres + Redis containers..." -ForegroundColor Cyan
Push-Location "$root"
docker compose up -d postgres redis
Pop-Location

# 3. Free the API/Web ports if a stale dev server is still holding them
#    (avoids the classic EADDRINUSE from a previous run that didn't shut down cleanly)
Stop-Port $ApiPort "API"
Stop-Port $WebPort "Web"

# 4. Start NestJS API dev server in its own window
Write-Host "Starting NestJS API dev server (http://localhost:$ApiPort)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\apps\api'; npx nest start --watch"
)

# 5. Start Next.js web dev server in its own window
Write-Host "Starting Next.js web dev server (http://localhost:$WebPort)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\apps\web'; npm run dev"
)

# 6. Wait until both are actually answering requests before handing back control
$apiReady = Wait-ForHttp "http://localhost:$ApiPort/health" "API"
$webReady = Wait-ForHttp "http://localhost:$WebPort" "Web"

Write-Host ""
if ($apiReady -and $webReady) {
    Write-Host "Stack is up." -ForegroundColor Green
} else {
    Write-Host "Stack started, but one or more services aren't responding yet — check their windows for errors." -ForegroundColor Yellow
}
Write-Host "API:     http://localhost:$ApiPort" -ForegroundColor Green
Write-Host "Web:     http://localhost:$WebPort" -ForegroundColor Green
Write-Host "Health:  http://localhost:$ApiPort/health" -ForegroundColor Green
Write-Host "(Each dev server runs in its own PowerShell window. Run './run.ps1 -Stop' to shut everything down.)"
