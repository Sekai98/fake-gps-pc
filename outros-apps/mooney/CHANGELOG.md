# Changelog — Step Tracker (Mooney integration)

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), SemVer.

Projeto independente do Fake GPS PC — tem versionamento próprio.

## [0.2.0] - 2026-10-04 - Autopilot + Health Connect injection (produto real)

Reescrita completa. PoC v0.1.x fica como ensaio no CHANGELOG mas o produto
começa aqui.

### Added
- **Mapa Leaflet** com marker azul (posição real do celular como partida)
- **3 presets de velocidade**: 🚶 5 km/h / 🏃 12 km/h / 🚴 20 km/h
- **Botão principal "▶ Andar até..."**: toca → modo seleção → clica no mapa → OSRM gera rota a pé → marker começa a andar sozinho na velocidade escolhida
- **Botão secundário "⚡ TP"**: teleporte instantâneo (NÃO gera passos)
- **Botão ⏸/▶**: pausa/retoma autopilot sem parar o service
- **StepTrackerService (foreground, type=health)**: updateLoop a 10Hz com MovementEngine + AutoPilot. A cada 30s, converte distância percorrida em passos (`metros / 0.7`) e injeta `StepsRecord` no Health Connect
- Notificação persistente com distância restante e km/h atual
- MainActivity simplificada: só checklist de permissões (localização, Health Connect, notificações) + botão "Abrir mapa" + contador do dia

### Reaproveitado do FakeGPS APK
- `MovementEngine.kt` (física do movimento)
- `AutoPilot.kt` (segue waypoints com cadência natural + slowdown no fim)
- `Routing.kt` (OSRM foot a pé seguindo ruas)
- `map.html` (WebView+Leaflet, UI adaptada pros botões novos)
- Padrão de bridge Android ↔ JS

### How it works
```
1. Abre app → autoriza permissões → "Abrir mapa"
2. Posição real do celular (FusedLocationProvider) salva como partida
3. Escolhe preset de velocidade
4. Clica "Andar até..." → modo seleção → clica no mapa
5. OSRM retorna rota a pé
6. Service entra em autopilot: a cada 100ms integra MovementEngine
7. A cada 30s: distância acumulada ÷ 0.7m/passo = N passos → insertRecords(StepsRecord)
8. Mooney (Health Connect integration) lê e conta
9. Chega no destino → autopilot para automático
```

### Design decisions
- **Health Connect foreground service type**: `health` (requisito Android 14+)
- **1 passo = 0.70m**: média do adulto. Pra 5 km/h = ~120 passos/min (realista walk)
- **Flush a cada 30s**: equilibra "cadência contínua" vs "spam de calls"
- **Teleport zera accumulatedMeters**: pulo não vira passos (intencional)
- **Pausa não gera passos**: speedMps vai pra 0 por falta de input
- **FusedLocationProvider** pra posição inicial (mais preciso que GPS puro)

### Not implemented yet
- Pedômetro WeWard próprio (lê sensor nativo, não Health Connect)
- Fitbit integration
- Direct API `push_step_record` do WeWard
- Horário ativo configurável
- Preset custom de velocidade

### Files
- EDIT `android-apk/app/build.gradle` (deps location + lifecycle-service; version 0.2.0 code 4)
- EDIT `android-apk/app/src/main/AndroidManifest.xml` (permissões, Service com type=health, MapActivity)
- CREATE `MovementEngine.kt` (porta do FakeGPS)
- CREATE `AutoPilot.kt` (porta do FakeGPS)
- CREATE `Routing.kt` (porta do FakeGPS)
- CREATE `StepTrackerService.kt` (service principal)
- CREATE `MapActivity.kt` (WebView host)
- OVERWRITE `MainActivity.kt` (nova UI com checklist de permissões)
- OVERWRITE `activity_main.xml`
- CREATE `activity_map.xml`
- CREATE `assets/map.html` (Leaflet + bridges)

## [0.1.2] - 2026-10-04 - Hotfix build: Gradle 8.9 no workflow (AGP 8.7 exige)

### Fixed
- Build quebrou no CI: `Minimum supported Gradle version is 8.9. Current version is 8.7.`
- AGP 8.7.2 (que subimos em v0.1.1) exige Gradle 8.9+ no runtime
- Fix: `.github/workflows/mooney-build.yml` → `gradle-version: '8.7'` → `'8.9'`

### Files
- EDIT `.github/workflows/mooney-build.yml` (Gradle 8.9)
- EDIT `outros-apps/mooney/android-apk/app/build.gradle` (versionCode 3, versionName 0.1.2)

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
