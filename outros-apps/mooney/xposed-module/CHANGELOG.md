# Changelog — PedometerHook (LSPosed module)

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), SemVer.

Projeto independente do Step Tracker — tem versionamento próprio.

## [0.4.1] - 2026-10-04 - Esqueleto do módulo

### Added
- Projeto Android separado em `outros-apps/mooney/xposed-module/`
- Entry point `com.stepinjector.xposed.PedometerHook` registrado em `assets/xposed_init`
- `AndroidManifest.xml` com meta-data `xposedmodule=true`
- Dependência `de.robv.android.xposed:api:82` (compileOnly)
- Hooks em `SensorManager`:
  - `getDefaultSensor(TYPE_STEP_COUNTER | TYPE_STEP_DETECTOR)` → fabrica Sensor fake se sistema não tem
  - `getSensorList(TYPE_ALL | TYPE_STEP_COUNTER)` → adiciona fake na lista
  - `registerListener(SensorEventListener, Sensor, int)` (2 overloads) → captura listener
  - `unregisterListener(SensorEventListener)` → remove listener
- Timer interno a 1Hz chama `listener.onSensorChanged(SensorEvent)` com `cumulativeSteps += 1`
- `createFakeSensor()`: cria Sensor via reflection do construtor privado + preenche fields
- `createSensorEvent()`: cria SensorEvent via reflection + preenche sensor/accuracy/timestamp/values
- Target package list (atualmente só `gg.mooney.app`; expandir pra WeWard/Sweatcoin em v0.4.5)
- `InfoActivity` placeholder pro user confirmar instalação
- GitHub Actions job `xposed-module` no workflow `mooney-build.yml` que builda APK debug e sobe artifact `pedometer-hook-X.X.X`

### Design decisions
- **compileOnly xposed-api**: o API fica embutido no LSPosed em runtime, não deve ser bundled
- **Hook em `SensorManager`** (classe pública) ao invés de `SystemSensorManager` (implementação): mais estável entre versões Android
- **Target explicit (não all packages)**: evita impacto global e logs ruidosos
- **Lista de listeners thread-safe (`CopyOnWriteArrayList`)**: callbacks podem rodar em thread do Handler do app
- **Reflection pra Sensor/SensorEvent**: ambos têm construtores package-private — Xposed API já normaliza acesso

### Not implemented (próximas versões)
- v0.4.2: ContentProvider no Step Tracker expõe `cumulativeSteps` live; módulo lê e usa no lugar do +1/s hardcoded
- v0.4.3: coerência com velocidade do autopilot (5 km/h ≈ 100 passos/min, 12 km/h ≈ 290)
- v0.4.5: WeWard + Sweatcoin targets
- v0.4.6: fallback se LSPosed não tiver scope marcado — avisa no InfoActivity

### Files
- CREATE `outros-apps/mooney/xposed-module/settings.gradle`
- CREATE `outros-apps/mooney/xposed-module/build.gradle`
- CREATE `outros-apps/mooney/xposed-module/gradle.properties`
- CREATE `outros-apps/mooney/xposed-module/app/build.gradle`
- CREATE `outros-apps/mooney/xposed-module/app/src/main/AndroidManifest.xml`
- CREATE `outros-apps/mooney/xposed-module/app/src/main/assets/xposed_init`
- CREATE `outros-apps/mooney/xposed-module/app/src/main/java/com/stepinjector/xposed/PedometerHook.kt`
- CREATE `outros-apps/mooney/xposed-module/app/src/main/java/com/stepinjector/xposed/InfoActivity.kt`
- CREATE `outros-apps/mooney/xposed-module/README.md`
- CREATE `outros-apps/mooney/xposed-module/CHANGELOG.md`
- EDIT `.github/workflows/mooney-build.yml` (job xposed-module)
