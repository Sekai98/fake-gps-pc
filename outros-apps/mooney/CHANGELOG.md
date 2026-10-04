# Changelog — Step Tracker (Mooney integration)

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), SemVer.

Projeto independente do Fake GPS PC — tem versionamento próprio.

## [0.3.1] - 2026-10-04 - Service persistente (sobrevive sair do app)

### Fixed
- **Service parava quando o user saía do app**: autopilot parava, mock GPS parava de reportar, rota era abandonada.
- **Causa raiz:** `onStartCommand` retornava `START_NOT_STICKY` — se Android/MuMu matasse o service (fora de memória, bg kill agressivo), não era recriado.
- **Fix:** retorna `START_STICKY`. Se o sistema matar o service, Android recria automaticamente passando `intent = null`.

### Added — Auto-recovery
Quando `onStartCommand` é chamado com `intent = null` (restart automático pelo Android):
- Lê posição persistida (`KEY_LAT`/`KEY_LON`) e chama `start()`
- Lê waypoints da rota ativa persistidos (`KEY_ACTIVE_ROUTE`) e aplica no autopilot
- Lê flag de pausa persistida (`KEY_PAUSED`)
- Lê heading persistido (`KEY_HEADING`)

### Added — Novas chaves persistidas
- `KEY_ACTIVE_ROUTE` (JSON array de waypoints) — gravado em `handleSetRoute`, limpo em `teleport`/`stop`/quando autopilot termina
- `KEY_PAUSED` — gravado em `handlePause`/`handleResume`
- `KEY_HEADING` — gravado todo tick do `persistPosition()`

### Behavior rules
- **`ACTION_STOP` explícito do user** limpa a rota — não auto-recupera no próximo start
- **Teleport** cancela a rota — mesma lógica
- **Autopilot termina naturalmente** (chegou no destino) → `persistPosition()` percebe `!autopilot.isActive()` e limpa `KEY_ACTIVE_ROUTE`

### Files
- EDIT `android-apk/app/src/main/java/com/stepinjector/StepTrackerService.kt`
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml` (label versão)
- EDIT `android-apk/app/build.gradle` (versionCode 7→8, versionName 0.3.0→0.3.1)

## [0.3.0] - 2026-10-04 - Mock GPS: Android reporta localização falsa

Mudança de arquitetura. Agora o Step Tracker **não é só injetor de passos** — é injetor combinado: mock location (igual FakeGPS APK) + passos no Health Connect. Isso torna o movimento consistente pra qualquer app que compare GPS vs passos (antifraud).

### Added
- Permissão `ACCESS_MOCK_LOCATION` (com `tools:ignore` pra lint)
- Permissão `FOREGROUND_SERVICE_LOCATION`
- `foregroundServiceType="location"` no service
- `StepTrackerService.setupMockProvider()`: registra GPS_PROVIDER + NETWORK_PROVIDER como test providers (igual FakeGPS)
- `publishMockLocation()`: a cada tick (10Hz) chama `setTestProviderLocation()` com lat/lon/speed/bearing do engine
- `teardownMockProvider()`: unregister ao parar o service
- MainActivity: linha "Mock GPS configurado" no checklist + botão "Abrir Opções de Desenvolvedor" (`Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS`)
- Detecção automática: tenta `addTestProvider` + `removeTestProvider`; se der SecurityException = user ainda não configurou "App de localização simulada" nas Opções de Dev
- Instrução no texto de ajuda: como ativar Opções de Dev (toque 7x em Número da versão)

### Removed
- Permissão `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (não precisamos — foreground service type=location sozinho já tem exceção)
- Permissão `FOREGROUND_SERVICE_HEALTH` (service type agora é location)
- Linha "Bateria" no checklist + código de battery exemption

### Why remove battery exemption
Foreground services com `foregroundServiceType="location"` já têm isenção especial do Android pra rodar em background enquanto há notificação ongoing. A permissão `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` era redundante dado esse tipo.

### Pré-requisito do user (setup único)
1. Settings → Sobre o telefone → toque 7x em "Número da versão"
2. Settings → Sistema → Opções de desenvolvedor → "App de localização simulada" → Step Tracker

Depois disso, o botão `btnOpenMap` só habilita quando mock + localização + health + notif estão todos OK.

### Files
- EDIT `android-apk/app/src/main/AndroidManifest.xml`
- EDIT `android-apk/app/src/main/java/com/stepinjector/StepTrackerService.kt`
- EDIT `android-apk/app/src/main/java/com/stepinjector/MainActivity.kt`
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml`
- EDIT `android-apk/app/build.gradle` (versionCode 6→7, versionName 0.2.2→0.3.0)

## [0.2.2] - 2026-10-04 - Marker em tempo real + battery exemption

### Fixed
- **Marker azul do mapa não andava em tempo real.** `StepTrackerService.persistPosition()` só era chamado em start/stop/teleport — nunca durante o updateLoop. Mapa pollava `getCurrentPosition()` a cada 1s mas lia sempre o valor congelado nas SharedPreferences.
- **Fix:** persistência da posição a cada 500ms dentro do updateLoop (constante `PERSIST_INTERVAL_MS`), coerente com o polling de 1s do mapa.

### Added
- Permissão `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` no manifest
- Botão "Desligar otimização de bateria" na MainActivity que abre o diálogo do sistema (via `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`)
- Linha "Bateria" no checklist de permissões — detecta via `PowerManager.isIgnoringBatteryOptimizations()`
- Aviso sobre autostart em fabricantes chineses (Xiaomi/Oppo/Huawei/Realme) no texto de ajuda

### Design decision
- Bateria **não bloqueia** o botão "Abrir mapa" — é opcional. Sem exemption, o app funciona enquanto a tela estiver ligada e o mapa aberto. Com exemption, pode rodar com tela bloqueada no bolso.

### Files
- EDIT `android-apk/app/src/main/java/com/stepinjector/StepTrackerService.kt` (persistência throttled 500ms no loop)
- EDIT `android-apk/app/src/main/AndroidManifest.xml` (permissão REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
- EDIT `android-apk/app/src/main/java/com/stepinjector/MainActivity.kt` (checagem + botão)
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml` (TextView + Button de bateria; nota autostart)
- EDIT `android-apk/app/build.gradle` (versionCode 5→6, versionName 0.2.1→0.2.2)

## [0.2.1] - 2026-10-04 - Hotfix build: `?` no XML quebra AAPT

### Fixed
- Build quebrou no CI: `AAPT: error: resource attr/ Localização not found`
- Causa: no XML Android, `?` no início de texto é parseado como referência de attr de tema (`?attr/...`). Os placeholders `"? Localização"` / `"? Health Connect"` / `"? Notificações"` em `activity_main.xml` disparavam AAPT linking error.
- Fix: trocar `?` por `○` (círculo neutro) — mesmo visual de "pendente" sem conflito com sintaxe de attr reference.

### Files
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml` (`?` → `○` em 3 TextViews; versão exibida 0.2.0→0.2.1)
- EDIT `android-apk/app/build.gradle` (versionCode 4→5, versionName 0.2.0→0.2.1)

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
