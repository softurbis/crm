@echo off
title Instalar / actualizar dependencias
cd /d "%~dp0"
echo ============================================
echo   Instalando dependencias (1-2 minutos)...
echo   Usar cuando Claude agregue librerias nuevas.
echo ============================================
call npm install
echo.
echo Listo!
pause
