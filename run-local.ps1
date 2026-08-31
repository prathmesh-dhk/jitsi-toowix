# ==============================================================================
# Toowix Meet — 1-Click Local Dev Server Launcher (PowerShell)
# ==============================================================================

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Starting Toowix Meet Local Dev Server      " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# Ensure Node and Git are in PATH for current session
$env:PATH = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\usr\bin;" + $env:PATH

# 1. Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "==> Installing dependencies with npm install..." -ForegroundColor Yellow
    npm install
}

# 2. Run assets and styles preparation
Write-Host "==> Preparing CSS and assets..." -ForegroundColor Yellow
if (Get-Command bash.exe -ErrorAction SilentlyContinue) {
    bash.exe ./prepare-dev.sh
} else {
    & "C:\Program Files\Git\bin\bash.exe" ./prepare-dev.sh
}

# 3. Start Webpack Dev Server
Write-Host "==> Launching Webpack Dev Server on https://localhost:8080..." -ForegroundColor Green
npx webpack serve --mode development
