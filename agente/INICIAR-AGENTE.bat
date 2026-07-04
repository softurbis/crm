@echo off
title AGENTE URBIS - WhatsApp
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias del agente (solo la primera vez)...
  call npm install --no-audit --no-fund
)
if not exist .env (
  echo.
  echo FALTA EL ARCHIVO .env — copia .env.example como .env y completalo.
  pause
  exit /b
)
echo ============================================
echo   AGENTE URBIS iniciando...
echo   NO cierres esta ventana.
echo ============================================
node index.js
pause
