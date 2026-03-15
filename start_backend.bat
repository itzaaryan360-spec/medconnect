@echo off
:: MedConnect Flask Backend — Always-On Startup Script
:: Registered with Windows Task Scheduler to auto-start at login.
:: Auto-restarts if backend crashes.

title MedConnect Backend [:5000]
cd /d "%~dp0backend"

:RESTART
echo.
echo [%DATE% %TIME%] Starting MedConnect Backend on http://0.0.0.0:5000 ...
venv\Scripts\python.exe run_server.py >> server.log 2>&1
echo [%DATE% %TIME%] Backend stopped (exit %ERRORLEVEL%). Restarting in 3s...
timeout /t 3 /nobreak >nul
goto RESTART
