const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const Server = require('./server');
const GocollectAPI = require('./gocollect-api');

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

// --- v0.1.14: integração com gocollect.fun (listador de beacons) ---

function gocollectTokenPath() {
  return path.join(app.getPath('userData'), 'gocollect.json');
}

function readGocollectToken() {
  try {
    const raw = fs.readFileSync(gocollectTokenPath(), 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj.token === 'string' && obj.token.length > 0) ? obj.token : null;
  } catch (e) {
    return null;
  }
}

function writeGocollectToken(token) {
  try {
    fs.writeFileSync(gocollectTokenPath(), JSON.stringify({
      token: token,
      savedAt: Date.now()
    }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[main] falha ao salvar gocollect.json:', e.message);
    return false;
  }
}

function clearGocollectToken() {
  try { fs.unlinkSync(gocollectTokenPath()); } catch (e) { /* ignore */ }
}

ipcMain.handle('gocollect:fetch-lures', async (_evt, params) => {
  const token = readGocollectToken();
  if (!token) return { ok: false, error: 'no-token' };
  const lat = params && typeof params.lat === 'number' ? params.lat : null;
  const lng = params && typeof params.lng === 'number' ? params.lng : null;
  if (lat === null || lng === null) return { ok: false, error: 'bad-coords' };
  try {
    const data = await GocollectAPI.fetchCrates(token, lat, lng);
    const lures = GocollectAPI.extractNearbyLures(data, lat, lng);
    return { ok: true, lures: lures, crateCount: data.crates.length };
  } catch (e) {
    const code = e.status === 401 ? 'unauthorized' : 'fetch-error';
    return { ok: false, error: code, message: e.message };
  }
});

ipcMain.handle('gocollect:get-token-status', () => {
  const token = readGocollectToken();
  return {
    hasToken: !!token,
    tokenPreview: token ? (token.slice(0, 6) + '...' + token.slice(-4)) : null
  };
});

ipcMain.handle('gocollect:clear-token', () => {
  clearGocollectToken();
  return { ok: true };
});

ipcMain.handle('gocollect:save-token', (_evt, token) => {
  if (typeof token !== 'string' || token.trim().length < 10) {
    return { ok: false, error: 'token-invalido' };
  }
  const clean = token.trim();
  const saved = writeGocollectToken(clean);
  if (saved && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('gocollect:token-updated', {
      hasToken: true,
      tokenPreview: clean.slice(0, 6) + '...' + clean.slice(-4)
    });
  }
  return { ok: saved };
});

// Hook pro server.js chamar quando a extension postar o token em /gocollect-token
Server.setOnGocollectToken((token) => {
  if (writeGocollectToken(token) && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('gocollect:token-updated', {
      hasToken: true,
      tokenPreview: token.slice(0, 6) + '...' + token.slice(-4)
    });
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
