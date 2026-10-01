# Fake GPS PC

App desktop pra simular localizacao GPS com joystick virtual - roda no Windows.

## Status atual: v0.1.0 (standalone)

- Mapa interativo (Leaflet + OpenStreetMap)
- Joystick virtual + teclado WASD/setas
- Caminhada realista (5 km/h default, ajustavel)
- Modos Walk / Run
- Marcador com direcao visualizada

**Nesta versao o app roda standalone** - voce controla o marcador dentro da janela do Electron. A conexao com o navegador (pra mover sua localizacao em sites como Google Maps) chega no **v0.1.3**.

---

## Como rodar

### Opcao 1 - Duplo clique
Clique duplo em `iniciar.bat`. Primeira vez baixa Electron (~80MB), depois abre direto.

### Opcao 2 - VS Code
Abra a pasta no VS Code -> `Ctrl+Shift+B` -> roda no terminal integrado.

### Opcao 3 - Terminal manual
```
npm install   # so primeira vez
npm start
```

---

## Controles

| Input | Acao |
|-------|------|
| Joystick (mouse) | Mover em qualquer direcao, velocidade proporcional ao quanto empurra |
| W / Seta cima | Norte |
| S / Seta baixo | Sul |
| A / Seta esquerda | Oeste |
| D / Seta direita | Leste |
| Walk / Run | Troca velocidade maxima (5 ou 12 km/h) |
| Slider | Ajuste fino 1-20 km/h |
| Centralizar | Puxa mapa pra posicao atual |
| Reset | Volta pra Av. Paulista |
| Seguir ON/OFF | Mapa segue o marcador automaticamente |

---

## Estrutura

```
.
├── iniciar.bat                <-- clique aqui pra abrir
├── package.json
├── src/
│   ├── main.js                <-- processo Electron
│   ├── preload.js
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       ├── map.js             <-- Leaflet + marcador
│       ├── joystick.js        <-- nipple.js + WASD
│       ├── movement.js        <-- motor de caminhada
│       └── app.js             <-- orquestrador + loop
├── poc-extension/             <-- extension do POC (v0.0.1), ja validada
├── .vscode/tasks.json         <-- Ctrl+Shift+B
├── CHANGELOG.md
└── README.md
```

---

## Roadmap

- [x] **v0.0.1** POC extension validada no Brave + Google Maps
- [x] **v0.1.0** App Electron standalone com mapa + joystick
- [ ] **v0.1.1** Jitter de GPS mais realista, aceleracao variavel
- [ ] **v0.1.2** Servidor HTTP local (`localhost:3477/location`)
- [ ] **v0.1.3** Extension consome o servidor local -> joystick controla pontinho no Google Maps
- [ ] **v0.1.4** Favoritos, historico, teleporte por clique no mapa
- [ ] **v0.1.5** Spoof DeviceMotion (fallback contra sites que cruzam sensores)
- [ ] **v0.1.6** Gravacao/replay de rotas

---

## Requisitos

- Windows 10/11
- Node.js 18+ (recomendado 20+ LTS)
- ~400 MB livre (Electron ocupa espaco)
- Internet (pros tiles do mapa)

## Troubleshooting

| Sintoma | Fix |
|---------|-----|
| `iniciar.bat` fecha instantaneo | Abre cmd, roda manualmente, veja o erro |
| "Node.js nao encontrado" | Instale em https://nodejs.org/ |
| Mapa fica cinza | Sem internet - OSM precisa carregar os tiles online |
| Joystick nao responde | Clica DENTRO da janela do app primeiro pra ela ter foco |
| F12 nao abre DevTools | Clica no mapa primeiro, depois aperta F12 |
