#!/usr/bin/env pwsh
<#
  Starts the full Messenger App stack:
    - Docker Desktop (Postgres + Redis containers)
    - NestJS API dev server  (http://localhost:4000)
    - Next.js web dev server (http://localhost:3100)

  Usage: ./run.ps1
#>

$root = $PSScriptRoot

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

# 3. Start NestJS API dev server in its own window
Write-Host "Starting NestJS API dev server (http://localhost:4000)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\apps\api'; npx nest start --watch"
)

# 4. Start Next.js web dev server in its own window
Write-Host "Starting Next.js web dev server (http://localhost:3100)..." -ForegroundColor Cyan
Start-Process pwsh -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$root\apps\web'; npm run dev"
)

Write-Host ""
Write-Host "API:     http://localhost:4000" -ForegroundColor Green
Write-Host "Web:     http://localhost:3100" -ForegroundColor Green
Write-Host "Health:  http://localhost:4000/health" -ForegroundColor Green
Write-Host "(Each dev server is running in its own PowerShell window. Close those windows to stop them.)"
