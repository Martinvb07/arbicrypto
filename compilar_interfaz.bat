@echo off
title ArbiCrypto - compilar interfaz
cd /d "%~dp0web"
call npm install --no-audit --no-fund
call npm run build
echo.
echo Listo. Cierra y vuelve a abrir iniciar.bat
pause
