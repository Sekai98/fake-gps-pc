# Step Tracker — Mooney integration

App Android companion que escreve `StepsRecord` no **Health Connect** do Android.
Qualquer app que leia Health Connect (Mooney nativamente, Weward com fonte "Google Fit")
vai contar esses passos como se fossem do pedômetro físico.

## Requisitos

- Android 10 (API 28) ou superior
- Health Connect instalado (pré-instalado em Android 14+; Play Store em versões anteriores)
- Conta "scout" queimável no Mooney/Weward (nunca na conta principal)

## PoC v0.1.0 (atual)

MVP mínimo:
- Botão "Injetar 1000 passos AGORA"
- Lê total do dia do Health Connect e mostra
- Pede permissão `WRITE_STEPS` + `READ_STEPS` na primeira abertura

**Objetivo**: validar que a injeção funciona e que Mooney/Weward leem.

## Como testar com Mooney

1. Instalar Mooney na Play Store
2. Em Mooney, conectar à Health Connect (Settings → Connected apps)
3. Rodar Step Tracker, pressionar "Injetar 1000 passos"
4. Abrir Mooney e verificar se o contador subiu

## Roadmap

| Versão | Features |
|---|---|
| **v0.1.0** (atual) | PoC manual — botão único, injeta 1000 passos |
| v0.2.0 | Foreground Service com loop natural + horário ativo configurável |
| v0.3.0 | Config detalhada: taxa, pausas, variação de cadência |
| v0.4.0 | Fallback direct API (`push_step_record` do WeWard) sem Health Connect |

## Package Android

- Namespace: `com.stepinjector`
- Label: "Step Tracker" (genérico pra não triggar anti-cheat baseado em nome)

## Build local

```bash
cd outros-apps/mooney/android-apk
gradle assembleDebug
# APK em app/build/outputs/apk/debug/StepTracker-0.1.0-debug.apk
```

## Build CI

Push na branch `main` em arquivos de `outros-apps/mooney/**` dispara GitHub Actions
que compila e sobe artifact `step-tracker-apk-0.1.0.zip`.

## Riscos

- `dataOrigin` do Health Connect marca este app como fonte dos passos. Mooney/Weward **podem** filtrar por fonte autorizada.
- Mooney/Weward ToS proíbem geração artificial de passos. Risco de ban.
- **Nunca** rodar na conta principal.
