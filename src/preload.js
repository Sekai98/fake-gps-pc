// Preload - ponte segura entre renderer e main process via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('FakeGPSBridge', {
  publishLocation: function (loc) {
    try { ipcRenderer.send('fake-gps:update', loc); } catch (e) { /* silencio */ }
  },
  // Callback pra receber crates detectados pela extension (via server /crates)
  onCrates: function (cb) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('fake-gps:crates', function (_evt, payload) {
      try { cb(payload); } catch (e) { /* silencio */ }
    });
  },
  // v0.1.13: IPs locais da LAN (pra celular remoto conectar via /sensor)
  getLocalIps: function () {
    try { return ipcRenderer.invoke('fake-gps:get-local-ips'); }
    catch (e) { return Promise.resolve({ port: 3477, ips: [] }); }
  },
  // v0.1.14: publica lista de abas pra extension listar no dropdown
  publishTabsList: function (tabs) {
    try { ipcRenderer.send('fake-gps:update-tabs', tabs); } catch (e) {}
  }
});
