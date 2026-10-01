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
  }
});
