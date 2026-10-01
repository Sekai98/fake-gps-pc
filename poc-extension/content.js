// Content script - roda em todas abas no ISOLATED world.
// Funcao: fazer polling do servidor HTTP local do Electron e repassar pro inject.js (MAIN world)
// via window.postMessage. Tambem propaga o estado liga/desliga do popup.

const PORTS_TO_TRY = [3477, 3478, 3479, 3480];
const POLL_INTERVAL_MS = 500;    // 2Hz - mais que suficiente, GPS real callback e 1Hz
const DISCOVERY_INTERVAL_MS = 5000; // se nenhuma porta responder, tenta de novo a cada 5s

const STATE_STORAGE_KEY = 'fakeGPSEnabled';
const LAST_LOCATION_KEY = 'fakeGPSLastLocation';  // ultima loc recebida do Electron, usada como fallback
const SAVE_LOCATION_THROTTLE_MS = 3000;           // nao salva no storage mais que 1x a cada 3s

let activePort = null;
let lastDiscoveryTry = 0;
let overrideEnabled = true; // padrao: ligado
let lastSavedLocationTs = 0;

async function tryPort(port) {
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/health', {
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
    const r = await fetch('http://127.0.0.1:' + activePort + '/location', {
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

// --- Inicializacao: le estado + ultima location salva ---
chrome.storage.local.get([STATE_STORAGE_KEY, LAST_LOCATION_KEY], function (data) {
  // Default: ligado (se nunca foi setado)
  overrideEnabled = data[STATE_STORAGE_KEY] !== false;
  propagateEnabledState();
  // Fallback inicial: se tem ultima location salva, usa ela como baseline
  // (antes do inject.js cair pro fallback estatico Paulista)
  if (data[LAST_LOCATION_KEY]) {
    sendLocationToInject(data[LAST_LOCATION_KEY]);
    console.log(
      '[Fake GPS content] usando ultima localizacao salva: '
      + data[LAST_LOCATION_KEY].lat.toFixed(5) + ', ' + data[LAST_LOCATION_KEY].lon.toFixed(5)
    );
  }
});

// Observa mudancas no estado (quando popup liga/desliga)
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!changes[STATE_STORAGE_KEY]) return;
  overrideEnabled = changes[STATE_STORAGE_KEY].newValue !== false;
  propagateEnabledState();
  if (!overrideEnabled) {
    // Desligou: solta a porta pra forcar redescoberta quando reativar
    activePort = null;
  }
});

setInterval(pollOnce, POLL_INTERVAL_MS);
pollOnce();

// --- Ponte: crates detectados pelo inject.js vao pro Electron via POST /crates ---
window.addEventListener('message', async function (evt) {
  if (evt.source !== window) return;
  const d = evt.data;
  if (!d || d.__fakegps_crates !== true) return;
  if (!overrideEnabled) return; // nao envia se extension esta desligada
  // Precisa de porta ativa; se nao tiver, tenta descobrir
  let port = activePort;
  if (!port) {
    port = await discoverServer();
    if (!port) return;
    activePort = port;
  }
  try {
    await fetch('http://127.0.0.1:' + port + '/crates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crates: d.crates, lures: d.lures || [], ts: d.ts }),
      cache: 'no-store'
    });
  } catch (e) { /* servidor caiu, perde esse batch */ }
});
