@echo off
title Urbis Control
cd /d "%~dp0"
echo ============================================
echo   URBIS CONTROL - iniciando sistema...
echo   Cuando veas "Local: http://localhost:5173"
echo   abre esa direccion en tu navegador.
echo   NO cierres esta ventana mientras lo uses.
echo ============================================
call npm run dev
pause
