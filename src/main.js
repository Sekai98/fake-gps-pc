const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const Server = require('./server');

// Chromium bloqueia background windows por default - desabilita antes mesmo
// de criar o renderer pra garantir que o flag pegue
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let serverInfo = null;
let mainWin = null;
let powerSaveBlockerId = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: 'Fake GPS PC v0.1.14',
    backgroundColor: '#0f1419',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // Chrome throttles rAF/setInterval em janelas minimizadas/background.
      // Desligar isso faz o tick loop e publishLocation continuarem a 60Hz/10Hz
      // mesmo com outro app por cima.
      backgroundThrottling: false
    }
  });

  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // F12 pra DevTools
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') mainWin.webContents.toggleDevTools();
  });

  mainWin.on('closed', () => { mainWin = null; });
}

// Renderer publica posicao atual pelo canal IPC
ipcMain.on('fake-gps:update', (event, loc) => {
  Server.updateLocation(loc);
});

// v0.1.14: Renderer publica lista de abas (pra extension listar no dropdown)
ipcMain.on('fake-gps:update-tabs', (event, tabs) => {
  Server.updateTabsList(tabs);
});

// Renderer pergunta quais IPs da LAN sao usaveis pra celular conectar
ipcMain.handle('fake-gps:get-local-ips', () => {
  try {
    return {
      port: serverInfo ? serverInfo.port : 3477,
      httpsPort: serverInfo ? serverInfo.httpsPort : null,
      ips: Server.getLocalIps()
    };
  } catch (e) {
    return { port: 3477, httpsPort: null, ips: [] };
  }
});

app.whenReady().then(async () => {
  try {
    serverInfo = await Server.start();
    console.log('[main] HTTP server up on port', serverInfo.port);
  } catch (err) {
    console.error('[main] failed to start HTTP server:', err.message);
  }
  // Previne Windows/macOS de suspender o processo. Essencial pra fake GPS
  // continuar atualizando posicao mesmo quando janela minimizada ou outro
  // app em tela cheia.
  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[main] powerSaveBlocker ativo (id=' + powerSaveBlockerId + ')');
  } catch (e) {
    console.warn('[main] powerSaveBlocker falhou:', e.message);
  }
  // Quando o server receber crates da extension, repassa pro renderer
  Server.setOnCrates((payload) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('fake-gps:crates', payload);
    }
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (powerSaveBlockerId !== null) {
    try { powerSaveBlocker.stop(powerSaveBlockerId); } catch (e) {}
    powerSaveBlockerId = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
