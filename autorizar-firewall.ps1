# Rodado em PowerShell admin pelo iniciar.bat quando falta a regra.
# Cria regra inbound TCP na porta 3477 pro APK Android (modo slave) acessar via LAN.
Write-Host ""
Write-Host "  Criando regra de firewall FakeGPS 3477..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "FakeGPS 3477" `
                    -Direction Inbound `
                    -LocalPort 3477 `
                    -Protocol TCP `
                    -Action Allow | Out-Null
if ($?) {
    Write-Host "  [OK] Regra criada! Essa janela pode ser fechada." -ForegroundColor Green
} else {
    Write-Host "  [ERRO] Falhou ao criar regra." -ForegroundColor Red
}
Start-Sleep -Seconds 3
