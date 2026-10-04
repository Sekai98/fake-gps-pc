# PedometerHook — LSPosed Module

Módulo Xposed que injeta passos fake em apps-alvo (Mooney, WeWard, Sweatcoin, etc) interceptando o `SensorManager`.

**Precisa:** emulador rooteado (MuMu/BlueStacks/LDPlayer) + Magisk + LSPosed.

## Como funciona

1. Hook em `SensorManager.getDefaultSensor(TYPE_STEP_COUNTER)` → se sistema não tem o sensor (emulador), retorna um `Sensor` fake criado via reflection
2. Hook em `SensorManager.getSensorList(TYPE_STEP_COUNTER | TYPE_ALL)` → adiciona o fake na lista
3. Hook em `SensorManager.registerListener(..., sensor, ...)` → se sensor é TYPE_STEP_COUNTER, guarda o listener
4. Timer interno dispara `listener.onSensorChanged(SensorEvent)` com valores crescentes

O app alvo (Mooney/etc) recebe os eventos como se viessem do hardware real — não há diferença no fluxo.

## v0.4.1 (esta versão)

- ✅ Esqueleto do módulo
- ✅ Hook getDefaultSensor + getSensorList + registerListener
- ✅ Incremento hardcoded: +1 passo/segundo
- ✅ Target: `gg.mooney.app`
- 🔜 v0.4.2: ler step count do Step Tracker via ContentProvider (passos coerentes com rota/velocidade)
- 🔜 v0.4.5: WeWard + Sweatcoin targets

## Setup no emulador

1. **Magisk + LSPosed** — ver `../README.md` seção "Setup v0.4.0"
2. **Instalar este APK** (baixar `pedometer-hook-X.X.X.zip` do GitHub Actions)
3. **LSPosed Manager** → Modules → ativar "Pedometer Hook" → marcar scope `gg.mooney.app`
4. Force-stop + reabrir Mooney
5. Logs: LSPosed Manager → Logs → filtrar por tag `PedometerHook`

## Risco de detecção

- Mooney tem `isMock`/`isFromMockProvider` no DEX — isso é pra GPS mock, não pra sensor
- Mooney tem `play-services-safetynet` → precisa Shamiko + USNF no Magisk
- Hook é no process do Mooney mesmo — chamada parece 100% nativa de dentro

## Build local

```bash
cd outros-apps/mooney/xposed-module
gradle assembleDebug
# APK: app/build/outputs/apk/debug/PedometerHook-0.4.1-debug.apk
```

## Build no CI

Push qualquer coisa em `outros-apps/mooney/**` → GitHub Actions build automático. Artifact: `pedometer-hook-X.X.X.zip`.
