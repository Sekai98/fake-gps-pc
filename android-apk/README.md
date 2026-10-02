# FakeGPS - Android APK

App Android com **joystick flutuante** que fornece **mock location** pro sistema inteiro. gocollect.fun no Chrome mobile pega a localização falsa.

## Como funciona

```
┌─────────────────────────────┐
│  Chrome/Brave mobile        │
│  https://gocollect.fun      │
│  ← pede localização ao OS   │
└─────────────────────────────┘
             ▲
             │ coords falsas
             │
┌─────────────────────────────┐
│  Android LocationManager    │
│  ← pega mock do app FakeGPS │
└─────────────────────────────┘
             ▲
             │ setTestProviderLocation
             │
┌─────────────────────────────┐
│  FakeGPS App (background)   │
│  • Foreground Service       │
│  • Joystick flutuante 🕹️   │
│  • Mock location 10Hz       │
└─────────────────────────────┘
```

## Como compilar o APK

### Caminho 1 - GitHub Actions (recomendado)

1. Cria repo no GitHub, sobe o projeto todo (`git push`)
2. GitHub Actions compila automaticamente a cada push em `android-apk/**`
3. Aba `Actions` → último run → `Artifacts` → baixa `fake-gps-apk.zip`
4. Extrai o APK e transfere pro celular

### Caminho 2 - Android Studio local

1. Baixa Android Studio: https://developer.android.com/studio
2. Abre o projeto `android-apk/`
3. `Build → Build Bundle(s) / APK(s) → Build APK(s)`
4. APK em `app/build/outputs/apk/debug/app-debug.apk`

## Instalar no celular

1. **Autorizar fontes desconhecidas**: Configurações → Segurança → "Instalar apps desconhecidos" → autoriza o navegador/transferencia que vai receber o APK
2. Transfere o APK pro celular (USB, email, Drive, etc)
3. Toca no APK, instala
4. Abre o app "FakeGPS"

## Primeira configuração no celular

O app vai te guiar passo a passo, mas pra conferência:

### 1. Autorizar "Desenhar sobre outros apps"
- O app abre as configurações sozinho
- Ativa a chave pra FakeGPS
- Volta pro app

### 2. Autorizar localização
- Botão no app pede
- Clica "Permitir enquanto usa o app"

### 3. Autorizar notificações (Android 13+)
- Botão no app pede
- Clica "Permitir"

### 4. Ativar "App de localização simulada" (SO uma vez)
- Primeiro: ativar **Opções do desenvolvedor**:
  - Configurações → Sobre o telefone → **toca 7 vezes em "Número da versão"**
  - Aparece msg "Você já é um desenvolvedor"
- Agora: Configurações → Sistema → Opções do desenvolvedor
- Rola até **"Selecionar app de localização simulada"**
- Seleciona **FakeGPS**

### 5. Pronto
- Click no botão verde "▶ Iniciar Fake GPS"
- Vai aparecer um **joystick azul flutuante** no canto da tela
- **Minimize o app** (botão home)
- **Abre o Chrome**, vai em `https://gocollect.fun/`
- O site pede permissão de localização → autoriza
- Localização inicial: Av. Paulista, São Paulo
- **Mexe o joystick flutuante** → você se move no mapa

## Posição inicial

Av. Paulista, São Paulo (-23.561684, -46.655981). Mesmo default do app Electron.

## Status atual

- v0.2.0-alpha1: joystick flutuante + mock location + walking a 5 km/h fixo
- v0.2.0-alpha2: presets de velocidade (walk/run/car)
- v0.2.0-alpha3: persistência de posição + joystick arrastável
- v0.2.0-alpha4: mapa com TP e autopilot, notif dinâmica com km restantes, toggle drag no overlay
- **v0.2.0-alpha5** (agora): fixes - joystick não trava mais, marker do mapa segue personagem, precisão GPS maior (20Hz + accuracy 2m + mock NETWORK)
- v0.2.0: release com orientação 3D opcional

## Como usar o mapa (alpha4)

1. Abre o app FakeGPS, clica **🗺 Abrir mapa**.
2. Modo **TP** (default): toque no mapa teleporta imediatamente.
3. Modo **Andar sozinho**: ativa a checkbox no canto superior direito; toque no mapa gera a rota a pé (OSRM) e o personagem começa a andar sozinho na velocidade do preset ativo (walk/run/car).
4. Durante rota, a notificação mostra `X.XX km restantes - Y.Y km/h`. Botões: `Parar rota`, `Joystick` (reabre overlay se foi fechado), `Parar app`.
5. O botão `⋮⋮` no cabeçalho do joystick é um **toggle de modo mover**: ativa → arrasta o overlay inteiro, desativa → joystick normal.
