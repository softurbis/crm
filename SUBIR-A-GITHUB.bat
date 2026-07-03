@echo off
title Subir cambios a GitHub
cd /d "%~dp0"
echo ============================================
echo   Subiendo Urbis Control a GitHub...
echo ============================================
if not exist ".git" (
  git init
  git branch -M main
  git remote add origin https://github.com/softurbis/crm.git
)
git config user.name "softurbis"
git config user.email "equipodetrabajourbis@gmail.com"
git add .
set /p MSG="Describe el cambio (Enter para 'avance'): "
if "%MSG%"=="" set MSG=avance
git commit -m "%MSG%"
git push -u origin main
echo.
echo Listo! Revisa https://github.com/softurbis/crm
pause
