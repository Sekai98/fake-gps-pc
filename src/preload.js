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
  },
  // v0.1.14: integração com gocollect.fun (listador de beacons)
  gocollect: {
    fetchLures: function (lat, lng) {
      try { return ipcRenderer.invoke('gocollect:fetch-lures', { lat: lat, lng: lng }); }
      catch (e) { return Promise.resolve({ ok: false, error: 'ipc-fail' }); }
    },
    getTokenStatus: function () {
      try { return ipcRenderer.invoke('gocollect:get-token-status'); }
      catch (e) { return Promise.resolve({ hasToken: false }); }
    },
    clearToken: function () {
      try { return ipcRenderer.invoke('gocollect:clear-token'); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    saveToken: function (token) {
      try { return ipcRenderer.invoke('gocollect:save-token', token); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    scanRegion: function (lat, lng, radiusKm, pacingMs, concurrency) {
      try { return ipcRenderer.invoke('gocollect:scan-region', { lat: lat, lng: lng, radiusKm: radiusKm, pacingMs: pacingMs, concurrency: concurrency }); }
      catch (e) { return Promise.resolve({ ok: false, error: 'ipc-fail' }); }
    },
    cancelScan: function () {
      try { return ipcRenderer.invoke('gocollect:cancel-scan'); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    fetchCratePreview: function (lat, lng) {
      try { return ipcRenderer.invoke('gocollect:fetch-crate-preview', { lat: lat, lng: lng }); }
      catch (e) { return Promise.resolve({ ok: false, error: 'ipc-fail' }); }
    },
    // v0.1.27: Logger de investigação
    debugToggle: function (enabled) {
      try { return ipcRenderer.invoke('gc-debug:toggle', !!enabled); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    debugGetStatus: function () {
      try { return ipcRenderer.invoke('gc-debug:get-status'); }
      catch (e) { return Promise.resolve({ count: 0 }); }
    },
    debugOpenFolder: function () {
      try { return ipcRenderer.invoke('gc-debug:open-folder'); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    debugClear: function () {
      try { return ipcRenderer.invoke('gc-debug:clear'); }
      catch (e) { return Promise.resolve({ ok: false }); }
    },
    debugTestChallenge: function (crateId) {
      try { return ipcRenderer.invoke('gc-debug:test-challenge', crateId); }
      catch (e) { return Promise.resolve({ ok: false, error: 'ipc-fail' }); }
    },
    onDebugCount: function (cb) {
      if (typeof cb !== 'function') return;
      ipcRenderer.on('gc-debug:count', function (_evt, count) {
        try { cb(count); } catch (e) {}
      });
    },
    onScanProgress: function (cb) {
      if (typeof cb !== 'function') return;
      ipcRenderer.on('gocollect:scan-progress', function (_evt, payload) {
        try { cb(payload); } catch (e) {}
      });
    },
    onScanLuresFound: function (cb) {
      if (typeof cb !== 'function') return;
      ipcRenderer.on('gocollect:scan-lures-found', function (_evt, payload) {
        try { cb(payload); } catch (e) {}
      });
    },
    onScanCratesFound: function (cb) {
      if (typeof cb !== 'function') return;
      ipcRenderer.on('gocollect:scan-crates-found', function (_evt, payload) {
        try { cb(payload); } catch (e) {}
      });
    },
    onTokenUpdated: function (cb) {
      if (typeof cb !== 'function') return;
      ipcRenderer.on('gocollect:token-updated', function (_evt, payload) {
        try { cb(payload); } catch (e) {}
      });
    }
  }
});
