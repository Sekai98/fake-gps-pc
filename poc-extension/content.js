// Content script - roda em todas abas no ISOLATED world.
// Funcao: fazer polling do servidor HTTP local do Electron e repassar pro inject.js (MAIN world)
// via window.postMessage. Tambem propaga o estado liga/desliga do popup.

const PORTS_TO_TRY = [3477, 3478, 3479, 3480];
const POLL_INTERVAL_MS = 100;    // 10Hz - mais fluido pra orientation (minigame) e movimento
const DISCOVERY_INTERVAL_MS = 5000; // se nenhuma porta responder, tenta de novo a cada 5s

const STATE_STORAGE_KEY = 'fakeGPSEnabled';
const LAST_LOCATION_KEY = 'fakeGPSLastLocation';  // ultima loc recebida do Electron, usada como fallback
const TAB_ID_STORAGE_KEY = 'fakeGPSTabId';        // alpha4: qual aba do fake GPS este Brave consome
const SERVER_IP_STORAGE_KEY = 'fakeGPSServerIp';  // v0.1.13: IP do PC (p/ Kiwi Browser mobile)
const SAVE_LOCATION_THROTTLE_MS = 3000;           // nao salva no storage mais que 1x a cada 3s

let activePort = null;
let lastDiscoveryTry = 0;
let overrideEnabled = true; // padrao: ligado
let tabId = '';             // alpha4: aba configurada no popup
let serverIp = '';          // v0.1.13: IP do PC (vazio = 127.0.0.1)
let lastSavedLocationTs = 0;

function getServerHost() {
  return serverIp || '127.0.0.1';
}

async function tryPort(port) {
  try {
    const r = await fetch('http://' + getServerHost() + ':' + port + '/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(300)
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.service === 'fake-gps-pc') return port;
    }
  } catch (e) { /* porta nao responde */ }
  return null;
}

async function discoverServer() {
  for (const p of PORTS_TO_TRY) {
    const port = await tryPort(p);
    if (port) return port;
  }
  return null;
}

function propagateEnabledState() {
  window.postMessage({
    __fakegps_poc: true,
    kind: 'enabled',
    value: overrideEnabled
  }, '*');
}

function sendLocationToInject(loc) {
  window.postMessage({
    __fakegps_poc: true,
    kind: 'location',
    location: loc
  }, '*');
}

// Persiste a ultima location recebida (throttle 3s) pra sobreviver ao Electron fechado
function persistLocation(loc) {
  const now = Date.now();
  if (now - lastSavedLocationTs < SAVE_LOCATION_THROTTLE_MS) return;
  lastSavedLocationTs = now;
  try {
    chrome.storage.local.set({ [LAST_LOCATION_KEY]: loc });
  } catch (e) { /* storage cheio ou desligado */ }
}

async function pollOnce() {
  // Se desligado pelo popup, nao faz polling nem envia locations (so inject usa gps nativo)
  if (!overrideEnabled) return;

  // Se nao sabemos qual porta, tenta descobrir (com throttle de 5s)
  if (!activePort) {
    const now = Date.now();
    if (now - lastDiscoveryTry < DISCOVERY_INTERVAL_MS) return;
    lastDiscoveryTry = now;
    activePort = await discoverServer();
    if (!activePort) return;
    console.log('[Fake GPS content] Electron encontrado na porta ' + activePort);
  }

  try {
    // v0.1.13: usa IP configurado no popup (celular Kiwi) ou 127.0.0.1 (desktop)
    const url = 'http://' + getServerHost() + ':' + activePort + '/location'
      + (tabId ? '?tab=' + encodeURIComponent(tabId) : '');
    const r = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(300)
    });
    if (!r.ok) { activePort = null; return; }
    const loc = await r.json();
    sendLocationToInject(loc);
    persistLocation(loc);
  } catch (e) {
    // Servidor caiu / Electron fechou
    activePort = null;
  }
}

// --- Inicializacao: le estado + ultima location salva + tabId + serverIp configurados ---
chrome.storage.local.get([STATE_STORAGE_KEY, LAST_LOCATION_KEY, TAB_ID_STORAGE_KEY, SERVER_IP_STORAGE_KEY], function (data) {
  overrideEnabled = data[STATE_STORAGE_KEY] !== false;
  tabId = data[TAB_ID_STORAGE_KEY] || '';
  serverIp = data[SERVER_IP_STORAGE_KEY] || '';
  propagateEnabledState();
  if (tabId) console.log('[Fake GPS content] configurado pra aba: ' + tabId);
  if (serverIp) console.log('[Fake GPS content] servidor remoto: ' + serverIp);
  if (data[LAST_LOCATION_KEY]) {
    sendLocationToInject(data[LAST_LOCATION_KEY]);
    console.log(
      '[Fake GPS content] usando ultima localizacao salva: '
      + data[LAST_LOCATION_KEY].lat.toFixed(5) + ', ' + data[LAST_LOCATION_KEY].lon.toFixed(5)
    );
  }
});

// Observa mudancas no estado (popup liga/desliga, troca tabId, troca serverIp)
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes[STATE_STORAGE_KEY]) {
    overrideEnabled = changes[STATE_STORAGE_KEY].newValue !== false;
    propagateEnabledState();
    if (!overrideEnabled) activePort = null;
  }
  if (changes[TAB_ID_STORAGE_KEY]) {
    tabId = changes[TAB_ID_STORAGE_KEY].newValue || '';
    console.log('[Fake GPS content] tabId trocado pra: ' + (tabId || '(vazio)'));
  }
  if (changes[SERVER_IP_STORAGE_KEY]) {
    serverIp = changes[SERVER_IP_STORAGE_KEY].newValue || '';
    activePort = null;  // forca re-descoberta no novo IP
    console.log('[Fake GPS content] serverIp trocado pra: ' + (serverIp || '127.0.0.1'));
  }
});

setInterval(pollOnce, POLL_INTERVAL_MS);
pollOnce();

// --- Ponte: crates detectados pelo inject.js vao pro Electron via POST /crates ---
window.addEventListener('message', async function (evt) {
  if (evt.source !== window) return;
  const d = evt.data;
  if (!d) return;

  // v0.1.14: Token Bearer do gocollect capturado automaticamente
  if (d.__fakegps_gocollect_token === true && typeof d.token === 'string') {
    let port = activePort;
    if (!port) {
      port = await discoverServer();
      if (!port) return;
      activePort = port;
    }
    try {
      await fetch('http://' + getServerHost() + ':' + port + '/gocollect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: d.token, ts: d.ts }),
        cache: 'no-store'
      });
    } catch (e) { /* server caiu, perde esse batch */ }
    return;
  }

  // v0.1.27: debug log de todas as /v1/* do gocollect
  if (d.__fakegps_gc_debug === true) {
    let port = activePort;
    if (!port) {
      port = await discoverServer();
      if (!port) return;
      activePort = port;
    }
    try {
      await fetch('http://' + getServerHost() + ':' + port + '/gc-debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reqTs: d.reqTs, resTs: d.resTs, url: d.url, method: d.method,
          reqBody: d.reqBody, status: d.status, resBody: d.resBody
        }),
        cache: 'no-store'
      });
    } catch (e) { /* server pode estar off ou logger desligado */ }
    return;
  }

  if (d.__fakegps_crates !== true) return;
  if (!overrideEnabled) return;
  let port = activePort;
  if (!port) {
    port = await discoverServer();
    if (!port) return;
    activePort = port;
  }
  try {
    await fetch('http://' + getServerHost() + ':' + port + '/crates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crates: d.crates, lures: d.lures || [], ts: d.ts }),
      cache: 'no-store'
    });
  } catch (e) { /* servidor caiu, perde esse batch */ }
});
