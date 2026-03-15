@echo off
title MedLex Launcher
color 0A

echo.
echo  ============================================================
echo   MedLex  —  Full Stack Launcher
echo   Backend  : http://localhost:5000  (auto-restart enabled)
echo   Frontend : http://localhost:5173
echo  ============================================================
echo.

:: ── Resolve paths ────────────────────────────────────────────────────────────
SET ROOT=%~dp0
SET BACKEND_DIR=%ROOT%backend
SET PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe
SET WATCHDOG=%BACKEND_DIR%\keep_alive.py
SET FRONTEND_DIR=%ROOT%

:: ── Check Python venv ────────────────────────────────────────────────────────
IF NOT EXIST "%PYTHON%" (
    echo [ERROR] Python venv not found at: %PYTHON%
    echo Run: cd backend ^&^& python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: ── Check Node / npm ─────────────────────────────────────────────────────────
where npm >nul 2>&1
IF ERRORLEVEL 1 (
    echo [ERROR] npm not found. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

echo [1/2] Starting Backend (Keep-Alive Watchdog)...
start "MedLex Backend" cmd /k "title MedLex Backend ^& color 0B ^& \"%PYTHON%\" \"%WATCHDOG%\""

:: Short delay to let backend initialise before frontend starts
timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (Vite Dev Server)...
start "MedLex Frontend" cmd /k "title MedLex Frontend ^& color 0E ^& cd /d \"%FRONTEND_DIR%\" ^& npm run dev"

echo.
echo  Both services are starting in separate windows.
echo  Backend  → http://localhost:5000/api/health
echo  Frontend → http://localhost:5173
echo.
echo  Close those windows (or press Ctrl+C inside them) to stop.
pause
