@echo off
echo ============================================
echo   MedConnect — Public URL Launcher (ngrok)
echo ============================================
echo.

REM Check if ngrok is installed
where ngrok >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] ngrok not found. Downloading...
    echo     Go to https://ngrok.com/download and install ngrok,
    echo     OR run: winget install ngrok
    echo.
    echo     After installing, run: ngrok config add-authtoken YOUR_TOKEN
    echo     Get your free token at: https://dashboard.ngrok.com/get-started/your-authtoken
    echo.
    pause
    exit /b 1
)

echo [1/3] Starting backend (Flask on :5000)...
start "MedConnect Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\python.exe run_server.py"
timeout /t 3 /nobreak >nul

echo [2/3] Starting frontend (Vite on :5173)...
start "MedConnect Frontend" cmd /k "cd /d %~dp0 && npm run dev"
timeout /t 5 /nobreak >nul

echo [3/3] Opening ngrok tunnels...
echo.
echo  Backend public URL will appear below (copy it to VITE_BACKEND_URL in .env)
echo  Frontend public URL will be shown in a new window
echo.

REM Tunnel both ports
start "ngrok Frontend" cmd /k "ngrok http 5173 --log=stdout"
timeout /t 2 /nobreak >nul
ngrok http 5000 --log=stdout

pause
