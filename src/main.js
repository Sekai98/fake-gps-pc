const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Server = require('./server');

let serverInfo = null;
let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: 'Fake GPS PC v0.1.11.6',
    backgroundColor: '#0f1419',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
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

app.whenReady().then(async () => {
  try {
    serverInfo = await Server.start();
    console.log('[main] HTTP server up on port', serverInfo.port);
  } catch (err) {
    console.error('[main] failed to start HTTP server:', err.message);
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
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
