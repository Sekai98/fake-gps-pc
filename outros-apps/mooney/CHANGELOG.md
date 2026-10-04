# Changelog — Step Tracker (Mooney integration)

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), SemVer.

Projeto independente do Fake GPS PC — tem versionamento próprio.

## [0.1.1] - 2026-10-04 - Hotfix build: AGP 8.7 + compileSdk 35

### Fixed
- Build quebrou no CI: `health-connect-client:1.1.0-alpha11` exige `compileSdk 35+`
- Fix: AGP `8.5.0` → `8.7.2` (suporta Android 15); `compileSdk` `34` → `35`
- `targetSdk` mantido em `34` (comportamento Android 14 continua, só o SDK de compilação sobe)

### Files
- EDIT `outros-apps/mooney/android-apk/build.gradle` (AGP 8.7.2)
- EDIT `outros-apps/mooney/android-apk/app/build.gradle` (compileSdk 35, versionCode 2, versionName 0.1.1)

## [0.1.0] - 2026-10-03 - PoC inicial

### Added
- Scaffold Android em `outros-apps/mooney/android-apk/`
- Permissões Health Connect: `android.permission.health.READ_STEPS` + `WRITE_STEPS`
- UI mínima: botão "Injetar 1000 passos AGORA" + status + total do dia
- Integração com Health Connect SDK (`androidx.health.connect:connect-client:1.1.0-alpha11`)
- Package `com.stepinjector`, label genérico "Step Tracker"
- GitHub Actions workflow `.github/workflows/mooney-build.yml` pra CI build
- `outputFileName` versionado: `StepTracker-0.1.0-debug.apk`
- Checagem automática de disponibilidade de Health Connect (mostra mensagem se não instalado)

### Design decisions
- Min SDK 28 (Android 10) por requisito do Health Connect
- Target SDK 34 (Android 14)
- Kotlin + AndroidX only, viewBinding desligado pra manter APK leve
- Zero service background nesta versão — tudo manual (botão único)
- Package genérico (`com.stepinjector`) e label "Step Tracker" pra reduzir sinal pra anti-cheat baseado em string match

### Goal
Validar 2 coisas:
1. `healthConnectClient.insertRecords(listOf(StepsRecord(...)))` funciona
2. Mooney (ou Weward com Google Fit) lê e conta os passos injetados

Se validar: v0.2.0 vai ter service background + loop natural com variação humana.
