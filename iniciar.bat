@echo off
chcp 65001 >nul
title Fake GPS PC - Iniciar
cd /d "%~dp0"

echo.
echo  ========================================
echo    FAKE GPS PC - v0.1.0
echo  ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] Node.js nao encontrado!
  echo.
  echo  Instale em: https://nodejs.org/  ^(versao LTS recomendada^)
  echo  Depois reabra esse arquivo.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo  [OK] Node %NODE_VERSION%

if not exist "node_modules\" (
  echo.
  echo  [...] Primeira execucao - instalando dependencias.
  echo        Isso pode levar 1-2 minutos ^(baixa Electron, ~80MB^).
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERRO] Falha ao instalar dependencias.
    echo         Verifique sua conexao e rode de novo.
    pause
    exit /b 1
  )
) else (
  echo  [OK] Dependencias instaladas
)

echo.
echo  Iniciando Fake GPS PC...
echo  ^(feche a janela do app pra encerrar^)
echo.

call npm start

if errorlevel 1 (
  echo.
  echo  [ERRO] Falha ao iniciar o app.
  pause
)
