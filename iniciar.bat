@echo off
setlocal enabledelayedexpansion
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
echo  Enderecos LAN deste PC ^(use no APK Android, modo slave^):
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or ($_.IPAddress -like '10.*' -and $_.PrefixOrigin -ne 'WellKnown') } | ForEach-Object { Write-Host ('    http://' + $_.IPAddress + ':3477') }"
echo.

echo  Verificando regra de firewall...
powershell -NoProfile -Command "if (Get-NetFirewallRule -DisplayName 'FakeGPS 3477' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo  [!] Regra "FakeGPS 3477" nao existe. Sem ela, o APK no celular
  echo      nao consegue conectar neste PC.
  echo.
  set /p AUTORIZAR="  Autorizar agora? [S/N] "
  if /i "!AUTORIZAR!"=="S" (
    echo.
    echo  Vai aparecer um prompt do UAC pedindo autorizacao de admin.
    echo  Clique Sim pra criar a regra.
    powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0autorizar-firewall.ps1'"
    echo.
    echo  Aguarde a janela admin fechar e continue...
    timeout /t 5 >nul
  ) else (
    echo  [AVISO] Firewall nao autorizado. APK remoto nao vai conectar
    echo          ate voce rodar o iniciar.bat de novo e autorizar.
  )
) else (
  echo  [OK] Firewall liberado
)
echo.

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
