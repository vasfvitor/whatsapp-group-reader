@echo off
setlocal
title WhatsApp Group Reader - feche esta janela para encerrar

set "PKG=%~dp0"
set "PUPPETEER_SKIP_DOWNLOAD=1"
set "NODE_ENV=production"
set "APP_DEV="

cd /d "%PKG%app" || (echo Pasta "app" nao encontrada. Extraia o zip completo antes de iniciar. & pause & exit /b 1)

echo Iniciando... o navegador vai abrir sozinho em alguns segundos.
echo NAO FECHE esta janela enquanto estiver usando o programa.
echo.

"%PKG%runtime\node.exe" dist\server\server\index.js
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo O programa terminou com erro ^(codigo %RC%^).
  echo Tire uma foto desta janela e envie para o suporte.
  pause
)
endlocal
