# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), SemVer.

## [0.2.0-alpha6.1] - 2026-10-02 (Android APK) - Hotfix: permitir HTTP cleartext (modo slave)

### Fixed
- `android:usesCleartextTraffic="true"` no AndroidManifest. Sem isso, Android 9+ bloqueia qualquer conexão HTTP não-HTTPS, incluindo `http://192.168.X.Y:3477` do modo slave. Erro silencioso que impedia o "Testar" de funcionar.

### Files
- EDIT `android-apk/app/src/main/AndroidManifest.xml` (usesCleartextTraffic)
- EDIT `android-apk/app/build.gradle` (versionCode 7, versionName 0.2.0-alpha6.1)

## [infra] - 2026-10-02 (Android APK CI) - Nome do APK e artifact incluem versão

### Changed
- `android-apk/app/build.gradle`: `applicationVariants.all` configura `outputFileName` como `FakeGPS-${versionName}-${buildType}.apk` (ex: `FakeGPS-0.2.0-alpha6-debug.apk`) em vez de `app-debug.apk`.
- `.github/workflows/android-build.yml`: extrai `versionName` do build.gradle e usa como sufixo do artifact name: `fake-gps-apk-0.2.0-alpha6.zip` em vez de `fake-gps-apk.zip`.

### Why
- Facilita separar APKs baixados: cada alpha fica com nome único.

## [0.2.0-alpha6] - 2026-10-02 (Android APK) - Modo slave (controle pelo Fake GPS Electron)

### Added - Modo slave
- APK pode operar como **executor remoto** controlado pelo Fake GPS Electron (PC). Fluxo:
  1. User inicia o Fake GPS Electron no PC (server HTTP já está em `0.0.0.0:3477`)
  2. Na MainActivity do APK, preenche **URL do Electron** (ex: `http://192.168.0.100:3477`) e opcionalmente **Tab** (ex: `tab-1`)
  3. Toca **"Iniciar slave"** - APK passa a fazer poll a 10Hz no endpoint `/location[?tab=X]` do PC
  4. APK aplica `lat/lon/heading/speedMps` recebidos no mock location (GPS + NETWORK providers)
  5. Chrome mobile lê posição falsa controlada pelo PC
- Benefícios:
  - UX de controle do PC (mouse, mapa grande, autopilot, rotas, teleporte)
  - Precisão alta: APK aplica EXATAMENTE o que o Electron manda (sem drift do engine local)
  - Mesmo modo stand-alone continua funcional - novo botão não substitui o antigo
- Botão **"Testar"** faz GET `/health` do Electron pra validar conexão antes de iniciar
- Notificação em modo slave mostra: `SLAVE - controlado pelo PC` + URL + km/h. Se perder conexão (3s sem resposta), muda pra `SLAVE - sem conexão` com motivo
- Em modo slave o overlay flutuante fica dim (joystick e presets desabilitados visualmente); drag handle ⋮⋮ continua funcional pra mover o overlay

### Added - Internals
- `FakeGPSService.ACTION_START_SLAVE` + extras `EXTRA_SLAVE_URL`, `EXTRA_SLAVE_TAB`
- `slavePollLoop` roda em thread executor separado pra não bloquear o main thread com HTTP
- `MovementEngine.heading` e `speedMps` setados direto pelo poll (bypass da física local)
- URL/Tab persistidos em SharedPreferences entre aberturas

### Files
- EDIT `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt` (slaveMode, slavePollLoop, pollOnce, notif slave)
- EDIT `android-apk/app/src/main/java/com/fakegps/MainActivity.kt` (card de slave: URL/Tab/testar/iniciar)
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml` (seção MODO SLAVE)
- EDIT `android-apk/app/build.gradle` (versionCode 6, versionName 0.2.0-alpha6)

### Notes
- Precisa que PC e celular estejam na **mesma rede WiFi**.
- Firewall do Windows pode bloquear - se "Testar" der timeout, autorizar o Node no firewall privado.
- Pra descobrir o IP do PC: no Electron, botão "📡 Sensor remoto" mostra IP(s) da LAN. Usar a mesma, trocando porta 3443 (HTTPS do sensor) por **3477** (HTTP do /location).

## [0.2.0-alpha5] - 2026-10-02 (Android APK) - Fixes: joystick travado, mapa estático, precisão

### Fixed
- **Joystick preso em modo mover**: `dragModeActive` persistia entre aberturas do overlay — se o toggle estivesse ligado quando o service foi reiniciado, o joystick não respondia. Agora o estado é resetado pra `false` toda vez que `showOverlay` roda.
- **Marker azul do mapa interno não acompanhava o personagem**: adicionado bridge `Android.getCurrentPosition()` + poll JS a 1Hz que lê a posição persistida das SharedPreferences e move o marker. `PERSIST_INTERVAL_MS` reduzido de 5000ms pra 1000ms pra o marker ficar fresco.

### Changed - Precisão
- Mock location agora cobre **GPS_PROVIDER + NETWORK_PROVIDER** (Chrome Android às vezes prefere o network). Antes era só GPS.
- Push rate: 10Hz → **20Hz** (`UPDATE_INTERVAL_MS` 100 → 50).
- `accuracy` reportado: 5m → 2m (sinaliza fonte confiável pro Chrome).
- `bearingAccuracyDegrees` 5° → 1°, `speedAccuracyMetersPerSecond` 1 → 0.5, `verticalAccuracyMeters` 10 → 3.

### Files
- EDIT `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt` (PROVIDERS list, 20Hz, reset dragMode, accuracy)
- EDIT `android-apk/app/src/main/java/com/fakegps/MapActivity.kt` (bridge getCurrentPosition)
- EDIT `android-apk/app/src/main/assets/map.html` (poll 1s do marker)
- EDIT `android-apk/app/build.gradle` (versionCode 5, versionName 0.2.0-alpha5)

### Notes
- Se a precisão ainda estiver abaixo do esperado, o gargalo pode estar no FusedLocationProvider do Google Play Services (que agrega múltiplos sinais e nem sempre respeita o test provider). Esse caso requer approach diferente — provavelmente injetar via `android.location.LocationManager.FUSED_PROVIDER` que exige targetSdk >= 31 e permissões especiais.

## [0.2.0-alpha4] - 2026-10-02 (Android APK) - Mapa + autopilot + notif dinâmica + toggle drag

### Added
- **Mapa interno** (nova `MapActivity`): WebView carregando Leaflet com tiles OSM. Dois modos:
  - **TP** (default): toque teleporta imediatamente pra posição.
  - **Andar sozinho**: toque busca rota a pé via OSRM (`routing.openstreetmap.de/routed-foot`) e inicia autopilot no `FakeGPSService`. Rota desenhada em laranja no mapa.
- **AutoPilot** (`AutoPilot.kt`): porta da lógica do Electron. Avança waypoints, slowdown nos últimos 15m, respeita a velocidade do preset ativo (walk/run/car).
- **Routing** (`Routing.kt`): porta OSRM foot com prefixo/sufixo em linha reta pra chegar no ponto exato clicado.
- **Notificação dinâmica**: durante rota ativa mostra `X.XX km restantes - Y.Y km/h` e atualiza 1x/s. Ações:
  - `Parar rota` (cancela autopilot, deixa overlay)
  - `Joystick` (reabre overlay se foi fechado via ✕ sem derrubar o serviço)
  - `Parar app` (desliga tudo)
- **Toggle drag** no overlay: botão `⋮⋮` virou toggle. OFF = comportamento normal; ON = joystick fica dim e todo o overlay pode ser arrastado pela tela.
- Novas actions no `FakeGPSService`: `ACTION_SET_ROUTE`, `ACTION_STOP_ROUTE`, `ACTION_TELEPORT`, `ACTION_SHOW_OVERLAY`.
- Permissão `INTERNET` adicionada (Leaflet CDN + tiles OSM + OSRM).

### Files
- CREATE `android-apk/app/src/main/java/com/fakegps/AutoPilot.kt`
- CREATE `android-apk/app/src/main/java/com/fakegps/Routing.kt`
- CREATE `android-apk/app/src/main/java/com/fakegps/MapActivity.kt`
- CREATE `android-apk/app/src/main/assets/map.html`
- CREATE `android-apk/app/src/main/res/layout/activity_map.xml`
- EDIT `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt` (actions, autopilot wire, notif dinâmica, toggle drag, overlay persist, autopilot prioriza joystick)
- EDIT `android-apk/app/src/main/java/com/fakegps/MainActivity.kt` (botão "Abrir mapa")
- EDIT `android-apk/app/src/main/res/layout/activity_main.xml` (btn_map)
- EDIT `android-apk/app/src/main/AndroidManifest.xml` (INTERNET, MapActivity)
- EDIT `android-apk/app/build.gradle` (versionCode 4, versionName 0.2.0-alpha4)

### Notes
- Autopilot usa a velocidade do preset selecionado no joystick (walk 5 / run 12 / car 50 km/h). Trocar o preset enquanto a rota está ativa altera a velocidade imediatamente.
- `publishMockLocation` roda a 10Hz (igual Electron), notif atualiza a 1Hz pra não ficar reescrevendo texto rápido demais.
- APK continua **independente** do Fake GPS PC; não precisa do Electron rodando.

## [0.2.0-alpha3] - 2026-10-02 (Android APK) - Persistência de posição + joystick arrastável

### Added
- **Persistência de lat/lon**: `FakeGPSService` salva a posição atual em `SharedPreferences` ao parar e a cada 5s. Ao reabrir o app, a última posição é restaurada (não cai mais em Av. Paulista fixo).
- **Drag handle no overlay**: novo botão `⋮⋮` no cabeçalho do joystick permite arrastar o overlay inteiro pela tela. Posição salva em `SharedPreferences` ao soltar.
- `MovementEngine.setPosition(lat, lon)` adicionado (prep pra teleporte via mapa na alpha5).

### Files
- EDIT `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt` (SharedPreferences lat/lon/overlay_x/y, persistLoop, attachDrag)
- EDIT `android-apk/app/src/main/java/com/fakegps/MovementEngine.kt` (setPosition)
- EDIT `android-apk/app/src/main/res/layout/overlay_joystick.xml` (drag_handle)
- EDIT `android-apk/app/build.gradle` (versionCode 3, versionName 0.2.0-alpha3)

### Notes
- APK é **independente** do Fake GPS do PC; não requer o servidor Electron.
- Próximas alphas: ação na notificação pra reabrir joystick sem voltar no app (alpha4), mapa clicável dentro do app (alpha5).

## [0.1.12] - 2026-10-01 (Electron) - Prep multi-abas

### Changed - Refatoracao interna (nao visivel pro user)
Core convertido pra **factory functions** em preparacao pra v0.2.0 (multi-abas). API global mantida como instance default pra compatibilidade.

| Modulo | Factory novo | Instance default (compat) |
|--------|--------------|--------------------------|
| `movement.js` | `createMovement(options)` | `FakeGPS.Movement` |
| `autopilot.js` | `createAutoPilot()` | `FakeGPS.AutoPilot` |
| `route-planner.js` | `createRoutePlanner({storageKey})` | `FakeGPS.RoutePlanner` |
| `crates.js` | `createCrates()` | `FakeGPS.Crates` |
| `persistence.js` | `createPersistence({storageKey})` | `FakeGPS.Persistence` |
| `map.js` | `createMap({containerId})` | `FakeGPS.Map` (container `#map`) |

Cada instance tem `destroy()` pra limpeza quando a aba fechar.

### Preserved
- UI identica ao v0.1.11.7
- Estados persistidos (localStorage) mantidos
- Zero breaking change pro user

### Backup
- Tag git `v0.1.11.6-stable` criada antes da refatoracao (git checkout v0.1.11.6-stable pra voltar)

## [0.1.11.7] - 2026-10-01 (Electron)

### Fixed - ETA mais robusto
- `updateETA` agora defensivo:
  - Valida que `speedoEta`, `AutoPilot.isActive` e `getRemainingDistanceMeters` existem antes de chamar
  - Clampa `maxKmh > 0` pra evitar divisao por zero
  - `formatETA` nunca retorna string vazia (fallback `'--:--'` garantido)
- Novo estado: `⏱ chegando` quando `etaSeconds < 1` (ate 1 seg do destino)
- `formatETA` aceita `seconds < 0` como invalido (retorna `--:--` em vez de bug matematico)

### Added - Debug opcional
- Setando `window.__fakegps_eta_debug = true` no console, cada tick loga `{active, remainingMeters, maxKmh, etaSeconds, formatted}` - pra diagnosticar quando ETA parecer travado

### Files
- EDIT `src/renderer/app.js` (updateETA + formatETA defensivos)
- EDIT bump versao em todos arquivos

## [0.1.11.6] - 2026-10-01 (Electron)

### Changed
- **Sensibilidade do drag do celular 3D reduzida pra ficar mais suave**:
  - Beta (dy drag): `0.3` → **`0.12`** (60% mais lento)
  - Gamma (dx drag): `0.2` → **`0.08`** (60% mais lento)
  - Alpha (Shift+drag): `0.3` → **`0.1`** (66% mais lento)
- Permite ajuste mais fino com o mouse. Sliders continuam com step 1° (ajuste granular).

### Files
- EDIT `src/renderer/app.js` (3 valores de sensibilidade no handler de mousemove do drag)
- EDIT bump versao em todos arquivos

## [0.1.11.5] - 2026-10-01 (Electron)

### Fixed - CRITICO: Extension bloqueada por Private Network Access
- **Chromium v117+ bloqueia requests de https:// pra localhost** sem header de permissao especifica
- Sintoma: `Access to fetch at 'http://127.0.0.1:3477/health' from origin 'https://gocollect.fun' has been blocked by CORS policy: Permission was denied for this request to access the loopback address space`
- Resultado: extensao nao conseguia pegar coords do Electron, usava fallback estatico (Paulista)
- **Fix**: `src/server.js` passa a enviar header `Access-Control-Allow-Private-Network: true` em todas as responses (inclusive preflight OPTIONS)
- Tambem: `Access-Control-Request-Private-Network` adicionado aos headers permitidos
- Por que funcionava antes: provavelmente perfil antigo ja tinha cache de permissao, perfil novo nao

### Files
- EDIT `src/server.js` (headers PNA + /health responde com nova versao)
- EDIT bump versao em todos arquivos

## [0.1.11.4] - 2026-10-01 (Electron)

### Added
- **ETA (tempo estimado) ate o destino da rota** no painel VELOCIMETRO, embaixo do "max N":
  - Format: `⏱ --:--` quando autopilot inativo; `⏱ 2min 15s` ou `⏱ 1h 23min` quando ativo
  - Calcula distancia restante (ponto atual → waypoint atual + segmentos restantes) ÷ velocidade max do preset × 3600
  - Fica verde quando ativo (classe `.active`)
  - Atualiza a 60Hz no tick loop

### Technical
- `autopilot.js`: nova funcao `getRemainingDistanceMeters(lat, lon)` exportada - soma distancia atual→proximo + segmentos restantes
- `app.js`: `formatETA(seconds)` + `updateETA(lat, lon)` + chamada no tick loop
- `index.html`: `#speedo-eta` dentro de `.speedometer-panel`
- `styles.css`: `.speedo-eta` + `.speedo-eta.active`

### Files
- EDIT `src/renderer/autopilot.js` (getRemainingDistanceMeters + export)
- EDIT `src/renderer/index.html` (speedo-eta element + versao)
- EDIT `src/renderer/styles.css` (.speedo-eta styles)
- EDIT `src/renderer/app.js` (speedoEta ref + formatETA + updateETA + call no tick)
- EDIT bump versao em todos arquivos restantes

## [0.1.11.3] - 2026-10-01 (Electron)

### Removed
- **Reducao de velocidade em curvas durante autopilot** (feature introduzida na v0.1.8.4):
  - Antes: autopilot calculava angulo entre segmentos e reduzia magnitude pra 35-100% da velocidade max
  - Agora: velocidade constante durante autopilot. Oscilacao natural de +/- 1 km/h continua ativa (movement.js config.variationKmh)
- Campo "Freada em curva" removido do modal Config do Carro (⚙ do preset)
- `curveSlowdownMin` removido do CarConfig schema

### Kept
- **Aproximacao ao destino final**: ultimos 15m ainda freiam gradualmente ate 25% da velocidade max (pra nao parar brusco)
- **Oscilacao natural +/-1 km/h**: ja existia em `movement.js` (variationKmh=1.0, variationIntervalMs=1000, variationLerpRate=2.0). Independente de humanidade/autopilot.

### Technical
- `autopilot.js`: `curveSlowdownFactor()` e `turnAngleDeg()` continuam existindo (dead code preservado por simplicidade), mas `computeInput` nao chama mais - `magnitude = 1` fixo
- `app.js`: `carFields` sem `curveSlowdownMin`; `fillCarForm` e `saveCarConfig` idem
- `index.html`: removida a row do input `car-curveSlowdownMin`

### Files
- EDIT `src/renderer/autopilot.js` (remove chamada de `curveSlowdownFactor` em computeInput)
- EDIT `src/renderer/index.html` (remove row + bump versao)
- EDIT `src/renderer/app.js` (sem `curveSlowdownMin` em carFields + bump versao log)
- EDIT bump versao em todos arquivos restantes

## [0.2.0-alpha2] - 2026-10-01 (Android APK)

### Added
- **3 presets de velocidade no overlay**: 🚶 Walk 5 km/h, 🏃 Run 12 km/h, 🚗 Car 50 km/h
  - Botao ativo fica azul, inativos cinza
  - Click muda `engine.maxSpeedKmh` em tempo real
  - Preset selecionado persiste em SharedPreferences (`fakegps.preset`)
- **Label de velocidade atual** abaixo do joystick: "N.N km/h" com cor progressiva
  - Verde < 60% da max
  - Amarelo 60-90%
  - Vermelho >= 90%
  - Atualiza a 10Hz (mesmo loop do mock location)

### Technical
- `overlay_joystick.xml`: FrameLayout -> LinearLayout vertical (3 secoes: presets, joystick+close, label)
- `FakeGPSService`: `applyPreset(name)` + `updateSpeedLabel()` + lista `presets` com (nome, kmh, lazy view ref)
- SharedPreferences `fakegps` guarda o preset selecionado

### Files
- EDIT `android-apk/app/src/main/res/layout/overlay_joystick.xml`
- EDIT `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt`
- EDIT `android-apk/app/build.gradle` (versionCode 2, versionName 0.2.0-alpha2)

## [0.2.0-alpha1] - 2026-10-01 (Android APK)

### Added - Novo projeto Android APK: joystick flutuante + mock location
- **Arquitetura refeita** (versao WebView inicial foi descartada):
  - App roda em **background** como Foreground Service
  - **Joystick flutuante** aparece sobre qualquer app (uses SYSTEM_ALERT_WINDOW)
  - **Mock Location API nativa** do Android (setTestProviderLocation)
  - Usuario abre gocollect.fun no **Chrome/Brave normal** do celular - nao mais dentro de WebView
- `MainActivity.kt`: launcher que valida 4 permissoes e inicia/para o service
  - ACCESS_FINE_LOCATION (runtime)
  - POST_NOTIFICATIONS (runtime, Android 13+)
  - SYSTEM_ALERT_WINDOW (manual via Settings)
  - "App de localizacao simulada" (manual via Dev Options)
- `FakeGPSService.kt`: Foreground Service com:
  - Register/unregister test provider (GPS_PROVIDER)
  - Loop 10Hz: engine.update(dt, joystick) -> setTestProviderLocation
  - WakeLock PARTIAL_WAKE_LOCK pra sobreviver com tela apagada
  - Notification persistente com acao "Parar"
- `JoystickOverlayView.kt`: View custom
  - Fundo circular + knob interno arrastavel
  - Reporta input {x, y, magnitude, heading} via callback
  - Heading cartografico: 0=Norte, 90=Leste (CW, bate com GPS real)
- `MovementEngine.kt`: porta de `src/renderer/movement.js`
  - Lat/lon integra do input a cada tick
  - Rampa de aceleracao: `accelTime = 0.3 + kmh/15` (mesma formula do Electron)
  - maxSpeedKmh default 5 (walking)
- `AndroidManifest.xml`: 7 permissoes + service declarado com `foregroundServiceType=location`
- Layouts: `activity_main.xml` (tela inicial com botoes de permissao + start/stop) + `overlay_joystick.xml` (joystick + botao fechar)
- GitHub Actions workflow em `.github/workflows/android-build.yml` compila APK debug a cada push em `android-apk/**`

### Pipeline de desenvolvimento
- **alpha1 (agora)**: joystick flutuante funcional + mock location + walking 5 km/h fixo
- alpha2: sliders velocidade (walk/run/carro) + botao teleporte
- alpha3: motion sensors sinteticos (acelerometro/bussola)
- v0.2.0: release com orientacao 3D opcional

### Technical
- `app/build.gradle`: targetSdk 34, minSdk 24 (Android 7+), Kotlin 1.9, Java 17
- Posicao inicial: Av. Paulista -23.561684/-46.655981 (bate com o Electron)
- Overlay type: TYPE_APPLICATION_OVERLAY (Android 8+) com fallback TYPE_PHONE
- WakeLock timeout: 1h, nao reference-counted

### Files
- CREATE `android-apk/settings.gradle`, `build.gradle` (root), `gradle.properties`
- CREATE `android-apk/app/build.gradle`
- CREATE `android-apk/app/src/main/AndroidManifest.xml`
- CREATE `android-apk/app/src/main/java/com/fakegps/MainActivity.kt`
- CREATE `android-apk/app/src/main/java/com/fakegps/FakeGPSService.kt`
- CREATE `android-apk/app/src/main/java/com/fakegps/JoystickOverlayView.kt`
- CREATE `android-apk/app/src/main/java/com/fakegps/MovementEngine.kt`
- CREATE `android-apk/app/src/main/res/layout/activity_main.xml`
- CREATE `android-apk/app/src/main/res/layout/overlay_joystick.xml`
- CREATE `android-apk/app/src/main/res/values/strings.xml`, `styles.xml`
- CREATE `.github/workflows/android-build.yml`
- CREATE `android-apk/README.md`

### Nao mexido
- Electron (v0.1.11.2) continua intacto. Projetos sao paralelos.

## [0.1.11.2] - 2026-10-01

### Fixed
- **Slider do alpha agora gira pros 2 lados**:
  - Antes: `min=0 max=360` → so dava pra girar numa direcao linear
  - Agora: `min=-180 max=180` → 0 no centro, direita gira CCW (+), esquerda gira CW (-)
  - Internamente continua 0-360 (spec W3C DeviceOrientation) - conversao so na UI
- Novas funcoes `alphaToSlider(a)` (0..360 -> -180..180) e `sliderToAlpha(v)` (-180..180 -> 0..360)

### Files
- EDIT `src/renderer/index.html` (slider alpha: min=-180 max=180 + label atualizada)
- EDIT `src/renderer/app.js` (alphaToSlider / sliderToAlpha + conversao no handler input e no applyOrientationToUI)
- EDIT bump versao em todos arquivos

## [0.1.11.1] - 2026-10-01

### Fixed
- **Rotação do celular 3D invertida verticalmente**: arrastar pra cima agora traz o topo do celular pra perto do observador (convencao Three.js OrbitControls). Sinal de `dy` invertido no handler de drag.
- **Rotação brusca / sensivel demais**: sensibilidade reduzida
  - Beta (dy): 0.5 -> 0.3 (40% mais lento)
  - Gamma (dx): 0.3 -> 0.2 (33% mais lento)
  - Alpha (Shift+dx): 0.5 -> 0.3

### Changed
- CSS: `.phone-3d` ganha `transition: transform 0.03s linear` pra suavizar renders entre frames do mousemove. Classe `.dragging` desliga a transição pra não adicionar latencia perceptivel durante o arrasto ativo.

### Files
- EDIT `src/renderer/app.js` (sinal beta invertido + sensibilidades 0.3/0.2/0.3)
- EDIT `src/renderer/styles.css` (transition 0.03s + override .dragging)
- EDIT bump versao em todos arquivos

## [0.1.11] - 2026-10-01

### Added - Preview 3D de orientacao do celular
- **Botao "📱 Orientacao"** no HUD (CONTROLES) abre modal com preview 3D
- **Celular 3D** desenhado com CSS 3D transforms (`perspective: 700px`, `transform-style: preserve-3d`, 6 faces):
  - Face frontal (tela com emoji) + traseira + 4 bordas laterais
  - Gradient azul no front simulando tela ligada
- **Interacao com mouse**:
  - Arrastar: Y → beta (tilt frente-tras, -180 a 180°), X → gamma (tilt lateral, -90 a 90°)
  - Shift + arrastar X: alpha (bussola, 0-360°)
- **3 sliders** pra ajuste fino de alpha / beta / gamma (com display do valor em graus)
- **Toggle "Alpha segue heading do GPS"** (default ON): bussola aponta pra direcao andada; desacopla auto se usuario mexer manualmente no slider ou shift-drag
- **Botao Resetar**: volta pra alpha:0 beta:70 gamma:0 (celular semi-vertical na mao, parado)
- **Persistencia** em localStorage `fake-gps-pc:orientation`

### Pipeline de comunicacao
```
app.js (modal 3D)
  → publishLocation({ ..., orientation: {alpha, beta, gamma} }) a 10Hz
  → preload.js IPC
  → main.js
  → server.js updateLocation (guarda currentOrientation)
  → GET /location retorna {..., orientation: {...}}
  → content.js polling 2Hz
  → inject.js: CURRENT_ORIENTATION = {alpha, beta, gamma}
  → fireEvents a 60Hz usa esses valores em vez de calcular automatico
  → window.dispatchEvent(DeviceOrientationEvent) chega no site
```

### Technical
- `server.js`: nova variavel `currentOrientation`; `updateLocation` tambem aceita `loc.orientation`; GET /location retorna location + orientation combinados
- `inject.js`: nova variavel `CURRENT_ORIENTATION`; `fireEvents` checa se existe e usa manual, senao fallback pro calculo automatico (comportamento v0.1.10.6)
- `app.js`: estado `orientationState` + funcoes load/save, modal com drag handlers (mousedown/mousemove/mouseup globais), 3 sliders + toggle, Z-X'-Y'' CSS rotation order

### Files
- EDIT `src/server.js` (currentOrientation + updateLocation + GET /location combinado)
- EDIT `src/renderer/index.html` (botao btn-orientation + modal-orientation com 3D stage e 6 faces)
- EDIT `src/renderer/styles.css` (perspective, phone-3d, 6 faces, phone-screen, orientation-sliders)
- EDIT `src/renderer/app.js` (orientationState, applyOrientationToUI, drag mouseX/Y, sliders handlers, publica no 10Hz loop)
- EDIT `poc-extension/inject.js` (CURRENT_ORIENTATION + usa no fireEvents com fallback)
- EDIT bump versao em todos arquivos

## [0.1.10.6] - 2026-10-01

### Changed - Trocado iPhone emulado por Android (Pixel 8 Pro)
- Nosso engine real e Chromium (Brave). Emulando iPhone (WebKit/Safari) criava divergencia detectavel:
  - `window.chrome` existia (Chromium) mas `navigator.vendor` dizia "Apple Computer, Inc." (impossivel no Safari real)
  - Sites podem sniffar `if (window.chrome && isApple) { fake detected }` em 1 linha
- Agora: emulamos **Android Chrome 131** → engine declarado bate com engine real → zero divergencia

### Overrides atualizados (`inject.js`)
- `userAgent`: `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36`
- `platform`: `Linux armv81` (padrao Android)
- `vendor`: `Google Inc.` (bate com Chrome real)
- `userAgentData.platform`: `Android` + brands com `Google Chrome 131` + `getHighEntropyValues` retorna `platformVersion: 14.0.0`, `model: Pixel 8 Pro`, `architecture: arm`, `bitness: 64`
- Viewport: **412×915** (Pixel 8 Pro) em vez de 390×844 (iPhone 15)
- `devicePixelRatio`: **2.625** (novo override - Pixel 8 Pro)

### Motion sensors
- **Removido patch de `requestPermission`** - Android nao exige essa API (so iOS 13+ exige)
- Comportamento de `DeviceMotionEvent` + `DeviceOrientationEvent` sintetico mantido identico

### Files
- EDIT `poc-extension/inject.js` (emulacao Android + remove requestPermission patch + devicePixelRatio)
- EDIT bump versao em todos arquivos

## [0.1.10.5] - 2026-10-01

### Added - Motion / Orientation sensors sinteticos (iPhone)
- **`DeviceMotionEvent` emulado a 60Hz**:
  - `acceleration` (sem gravidade) oscila com cadencia de passos: 2Hz walking (<2 m/s), 3Hz running
  - `accelerationIncludingGravity` = acceleration + g no eixo Z (iPhone semi-vertical na mao)
  - `rotationRate` oscila levemente
  - Amplitude cresce com `speedMps` (parado: ~0.05 m/s², correndo rapido: ~3 m/s²)
- **`DeviceOrientationEvent` + `deviceorientationabsolute` emulado a 60Hz**:
  - `alpha` sincronizado com `heading` do fake GPS (CW → CCW conversion)
  - `beta` ~70° (iPhone semi-inclinado na mao caminhando)
  - `gamma` oscila levemente
- **`requestPermission()` patcheado** (iOS 13+ exige): retorna sempre `'granted'`
- Respeita `overrideEnabled`: se usuario desliga via popup, sensores param

### Why
- `gocollect.fun` provavelmente valida movimento humano via `DeviceMotion` (step detection). Desktop Chrome nao emite esses eventos naturalmente, o que pode servir de sinal "fake GPS detectado" ou simplesmente travar a UI que espera sensores.

### Files
- EDIT `poc-extension/inject.js` (nova funcao `applyMotionSensorEmulation` + chamada condicional a gocollect.fun apos `let overrideEnabled`)
- EDIT bump versao em todos arquivos

## [0.1.10.4] - 2026-10-01

### Added
- **Extensao agora persiste a ultima localizacao recebida do Electron**:
  - `content.js` salva cada location em `chrome.storage.local['fakeGPSLastLocation']` (throttle: 1x a cada 3s pra nao martelar storage)
  - No startup, le a ultima location salva e envia pro `inject.js` via postMessage ANTES do polling
  - Resultado: se o Electron esta fechado, o site usa a ultima posicao conhecida como fallback (em vez da Paulista default hardcoded no inject.js)
  - Trabalha em paralelo com o Electron: enquanto ele estiver aberto, o storage e atualizado continuamente

### Technical
- `content.js`: constantes `LAST_LOCATION_KEY`, `SAVE_LOCATION_THROTTLE_MS`; funcoes `sendLocationToInject(loc)` e `persistLocation(loc)` extraidas
- `pollOnce()` agora chama `persistLocation` apos receber do servidor
- `inject.js` sem mudancas - continua recebendo via postMessage e atualizando `CURRENT`

### Files
- EDIT `poc-extension/content.js` (persistLocation + load no startup + sendLocationToInject helper)
- EDIT bump versao em todos arquivos

## [0.1.10.3] - 2026-10-01

### Changed
- **Rota amarela/preta agora persiste durante o autopilot** (antes sumia ao iniciar)
  - Hoje: ao clicar "▶ Iniciar", a rota planejada (amarela com borda preta) desaparecia e so a azul pontilhada aparecia
  - Agora: a rota amarela permanece visivel junto com a azul pontilhada do autopilot
  - A amarela so e removida quando a rota termina (via `RoutePlanner.clear()` em `onComplete`) ou quando o usuario remove todos os stops
- Removido redesenho redundante da rota amarela quando "parar": como ela nunca mais e removida ao iniciar, nao precisa redesenhar ao parar

### Files
- EDIT `src/renderer/app.js` (remove `Map.clearPlannedRoute()` da acao de iniciar + remove redesenho redundante)
- EDIT bump versao em todos arquivos

## [0.1.10.2] - 2026-10-01

### Fixed - BUG CRITICO introduzido na v0.1.9
- **`AutoPilot.setActiveKindProvider is not a function` quebrava TUDO**
  - Sintoma: joystick, teleporte, "caminhe ate aqui", presets, crates - nada funcionava
  - Causa: a funcao `setActiveKindProvider` existia dentro do autopilot.js (linha 16) mas nao estava exportada no `global.FakeGPS.AutoPilot = {...}` (linha 180)
  - Linha 48 do app.js chamava `AutoPilot.setActiveKindProvider(...)` → TypeError → **matava todo o IIFE do app.js**
  - Depois do erro, nenhum handler era registrado (nem joystick, nem map actions, nem autosave, nem tick loop)
  - `node --check` passava porque e sintaticamente valido - erro so acontecia em runtime
- **Fix: 1 linha** - adicionar `setActiveKindProvider: setActiveKindProvider` no export do autopilot.js
- Diagnostico: executei `npm run dev` em background e vi `Uncaught TypeError` no stdout do Electron

### Files
- EDIT `src/renderer/autopilot.js` (adiciona `setActiveKindProvider` no export)
- EDIT bump versao em todos arquivos

## [0.1.10.1] - 2026-10-01

### Removed
- **Favoritos (painel + modal + modulo favorites.js) removidos a pedido do usuario**
  - Da mais espaco no HUD pros outros paineis (joystick, posicao, velocimetro, controles)
  - Resolve problema de layout apertado onde controls-panel (presets) podia ficar cortado

### Files
- EDIT `src/renderer/index.html` (remove .favorites-panel, #modal-add-fav, script favorites.js, versao)
- EDIT `src/renderer/app.js` (remove `const Favorites`, `btnAddFav`, `favList`, blocos renderFavorites + modal fav, chamada renderFavorites). Funcao `escapeHtml` preservada - usada em outros lugares (presets, rota)
- DELETE `src/renderer/favorites.js`
- EDIT bump versao em todos arquivos

## [0.1.10] - 2026-10-01

### Added
- **Pontos custom na rota (click no mapa)**:
  - Popup do mapa ganha botao "➕ Adicionar a rota" (3ª opcao)
  - Click adiciona ponto custom como stop da rota planejada (id prefixado com `custom:`)
  - Pin azul permanente no mapa com numero do ponto (persiste ate ser removido da rota)
  - Lista de rota mostra "📍 Ponto N" com numeracao automatica (reenumera ao remover/reordenar)
  - Click no pin azul abre popup "Remover da rota"
  - Pontos custom e crates coexistem na mesma rota - rota mista funciona
- **Velocimetro visual no HUD** (substituindo o row "Vel"):
  - Painel dedicado "VELOCIMETRO" com display grande (36px, monospace)
  - Cor progressiva: verde (< 60% da max), amarelo (60-90%), vermelho (90%+)
  - Mostra "max N" embaixo (atualiza conforme slider muda)
  - Text-shadow glow pra efeito "painel de carro"

### Technical
- `map.js`: nova action `add-to-route`, `customPinsLayer`, `renderCustomPins`/`clearCustomPins`/`onCustomPinRemove`
- `app.js`: constante `CUSTOM_PREFIX = 'custom:'`, helper `isCustomStop`, `syncCustomPins`, `updateSpeedometer` com classe progressiva
- `renderRoutePlannerList` detecta `isCustomStop` e usa label "📍 Ponto N" (contagem sequencial so entre custom stops)
- CSS: `.speedometer-panel`, `.speedo-wrap`, `.speedo-value.mid|.high`, `.custom-pin-marker`, `.custom-pin`

### Files
- EDIT `src/renderer/map.js` (popup +1 opcao, customPinsLayer, renderCustomPins, exports)
- EDIT `src/renderer/app.js` (handler add-to-route, syncCustomPins, labels custom na lista, updateSpeedometer)
- EDIT `src/renderer/index.html` (remove row Vel; add painel VELOCIMETRO; bump versao)
- EDIT `src/renderer/styles.css` (.speedometer-panel + .custom-pin*)
- EDIT bump versao em todos arquivos

## [0.1.9.1] - 2026-10-01

### Changed
- **Campos de "Chance" nos modais agora sao em porcentagem (0 a 100%)** em vez de fracao (0 a 1)
  - Humanidade: `cfg-trafficStopChance` e `cfg-microPauseChance` → inputs mostram 0-100
  - Carro: `car-trafficStopChance` idem
- Persistencia continua em formato 0-1 (fracao) - conversao e so na UI (fill multiplica * 100, save divide / 100)

### Files
- EDIT `src/renderer/index.html` (3 inputs de chance: label "(%)" + min=0 max=100 step=1 + versao)
- EDIT `src/renderer/app.js` (fillSettingsForm/fillCarForm multiplicam * 100; saveSettings/saveCarConfig dividem / 100)
- EDIT bump versao em todos arquivos

## [0.1.9] - 2026-10-01

### Changed - Reorganizacao dos presets com configs scoped
- **Cada preset built-in (Walk, Run, Carro) agora tem botao ⚙ ao lado** com configs especificas
- **Walk / Run** → ⚙ abre modal "Humanidade (pedestre)" (agora com toggle ON/OFF integrado no modal)
- **Carro** → ⚙ abre modal **"Comportamento de carro"** com: aceleracao, freada em curva, zona de freada antes do destino, chance e duracao de parar em sinais
- **Presets customizados** → ⚙ abre modal informativo (preset generico sem configs avancadas)
- **Botao global "🚦 Humanidade" removido** - toggle agora fica dentro do modal
- **Botao ⚙ global do header removido** - config agora e por preset
- `movement.js` e `autopilot.js` consultam `kind` do preset ativo pra decidir se usam config do carro ou formula padrao
- Preset ativo e persistido como `activePresetId`

### Added
- Modulo `car-config.js` (CRUD + persistencia de config do carro)
- Campo `kind: 'walk'|'run'|'car'|'custom'` em cada preset
- Modal `modal-car` + `modal-preset-generic`
- CSS `.preset-group`, `.preset-gear-btn`, `.toggle-switch`

### Files
- CREATE `src/renderer/car-config.js`
- EDIT `src/renderer/presets.js`, `movement.js`, `autopilot.js`, `index.html`, `styles.css`, `app.js`
- EDIT bump versao em todos arquivos

## [0.1.8.4] - 2026-10-01

### Changed
- **Aceleracao realista (depende da velocidade maxima)**:
  - Antes: `accelTime = 0.6s` fixo pra todos os presets (carro de 0 a 50 em 0.6s era irreal)
  - Agora: `accelTime = 0.3 + kmh/15` → Walk 0.63s · Run 1.10s · **Carro 3.63s** · Via urbana rapida 50 km/h → 3.6s realista
  - Mesma rampa pra desacelerar (freada suave)
- **Reducao de velocidade em curvas/cruzamentos durante autopilot**:
  - A cada tick, `autopilot.js` calcula o angulo entre o segmento atual e o proximo
  - Angulo <= 10° (reta) → magnitude 1 (velocidade cheia)
  - Angulo 10°-90° → magnitude cai linearmente ate 35%
  - Angulo >= 90° (quase perpendicular) → magnitude 35% (freada forte)
- **Aproximacao do destino final** (ultimos 15 metros):
  - Freia proporcionalmente ate 25% da velocidade quando esta a 1m do destino
  - Evita "para brusco" ao chegar
- Combinado: carro sai de 0 → acelera gradual → cruza em marcha reduzida → acelera na reta → freia perto do destino

### Technical
- `movement.js`: funcao `computeAccelTime()` em vez de `config.accelTime` constante
- `autopilot.js`: `turnAngleDeg(from, through, to)` + `curveSlowdownFactor(deg)`; magnitude agora pode ser < 1 (antes era sempre 1 em modo autopilot)

### Changed
- Versao sincronizada em todos arquivos: **v0.1.8.4**

### Files
- EDIT `src/renderer/movement.js` (`computeAccelTime` + usa no `update`)
- EDIT `src/renderer/autopilot.js` (turnAngleDeg + curveSlowdownFactor + magnitude variavel)
- EDIT bump versao em: `poc-extension/manifest.json`, `poc-extension/inject.js`, `poc-extension/popup.html`, `src/server.js`, `src/main.js`, `src/renderer/index.html`, `src/renderer/app.js`

## [0.1.8.3] - 2026-10-01

### Added
- **Novo preset default: 🚗 Carro 50 km/h** (3 presets agora: Walk 5, Run 12, Carro 50)
- **Presets editaveis via modal** (botao ⚙ ao lado dos presets):
  - Modal com lista de presets, cada um com inputs de emoji + nome + velocidade (km/h)
  - Botao "+ Adicionar preset" cria um novo (default: 🏷️ Novo 10 km/h)
  - Botao "✕" em cada linha remove
  - "Resetar default" volta aos 3 originais (Walk/Run/Carro)
  - Persiste em `localStorage` chave `fake-gps-pc:speed-presets`
  - Validacao: nome obrigatorio, velocidade 0.5-200 km/h
- **Modulo `presets.js`**: CRUD + sanitizacao + persistencia

### Changed
- **Limite do slider aumentado**: 20 km/h -> **200 km/h** (`Movement.setMaxSpeedKmh` tambem clamped em 200)
- Presets agora renderizam dinamicamente (nao mais hardcoded no HTML)
- Versao sincronizada em todos arquivos: **v0.1.8.3**

### Files
- CREATE `src/renderer/presets.js` (CRUD + default presets)
- EDIT `src/renderer/movement.js` (limite 20 -> 200 em `setMaxSpeedKmh`)
- EDIT `src/renderer/index.html` (speed-selector dinamico + modal + max slider 200 + script tag + versao)
- EDIT `src/renderer/styles.css` (.speed-selector-wrap, .speed-edit-btn, .presets-list, .preset-row)
- EDIT `src/renderer/app.js` (renderPresets dinamico, modal editor, slider sync, remove modeBtns hardcoded)
- EDIT bump versao em: `poc-extension/manifest.json`, `poc-extension/inject.js`, `poc-extension/popup.html`, `src/server.js`, `src/main.js`

## [0.1.8.2] - 2026-10-01

### Added
- **Drag & drop pra reordenar crates da rota**: segura o item com o mouse e arrasta pra cima/baixo da lista. Botoes ↑↓ continuam funcionando. Visual: item arrastado fica semi-transparente, alvo com borda azul.
- **ETA no cabecalho da rota**: alem da distancia (ex: `1.24 km`), mostra tempo estimado baseado na velocidade do slider (ex: `~15 min`). Formato < 60s/<60min/com horas. Recalcula quando o slider muda.
- **Botao Iniciar vira "⏸ Parar rota"** quando a rota ta ativa:
  - Click durante autopilot: para e volta a mostrar a rota planejada (polyline amarela)
  - Click sem autopilot: inicia (polyline azul da rota ativa)

### Changed
- **Polyline da rota planejada agora amarela grossa com borda preta** (muito mais visivel):
  - Camada 1: linha preta, weight 9, opacity 0.85 (borda)
  - Camada 2: linha amarela `#ffd600`, weight 5, opacity 1 (meio)
  - Removido dashArray (linha solida)
- Versao sincronizada em todos arquivos: **v0.1.8.2**

### Files
- EDIT `src/renderer/map.js` (polyline 2 camadas pra rota planejada)
- EDIT `src/renderer/styles.css` (cursor grab + estados dragging/drag-over + route-planner-btn-danger)
- EDIT `src/renderer/app.js` (formatETA, updateRouteStartButton, drag handlers, speedSlider listener)
- EDIT bump versao em: `poc-extension/manifest.json`, `poc-extension/inject.js`, `poc-extension/popup.html`, `src/server.js`, `src/main.js`, `src/renderer/index.html`

## [0.1.8.1] - 2026-10-01

### Added
- **Mobile emulation automatica em gocollect.fun**:
  - `inject.js` detecta `location.hostname === 'gocollect.fun'` em `document_start` e aplica overrides antes do React renderizar
  - Overrides: `navigator.userAgent` (iPhone 17.6 Safari), `navigator.platform` (iPhone), `navigator.vendor` (Apple), `navigator.maxTouchPoints` (5), `navigator.userAgentData` (mobile:true), `window.ontouchstart` (presente), `window.innerWidth/innerHeight/outerWidth/outerHeight` (390x844), `screen.width/height/availWidth/availHeight` (390x844)
  - `window.matchMedia` com Proxy: queries `pointer: coarse`, `hover: none`, `max-width: Npx` (quando N >= 390) → `matches: true`; `min-width: Npx` (quando N > 390) → `matches: false`
  - Aplica so em gocollect.fun — outros sites ficam intactos
- Nenhum toggle UI (semantica: sempre ligado em gocollect.fun). Pra desativar: desative a extension inteira (botao do popup) e reload a aba.

### Nota
- Janela do Brave NAO encolhe pra 390px — so o JS "ve" dimensoes mobile. Visualmente pode ter espaco vazio nas laterais, mas o layout renderiza na versao mobile dos componentes React.
- Headers HTTP enviados pelo Brave ainda sao desktop (nao foi usado `declarativeNetRequest`). Suficiente pra maioria dos SPAs que decidem layout via JS. Se necessario no futuro, adicionar header rewrite.

### Changed
- Versao sincronizada em todos arquivos: **v0.1.8.1**

### Files
- EDIT `poc-extension/inject.js` (applyMobileEmulation + chamada condicional em gocollect.fun)
- EDIT `poc-extension/manifest.json` (0.1.8 -> 0.1.8.1)
- EDIT `poc-extension/popup.html` (versao)
- EDIT `src/server.js` (version /health)
- EDIT `src/main.js` (title)
- EDIT `src/renderer/index.html` (versao topbar)
- EDIT `src/renderer/app.js` (log versao)

## [0.1.8] - 2026-10-01

### Added - Planejador de rota multi-stop com crates
- **Novo painel `🗺️ ROTA PLANEJADA`** aparece acima do HUD quando >=1 crate na rota:
  - Lista ordenada mostrando posicao (1, 2, 3...), ID curto, distancia do segmento, botoes `↑ ↓ ✕`
  - Cabecalho com contagem + distancia total + botoes `▶ Iniciar` e `✕ Limpar`
  - Rota planejada desenhada no mapa como polyline azul claro tracejada
  - Marcadores dos crates na rota mudam pra numero com fundo azul (`1`, `2`, `3`, ...)
- **Popup do crate alterna dinamicamente**:
  - Se nao esta na rota: botao `➕ Adicionar a rota` (azul)
  - Se ja esta na rota: botao `✕ Remover da rota` (vermelho) + indicacao `#N na rota`
  - Sempre tem tambem o botao `🚶 Ir agora` (teleporte direto, nao usa a rota planejada)
- **Qualquer mudanca regenera a rota** (debounce 400ms):
  - Adicionar crate → recalcula percurso completo
  - Remover crate (mesmo que seja o do meio) → recalcula sem ele
  - Reordenar (`↑ ↓`) → recalcula na nova ordem
- `▶ Iniciar` dispara `AutoPilot` com todos os waypoints da rota multi-stop. Rota planejada vira rota ativa; ao concluir, lista limpa.
- Persistencia em `localStorage` chave `fake-gps-pc:route-plan` (sobrevive reload)

### Technical
- `routing.js`: nova funcao `fetchMultiFootRoute(points)` que chama OSRM com N waypoints de uma vez (uma unica request HTTP)
- `route-planner.js`: estado da rota (add/remove/move/clear/toggle) + listeners com debounce + persistencia
- `map.js`: `drawPlannedRoute()`, `onCrateToggleRoute()`, `setPlannedRouteChecker()`, markers numerados pra crates na rota
- `app.js`: `renderRoutePlannerList()` + `recalcPlannedRoute()` disparado em cada evento

### Changed
- Versao sincronizada em todos arquivos: **v0.1.8**

### Files
- CREATE `src/renderer/route-planner.js`
- EDIT `src/renderer/routing.js` (fetchMultiFootRoute)
- EDIT `src/renderer/map.js` (drawPlannedRoute, markers numerados, popup dinamico)
- EDIT `src/renderer/index.html` (panel route-planner + script tag + v0.1.8)
- EDIT `src/renderer/styles.css` (estilos .route-planner-*, .crate-pin-numbered, .action-popup-btn-danger)
- EDIT `src/renderer/app.js` (toggle de crate, renderRoutePlannerList, recalcPlannedRoute, start/clear handlers)
- EDIT `src/main.js` (title v0.1.8)
- EDIT `src/server.js` (version /health)
- EDIT `poc-extension/manifest.json` (0.1.7.1 -> 0.1.8)
- EDIT `poc-extension/inject.js` (version na flag)
- EDIT `poc-extension/popup.html` (texto Versao)

## [0.1.7.1] - 2026-10-01

### Policy
- **Versao da extension agora sempre simetrica com o Electron app**:
  - A partir desta release, ambos os lados usam a MESMA string de versao (ex: `0.1.7.1`)
  - Bumpa junto em: `src/renderer/index.html`, `src/renderer/app.js`, `src/main.js`, `src/server.js`, `poc-extension/manifest.json`, `poc-extension/inject.js`, `poc-extension/popup.html`
  - Objetivo: evitar confusao "qual versao esta carregada?" e lembrar o usuario de recarregar a extension em `brave://extensions`
  - Extension bumped: 0.1.2 -> 0.1.7.1 (pulou numeracao interna pra alinhar)

### Changed
- **Mapa nao centraliza mais automaticamente durante autopilot**:
  - Antes: durante uma rota automatica, `panToMarkerIfOut()` era chamado todo tick e "forcava" o mapa a seguir o personagem.
  - Agora: o mapa so centraliza quando VOCE clica em "🎯 Centralizar" (ou quando teletransporta/vai pra um endereco, onde faz sentido).
  - Durante rota: personagem pode "sair" do viewport se voce estiver olhando outra regiao do mapa. Clica em "Centralizar" se quiser trazer de volta.

### Files
- EDIT `src/renderer/app.js` (removido `Map.panToMarkerIfOut()` do tick + log de versao)
- EDIT `src/renderer/index.html` (versao v0.1.7.1)
- EDIT `src/main.js` (title v0.1.7.1)
- EDIT `src/server.js` (version /health)
- EDIT `poc-extension/manifest.json` (0.1.2 -> 0.1.7.1)
- EDIT `poc-extension/inject.js` (version na flag `__FAKE_GPS_POC__`)
- EDIT `poc-extension/popup.html` (texto Versao)

## [0.1.7] - 2026-10-01

### Added - Deteccao automatica de crates (gocollect.fun)
- **Extension intercepta responses JSON** com campo `crates`:
  - `inject.js` faz override de `window.fetch` guardando ref nativa. Para todo response JSON, procura campo `crates` (array). Se tiver, envia via postMessage.
  - Stealth: `fetch.toString()` continua retornando `function fetch() { [native code] }`
- **Ponte extension -> Electron**:
  - `content.js` escuta messages de crates e faz `POST http://127.0.0.1:3477/crates` com payload `{crates, lures, ts}`
  - Servidor armazena + callback dispara `webContents.send('fake-gps:crates', payload)` pro renderer
- **Renderizacao no mapa do Electron**:
  - Novo modulo `crates.js`: normaliza `lng` -> `lon`, mapa id -> crate, filtros `available()` (nao aberta + nao expirada), `nearest(lat, lon)`
  - Novo layer no Leaflet: marcadores 📦 nos crates disponiveis (opacidade reduzida em `openedByMe`)
  - Click no marcador: popup com ID + botao "🚶 Caminhar ate esta crate"
  - Botao usa OSRM foot (v0.1.6.2) + augment reto (v0.1.6.3) pra rotear ate o ponto exato da crate

### Technical
- `inject.js`: override de `window.fetch` com clone de response pra nao consumir body original
- `server.js`: endpoint `POST /crates` com validacao de JSON + limite 512KB
- `main.js`: refatorado pra guardar `mainWin` em escopo de modulo (necessario pra `webContents.send` de crates)
- `preload.js`: expoe `onCrates(cb)` via `contextBridge`
- `crates.js`: estado reativo com listeners + funcoes utilitarias (distanceMeters, nearest)
- `map.js`: `cratesLayer` (`L.layerGroup`), `renderCrates(list)`, `onCrateAction(cb)`, popup customizado por crate

### Files
- EDIT `poc-extension/inject.js` (fetch interceptor + stealth)
- EDIT `poc-extension/content.js` (postMessage listener + POST /crates)
- EDIT `src/server.js` (endpoint POST /crates + setOnCrates + readJsonBody)
- EDIT `src/main.js` (mainWin em escopo de modulo + Server.setOnCrates)
- EDIT `src/preload.js` (onCrates via contextBridge)
- CREATE `src/renderer/crates.js` (estado + utils)
- EDIT `src/renderer/map.js` (cratesLayer + renderCrates + onCrateAction)
- EDIT `src/renderer/app.js` (wire onCrates + routeToCrate)
- EDIT `src/renderer/index.html` (script tag crates.js + v0.1.7)
- EDIT `src/renderer/styles.css` (estilos crate-pin + popup)

## [0.1.6.4] - 2026-10-01

### Added - Extension (bump interno pra v0.1.2)
- **Botao liga/desliga no popup da extension**:
  - Quando LIGADO (vermelho `⏸ Desligar`): spoof ativo, mandando posicao fake pro site
  - Quando DESLIGADO (verde `▶ Ligar`): `inject.js` redireciona `getCurrentPosition`, `watchPosition`, `clearWatch` e `permissions.query` pros **metodos nativos** (navegador usa GPS real / vazio)
- Estado persistido em `chrome.storage.local` chave `fakeGPSEnabled` (default: ligado)
- Content.js observa mudancas em tempo real via `chrome.storage.onChanged` e propaga pro inject.js
- Popup mostra status detalhado: Fake GPS LIGADO/DESLIGADO + inject ATIVO (Electron) ou ATIVO (fallback)

### Technical
- `inject.js`: guarda refs NATIVAS no load (`nativeGetCurrentPosition`, `nativeWatchPosition`, `nativeClearWatch`, `nativePermissionsQuery`). Quando `overrideEnabled` false, as funcoes fake delegam direto pro nativo (incluindo watchPositions nativos pra permitir `clearWatch` depois).
- `content.js`: default `enabled=true`, le/escuta `chrome.storage`. Quando desligado nao faz polling do servidor local.
- `popup.html` e `popup.js`: botao grande vermelho/verde + card de status + ajuda contextual.
- `manifest.json`: versao bump 0.1.1 -> 0.1.2.

### Nota
- Apos trocar o estado, recarregar a aba ja aberta ajuda a garantir que `watchPosition`s antigos reiniciem no modo correto. Novas abas aplicam automatico.

### Files
- EDIT `poc-extension/inject.js` (refs nativas + flag overrideEnabled + handler de kind='enabled')
- EDIT `poc-extension/content.js` (le `chrome.storage`, propaga estado, pausa polling se off)
- EDIT `poc-extension/popup.html` (botao toggle + status detalhado)
- EDIT `poc-extension/popup.js` (handler toggle, le/escreve storage, render dinamico)
- EDIT `poc-extension/manifest.json` (versao 0.1.2)

## [0.1.6.3] - 2026-10-01

### Fixed
- **Rota terminava na rua, nao no ponto clicado**:
  - Causa: OSRM faz "snap" dos waypoints de origem/destino pra via mais proxima do grafo. Se voce clica dentro de uma residencia, praca ou area sem via mapeada, o OSRM te leva ate a rua mais perto, nao ate o ponto exato.
  - Fix: `routing.js` agora adiciona segmentos em linha reta no inicio (se voce esta fora da via) e no fim (se o destino clicado esta fora da via), interpolados a cada ~5m pra manter a caminhada suave.
  - Resultado: personagem chega efetivamente no ponto exato clicado, mesmo que precise "atravessar o terreno" nos ultimos metros.

### Files
- EDIT `src/renderer/routing.js` (funcao `interpolateStraight` + augment prefixo/sufixo em `fetchFootRoute`)
- EDIT `src/renderer/index.html` (versao v0.1.6.3)
- EDIT `src/renderer/app.js` (log de versao)

## [0.1.6.2] - 2026-10-01

### Fixed
- **Rota de pedestre segue ruas de carro (BUG)**:
  - Causa: endpoint `router.project-osrm.org/route/v1/foot/...` **nao mantem mais o perfil foot** desde 2022. A instancia publica oficial so expoe o perfil driving.
  - Fix: trocado para `routing.openstreetmap.de/routed-foot/route/v1/driving` — mesma API OSRM, mas subdominio `routed-foot` com o perfil pedestre real.
  - Agora respeita: ignora sentido de via, usa calcadas, trilhas (`highway=footway`), vias pedestres (`highway=pedestrian`), atalhos de parque.

### Changed
- CSP: `connect-src` agora inclui `https://routing.openstreetmap.de` (removido `router.project-osrm.org`)

### Nota
- Em areas onde o OSM nao tem calcadas mapeadas separadas, a rota ainda pode usar a rua (dado do OSM, nao do routing). Nesses casos a rota ainda vai ser legitima (pedestre pode caminhar na beira da estrada).

### Files
- EDIT `src/renderer/routing.js` (OSRM_BASE)
- EDIT `src/renderer/index.html` (CSP + versao v0.1.6.2)
- EDIT `src/renderer/app.js` (log de versao)

## [0.1.6.1] - 2026-10-01

### Added
- **Cadeado de teleporte** (`🔒 Teleporte: BLOQUEADO` / `🔓 Teleporte: LIVRE (Ns)`):
  - Estado padrao: TRANCADO (verde) — todos os teleports bloqueados
  - Click: destrava por **5 segundos** (laranja, pulsando, com countdown)
  - Apos 5s: re-trava automaticamente
  - Apos usar o teleporte: re-trava **imediatamente** (defesa extra contra loops acidentais)
  - Protecoes:
    - Click no mapa: botao 🎯 nao aparece no popup quando trancado (so 🚶 Caminhar)
    - Favoritos: botao 🎯 mostra alert se trancado
    - "Ir para...": mostra erro no modal se trancado
  - Objetivo: evitar teleport acidental em rotas longas (teleport pode disparar deteccao por velocidade)

### Files
- EDIT `src/renderer/index.html` (botao lock + versao v0.1.6.1)
- EDIT `src/renderer/styles.css` (estilos lock-locked / lock-unlocked com animacao)
- EDIT `src/renderer/map.js` (setTeleportLockProvider + render condicional do botao teleport no popup)
- EDIT `src/renderer/app.js` (estado teleportLocked, timer countdown, isTeleportAllowed em todos os pontos de teleport)

## [0.1.6] - 2026-10-01

### Added
- **Rota real em ruas via OSRM** (`project-osrm.org`, perfil pedestre `foot`):
  - Click no mapa agora mostra 2 opcoes no popup:
    - 🚶 **Caminhar ate aqui** (verde, primary) — calcula rota real em ruas e caminha automaticamente
    - 🎯 **Teletransportar aqui** (azul, secondary)
  - Rota desenhada no mapa como polyline azul tracejada
  - Marcador 🏁 no destino
  - Durante auto-walk, o mapa segue o personagem automaticamente (pan se chegar na borda)
  - Botao **✕ Cancelar rota** aparece na barra de controles enquanto rota ativa
  - Humanidade continua funcionando durante auto-walk (pausas em cruzamentos)
- `routing.js`: `fetchFootRoute(fromLat, fromLon, toLat, toLon)` → `{ waypoints, distanceMeters, durationSeconds }`
- `autopilot.js`: segue array de waypoints emulando o joystick. Avanca pro proximo quando chega a <3m
- CSP ampliado: `connect-src` agora inclui `https://router.project-osrm.org`

### Removed
- **Botao "📍 Seguir: ON/OFF"** (camera follow) — redundante, agora o mapa segue automaticamente so durante auto-walk

### Files
- CREATE `src/renderer/routing.js`
- CREATE `src/renderer/autopilot.js`
- EDIT `src/renderer/map.js` (2 botoes no popup + drawRoute/clearRoute + marcador destino)
- EDIT `src/renderer/app.js` (handler route, cancel route, autopilot integrado no tick, removido followMode)
- EDIT `src/renderer/index.html` (CSP OSRM + scripts routing/autopilot + btn-cancel-route + removido btn-follow + v0.1.6)
- EDIT `src/renderer/styles.css` (polyline marker + popup primary/secondary + action-btn.hidden)

## [0.1.5.2] - 2026-10-01

### Added
- **Botao "📍 Ir para..."** na barra de controles:
  - Modal com campo de texto
  - Aceita **coordenadas** (ex: `-23.5505, -46.6333` ou `-23.5505 -46.6333`)
  - Aceita **endereco** (ex: `Av. Paulista 1578, Sao Paulo`) via **Nominatim** (OpenStreetMap geocoding gratuito)
  - Em caso de endereco: mostra "🔍 Buscando..." enquanto resolve
  - Erro amigavel se nao encontrar
  - Enter = ir, Esc = cancelar
- CSP ampliado em `index.html`: `connect-src` agora inclui `https://nominatim.openstreetmap.org`

### Removed
- **Botao "↺ Reset"** (ia voltar pra Paulista) — nao fazia muito sentido pos v0.1.3 (teleporte) e v0.1.5.2 (ir para)

### Files
- EDIT `src/renderer/index.html` (CSP + botao goto + modal + versao v0.1.5.2)
- EDIT `src/renderer/styles.css` (estilo `.goto-status`)
- EDIT `src/renderer/app.js` (handlers goto + parseCoords + geocodeNominatim; removido handler Reset)

## [0.1.5.1] - 2026-10-01

### Added
- **Modal de configuracoes da Humanidade** (botao ⚙️ na topbar):
  - Edita intervalo entre rolls (seg)
  - Edita chance e duracao de sinal/cruzamento
  - Edita chance e duracao de micropausa
  - Validacao: min <= max, chances entre 0 e 1, numeros positivos
  - Botao "Resetar default" volta aos valores originais
  - Config persistida em `localStorage` chave `fake-gps-pc:humanity-config`
- **Barra indicadora de pausa** (acima do mapa, visivel quando pausado):
  - Mostra motivo: "Pausado manualmente" / "Esperando sinal / cruzamento" / "Micropausa (olhando celular)"
  - **Countdown** `mm:ss` atualizado a 2Hz com tempo restante
  - Animacao pulsante laranja

### Changed
- `Humanity`: expoe `getConfig()`, `setConfig(patch)`, `resetConfig()`, `DEFAULT_CONFIG`
- Config carrega do localStorage ao iniciar

### Files
- EDIT `src/renderer/humanity.js` (persist config + API editavel)
- EDIT `src/renderer/index.html` (botao ⚙️, modal de configs, barra pause-bar, versao v0.1.5.1)
- EDIT `src/renderer/styles.css` (estilos .pause-bar, .modal-wide, .settings-grid)
- EDIT `src/renderer/app.js` (handlers do modal, updatePauseBar no tick, formatCountdown)

## [0.1.5] - 2026-10-01

### Added
- **Modo Humanidade** (`🚦 Humanidade: ON/OFF`):
  - Pausas automaticas simulando comportamento humano enquanto o personagem anda
  - Dois tipos de pausa:
    - **Micropausa** (1-3s, 18% chance a cada roll): "olhou o celular"
    - **Sinal/Cruzamento** (15-45s, 32% chance): simula semaforo vermelho
  - Rolls a cada 15-60s (intervalo aleatorio)
  - So pausa se o personagem efetivamente estiver se movendo (`speedMps > 0.3`)
  - Status visual no topbar: `🚦 SINAL` ou `⏱ PAUSA` durante pausas simuladas
- Estado do toggle persistido no localStorage (volta ligado ao reabrir)
- Objetivo: reduzir pattern detection — padroes de movimento ficam indistinguiveis de walking humano real

### Files
- CREATE `src/renderer/humanity.js`
- EDIT `src/renderer/index.html` (botao toggle + script tag + versao v0.1.5)
- EDIT `src/renderer/persistence.js` (campo humanityEnabled)
- EDIT `src/renderer/app.js` (integracao no tick + toggle + status visual)

## [0.1.4] - 2026-10-01

### Added
- **Painel de favoritos**:
  - Novo panel no HUD com lista de locais salvos
  - Botao "+" (no cabecalho do panel) salva a posicao atual com nome via prompt
  - Cada item tem: 🎯 (teletransporta) + ✕ (remove)
  - Persistencia em `localStorage` chave `fake-gps-pc:favorites`
  - Limite: 50 favoritos
  - Scroll vertical quando lista excede 140px
- `favorites.js`: modulo CRUD com validacao de coordenadas + sanitizacao de nome (max 40 chars)

### Changed
- Versao: v0.1.4

### Files
- CREATE `src/renderer/favorites.js`
- EDIT `src/renderer/index.html` (novo panel + script tag + versao)
- EDIT `src/renderer/styles.css` (estilos .favorites-panel + .fav-item)
- EDIT `src/renderer/app.js` (renderFavorites, add/delete handlers, teleport pra favorito)

## [0.1.3] - 2026-10-01

### Added
- **Teletransporte por clique no mapa**:
  - Click em qualquer ponto do mapa abre popup Leaflet customizado (dark theme)
  - Botao "🎯 Teletransportar aqui" move o marcador instantaneamente
  - Posicao e persistida no localStorage imediatamente (saveNow)
  - Aviso visual no popup: "⚠️ Teleporte pode ser detectado"
- `Movement.teleport(lat, lon)`: funcao atomica que seta posicao sem rampa de velocidade
- `Map.onAction(name, cb)`: sistema de registro de handlers pra o popup (extensivel pra v0.1.6 "andar ate aqui")

### Changed
- Versao: v0.1.3

### Files
- EDIT `src/renderer/movement.js` (nova funcao teleport)
- EDIT `src/renderer/map.js` (click listener + showActionPopup + onAction)
- EDIT `src/renderer/app.js` (registra handler de teleport + saveNow)
- EDIT `src/renderer/index.html` (bump versao)
- EDIT `src/renderer/styles.css` (estilos do popup dark)

## [0.1.2] - 2026-10-01

### Added
- **Persistencia da posicao** via `localStorage` (chave `fake-gps-pc:state`):
  - Autosave a cada 5s
  - Save imediato ao fechar (beforeunload)
  - Ao abrir, restaura lat/lon/mode/velocidade/estado-pausa da ultima sessao
  - Reset limpa o storage
- **Botao Pausar/Continuar** (⏸ / ▶):
  - Congela o movimento sem perder a posicao (motor desacelera suave ate 0)
  - Mantem o pipe de publicacao ativo (site enxerga voce parado)
  - Indicador visual na topbar: ATIVO (verde) / PAUSADO (laranja)

### Changed
- Topbar: removido texto "ainda nao conectado ao navegador" (agora conectado)
- Versao exibida: v0.1.2

### Files
- CREATE `src/renderer/persistence.js`
- EDIT `src/renderer/app.js` (restore + autosave + pause state)
- EDIT `src/renderer/index.html` (botao pause + script tag)
- EDIT `src/renderer/styles.css` (estilos de pause + status)

## [0.1.1] - 2026-09-30

### Added - Ponte Electron <-> Extension via HTTP localhost
- **Servidor HTTP local no Electron** (`src/server.js`):
  - Modulo `http` nativo do Node (zero dep)
  - Endpoints: `GET /location` (JSON lat/lon/heading/speed/accuracy/ts) e `GET /health`
  - CORS liberado, bind so em `127.0.0.1`
  - Fallback de porta: `3477` -> `3478` -> `3479` -> `3480`
- **IPC renderer -> main**:
  - `preload.js` expoe `window.FakeGPSBridge.publishLocation()` via contextBridge
  - `src/renderer/app.js` publica posicao a 10Hz
  - `src/main.js` recebe via IPC e repassa pro server
- **Extension consome via polling** (`poc-extension/`):
  - `content.js` (isolated world): descoberta de porta via `/health`, polling 2Hz em `/location`
  - `inject.js` (main world): recebe via `postMessage`, cache local, fallback estatico Av. Paulista
  - `manifest.json`: adicionado `content.js` em isolated world + host_permissions pra localhost
- **Teste real validado no gocollect.fun** (React + Cloudflare Turnstile):
  - Override `navigator.geolocation` indetectavel pelo site
  - Personagem no jogo caminha em tempo real conforme joystick
  - Nenhuma detecao disparada

## [0.1.0] - 2026-09-30

### Added - Spoofer desktop (Electron)
- App Electron standalone com mapa Leaflet + OpenStreetMap tiles
- Joystick virtual (nipple.js) + suporte WASD/setas
- Motor de movimento realista:
  - Modos Walk (5 km/h) e Run (12 km/h)
  - Slider de velocidade 1-20 km/h
  - Rampa de aceleracao/desaceleracao suave (~0.6s)
  - **Variacao natural de velocidade +/-1 km/h a cada ~1s** (interpolacao suave) — simula caminhada humana real
  - Conversao metros -> lat/lon com correcao de longitude por latitude
- Marcador customizado com seta rotacionada pela heading
- HUD: lat, lon, heading, velocidade em tempo real
- Botoes: Centralizar mapa, Reset posicao, Follow mode ON/OFF
- `iniciar.bat` + VS Code task (Ctrl+Shift+B no terminal integrado)
- Posicao inicial: Av. Paulista, SP (-23.561684, -46.655981)

## [0.0.1] - 2026-09-30

### Added
- POC extension `poc-extension/`: override `navigator.geolocation` com lat/lon fixo
- Stealth basico via Proxy em `Function.prototype.toString`
- Micro-jitter ±5m
- `navigator.permissions.query` mockada pra geolocation
- Validado no Brave + Google Maps
