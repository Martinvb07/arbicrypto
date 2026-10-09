@echo off
title ArbiCrypto
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"
echo Revisando dependencias...
"%PY%" -m pip install -q --disable-pip-version-check -r backend\requirements.txt
if not exist "web\out\index.html" (
  echo Preparando la interfaz por primera vez, tarda un par de minutos...
  pushd web
  call npm install --no-audit --no-fund
  call npm run build
  popd
)
cd backend
set "EXTRA="
:loop
"%PY%" app.py %* %EXTRA%
if errorlevel 3 goto fin
echo.
echo   El panel se detuvo. Se reinicia solo en 5 segundos (cierra esta ventana para apagarlo)...
timeout /t 5 /nobreak >nul
set "EXTRA=--no-browser"
goto loop
:fin
pause
