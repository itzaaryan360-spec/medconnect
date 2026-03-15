# MedLex Full-Stack Launcher (PowerShell)
# Run: .\start.ps1

$Host.UI.RawUI.WindowTitle = "MedLex Launcher"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND  = Join-Path $ROOT "backend"
$PYTHON   = Join-Path $BACKEND "venv\Scripts\python.exe"
$WATCHDOG = Join-Path $BACKEND "keep_alive.py"

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   MedLex  —  Full Stack Launcher" -ForegroundColor Cyan
Write-Host "   Backend  : http://localhost:5000  (auto-restart watchdog)" -ForegroundColor White
Write-Host "   Frontend : http://localhost:5173" -ForegroundColor White
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Validate Python venv ─────────────────────────────────────────────────────
if (-not (Test-Path $PYTHON)) {
    Write-Host "[ERROR] Python venv not found at: $PYTHON" -ForegroundColor Red
    Write-Host "Fix: cd backend; python -m venv venv; venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Validate npm ─────────────────────────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] npm not found. Install Node.js from https://nodejs.org" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Start Backend (Watchdog keeps it alive) ──────────────────────────────────
Write-Host "[1/2] Launching Backend Watchdog..." -ForegroundColor Green
$backendProc = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command", `
    "`$Host.UI.RawUI.WindowTitle='MedLex Backend'; & '$PYTHON' '$WATCHDOG'" `
    -PassThru

Start-Sleep -Seconds 3

# ── Start Frontend ───────────────────────────────────────────────────────────
Write-Host "[2/2] Launching Frontend (Vite)..." -ForegroundColor Green
$frontendProc = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command", `
    "`$Host.UI.RawUI.WindowTitle='MedLex Frontend'; Set-Location '$ROOT'; npm run dev" `
    -PassThru

Write-Host ""
Write-Host "  Both services started." -ForegroundColor Green
Write-Host "  Backend  → http://localhost:5000/api/health" -ForegroundColor Cyan
Write-Host "  Frontend → http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C here (or close the service windows) to stop." -ForegroundColor Gray
Write-Host ""

# ── Keep launcher alive until Ctrl+C ─────────────────────────────────────────
try {
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    if ($backendProc -and !$backendProc.HasExited)  { Stop-Process -Id $backendProc.Id  -Force -ErrorAction SilentlyContinue }
    if ($frontendProc -and !$frontendProc.HasExited) { Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "Done." -ForegroundColor Green
}
