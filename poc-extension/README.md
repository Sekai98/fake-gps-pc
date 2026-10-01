# Fake GPS PC — POC (Proof of Concept)

> Objetivo: validar em **20 minutos** que a abordagem de override via Chrome Extension funciona no Brave antes de investir no app completo (v0.1.0).

## O que esse POC faz

- Intercepta `navigator.geolocation.getCurrentPosition()` e `watchPosition()` em **todos os sites** que você abrir
- Devolve uma localização fixa: **Av. Paulista, São Paulo** (`-23.561684, -46.655981`)
- Adiciona micro-jitter (±5m) pra parecer GPS real
- Faz `.toString()` mentir que ainda é função nativa (stealth básico)
- Finge que a permissão de geolocation foi concedida (`navigator.permissions`)

> Esse POC **não tem joystick** — é lat/lon fixo. O joystick vive no app Electron (opção desktop).

---

## Como instalar no Brave

1. Abre o Brave
2. Vai em `brave://extensions`
3. Liga o toggle **"Developer mode"** (canto superior direito)
4. Clica em **"Load unpacked"**
5. Seleciona a pasta `poc-extension` (essa pasta aqui)
6. Deve aparecer o card da extension "Fake GPS PC - POC"

## Como testar — passo a passo

### Teste 1: Google Maps (o canário)

1. Abre uma **nova aba** no Brave
2. Vai em `https://maps.google.com`
3. Clica no botão redondo de **"Minha localização"** (bússola, canto inferior direito)
4. Autoriza a permissão de localização quando pedir
5. ✅ **Esperado:** o pontinho azul aparece na **Av. Paulista, SP**, não na sua cidade real

### Teste 2: Confirmar no console

1. Com Google Maps aberto, aperta `F12` → aba **Console**
2. Deve ter uma mensagem azul: `[Fake GPS POC] ativo -> -23.561684, -46.655981`
3. Cola no console:
   ```js
   navigator.geolocation.getCurrentPosition(p => console.log(p.coords))
   ```
4. ✅ **Esperado:** aparece `{latitude: -23.561..., longitude: -46.655..., accuracy: 8...}`

### Teste 3: Stealth do toString

Cola no console:
```js
navigator.geolocation.getCurrentPosition.toString()
```
✅ **Esperado:** `"function getCurrentPosition() { [native code] }"`
❌ **Se aparecer o código da função**, o stealth falhou — me avisa.

### Teste 4: Mobile mode (teu caso de uso real)

1. No Google Maps, aperta `F12` → clica no ícone de celular/tablet (`Ctrl+Shift+M`)
2. Escolhe um device tipo "iPhone 12 Pro"
3. Recarrega a página
4. Clica em "minha localização"
5. ✅ **Esperado:** mesmo comportamento — pontinho azul na Paulista

---

## Como mudar o alvo (teste manual)

Abre `inject.js`, edita o bloco:

```js
const FAKE_LOCATION = {
  latitude: -23.561684,     // <-- MUDA AQUI
  longitude: -46.655981,    // <-- E AQUI
  accuracy: 8,
  ...
};
```

Vai em `brave://extensions`, clica no ícone de **recarregar** (⟳) do card da extension. Recarrega a aba do Google Maps. Pontinho azul vai pra nova coordenada.

Pra pegar coordenadas de qualquer lugar: Google Maps → clica com botão direito no local → primeira linha do menu é lat/lon copiável.

---

## O que esse POC **NÃO** faz

- ❌ Joystick (está no app Electron, pasta raiz do projeto)
- ❌ Movimento suave em velocidade de caminhada
- ❌ UI com mapa interativo
- ❌ Botão de ligar/desligar

---

## Se der ruim

| Sintoma | Causa provável | Fix |
|---------|---------------|-----|
| Extension não carrega | Developer mode desligado | Liga o toggle |
| Popup diz "não injetado" | Página carregada antes da extension | Recarrega a aba (F5) |
| Pontinho azul continua no lugar certo | Google Maps cacheou localização | Fecha e abre a aba, ou limpa cache |
| Erro no console `chrome.scripting is undefined` | Manifest sem permissão | Verifica se `manifest.json` tem `"scripting"` em permissions |
| Brave Shields bloqueando | Shields alto | Clica no leão do Brave e permite scripts (só pra teste) |
