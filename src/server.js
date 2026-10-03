// Servidor HTTP local do Electron.
// Endpoints:
//   GET  /location  - posicao atual do joystick (lida pela extension)
//   POST /crates    - lista de crates detectada pela extension (encaminhada ao renderer)
//   GET  /health    - heartbeat pra extension descobrir a porta
// Zero deps (modulo http nativo). Fallback de porta se 3477 estiver ocupada.

const http = require('http');
const https = require('https');
const os = require('os');
const selfsigned = require('selfsigned');

const DEFAULT_PORTS = [3477, 3478, 3479, 3480];
const HTTPS_PORT = 3443;  // v0.1.13: HTTPS pro celular (DeviceOrientationEvent exige secure context)

// IPs locais nao-loopback (pra celular conectar via LAN).
// Prioriza: WiFi/LAN tipica (192.168.X.X > 10.X.X.X > 172.16-31.X.X)
// Despioriza: VPN (Radmin 26.X.X.X, Hamachi 25.X.X.X), WSL/Docker (172.17-19/21/29/30),
//             APIPA (169.254), interfaces com "vEthernet", "WSL", "Hyper-V" no nome
function getLocalIps() {
  const ifaces = os.networkInterfaces();
  const all = [];
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (addr) {
      if (addr.family === 'IPv4' && !addr.internal) {
        all.push({ name: name, address: addr.address });
      }
    });
  });
  // Score: maior = mais provavel de ser WiFi real
  function scoreOf(ip) {
    const a = ip.address;
    const name = (ip.name || '').toLowerCase();
    // Deprioriza nomes de VPN / virtual adapters
    if (/vethernet|hyper-?v|wsl|vpn|hamachi|radmin|zerotier|tailscale|docker|loopback/.test(name)) return -100;
    // 192.168.X.X - LAN domestica tipica (prioridade MAX)
    if (/^192\.168\./.test(a)) return 100;
    // 10.X.X.X - LAN corporativa ou alguns routers
    if (/^10\./.test(a)) return 80;
    // 172.16-31 - DHCP padrao, mas Docker/WSL tambem usa
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(a)) return 40;
    // 26.X / 25.X - VPN tipica (Radmin, Hamachi)
    if (/^26\./.test(a) || /^25\./.test(a)) return -50;
    // 169.254.X.X - APIPA (sem DHCP) - geralmente nao funciona
    if (/^169\.254\./.test(a)) return -80;
    return 0;
  }
  all.sort(function (x, y) { return scoreOf(y) - scoreOf(x); });
  return all;
}
const MAX_BODY_SIZE = 512 * 1024; // 512 KB (gocollect manda ~1-5 KB por batch)

const DEFAULT_TAB = '_default_';
const DEFAULT_LOCATION = {
  lat: -23.561684,
  lon: -46.655981,
  heading: 0,
  speedMps: 0,
  accuracy: 8,
  ts: Date.now()
};
const DEFAULT_ORIENTATION = { alpha: 0, beta: 70, gamma: 0, ts: Date.now() };

// Multi-tab (alpha4): location e orientation por tabId.
// Default (sem tabId) usada por extensions antigas / testes.
const locationsByTab = { [DEFAULT_TAB]: Object.assign({}, DEFAULT_LOCATION) };
const orientationsByTab = { [DEFAULT_TAB]: Object.assign({}, DEFAULT_ORIENTATION) };
let lastUpdatedTab = DEFAULT_TAB;

// Callback registrado pelo main.js. Dispara quando chega POST /crates.
let onCratesCallback = null;
function setOnCrates(fn) { onCratesCallback = (typeof fn === 'function') ? fn : null; }

// v0.1.14: Callback do main.js quando a extension postar o token do gocollect.
let onGocollectTokenCallback = null;
function setOnGocollectToken(fn) { onGocollectTokenCallback = (typeof fn === 'function') ? fn : null; }

// Lista de abas publicada pelo renderer (v0.1.14 - pra extension listar no dropdown)
let currentTabsList = [];
function updateTabsList(tabs) {
  if (Array.isArray(tabs)) currentTabsList = tabs;
}

// Timestamp da ultima orientacao vinda do SENSOR REMOTO (celular via WiFi).
// Se ha menos de 2s, considera o celular ativo e ignora orientation vinda do renderer local.
const remoteOrientationTs = {};  // { tabId: timestamp }
const REMOTE_FRESH_MS = 2000;

// Suavizacao: media movel das ultimas N amostras do sensor remoto
// pra reduzir tremor da bussola/giroscopio em sites como Google Maps.
const ORI_SMOOTH_WINDOW = 8;  // ~400ms @ 20Hz
const orientationBuffer = [];

// Media circular pra alpha (angulos 0-360 nao sao lineares - 359 e 1 estao proximos)
function circularMean(angles) {
  let sx = 0, sy = 0;
  angles.forEach(function (a) {
    const rad = a * Math.PI / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  });
  const mean = Math.atan2(sy / angles.length, sx / angles.length) * 180 / Math.PI;
  return (mean + 360) % 360;
}

// Diferenca entre dois angulos cuidando do wrap 0/360
function angleDiff(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return Math.abs(d);
}

function pushOrientationSample(data) {
  const last = orientationBuffer.length > 0
    ? orientationBuffer[orientationBuffer.length - 1]
    : null;

  // Filtro anti-gimbal-lock: quando beta ~= +/-90, pequena mudanca fisica
  // causa saltos simultaneos em alpha E gamma. Descarta esses updates.
  if (last) {
    const dA = angleDiff(data.alpha, last.alpha);
    const dG = Math.abs(data.gamma - last.gamma);
    const dB = Math.abs(data.beta - last.beta);
    const betaExtreme = Math.abs(data.beta) > 75 || Math.abs(last.beta) > 75;
    if (betaExtreme && dA > 60 && dG > 40) {
      // Gimbal lock detectado - mantem valores anteriores (nao atualiza)
      return { alpha: last.alpha, beta: last.beta, gamma: last.gamma };
    }
  }

  // Adaptativo: se mudanca grande (>30 graus em qualquer eixo), bypass smoothing
  // Serve pra giros rapidos (destravar fechadura) nao terem lag.
  const SHARP_CHANGE_DEG = 30;
  const bigChange = last && (
    angleDiff(data.alpha, last.alpha) > SHARP_CHANGE_DEG ||
    Math.abs(data.beta - last.beta) > SHARP_CHANGE_DEG ||
    Math.abs(data.gamma - last.gamma) > SHARP_CHANGE_DEG
  );
  if (bigChange) {
    orientationBuffer.length = 0;
    orientationBuffer.push({ alpha: data.alpha, beta: data.beta, gamma: data.gamma });
    return { alpha: data.alpha, beta: data.beta, gamma: data.gamma };
  }

  orientationBuffer.push({ alpha: data.alpha, beta: data.beta, gamma: data.gamma });
  if (orientationBuffer.length > ORI_SMOOTH_WINDOW) orientationBuffer.shift();
  const n = orientationBuffer.length;
  if (n < 2) return { alpha: data.alpha, beta: data.beta, gamma: data.gamma };
  const alphas = orientationBuffer.map(function (s) { return s.alpha; });
  const sumB = orientationBuffer.reduce(function (acc, s) { return acc + s.beta; }, 0);
  const sumG = orientationBuffer.reduce(function (acc, s) { return acc + s.gamma; }, 0);
  return {
    alpha: circularMean(alphas),
    beta: sumB / n,
    gamma: sumG / n
  };
}

function isRemoteFresh(tab) {
  const ts = remoteOrientationTs[tab];
  return ts && (Date.now() - ts) < REMOTE_FRESH_MS;
}

function updateLocation(loc) {
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return;
  const tab = (typeof loc.tabId === 'string' && loc.tabId) ? loc.tabId : DEFAULT_TAB;
  const prev = locationsByTab[tab] || DEFAULT_LOCATION;
  locationsByTab[tab] = {
    lat: loc.lat,
    lon: loc.lon,
    heading: typeof loc.heading === 'number' ? loc.heading : prev.heading,
    speedMps: typeof loc.speedMps === 'number' ? loc.speedMps : 0,
    accuracy: typeof loc.accuracy === 'number' ? loc.accuracy : 8,
    ts: Date.now()
  };
  // Orientation local SO sobrescreve se o celular remoto NAO esta ativo
  if (loc.orientation && typeof loc.orientation === 'object' && !isRemoteFresh(tab)) {
    const o = loc.orientation;
    const prevOri = orientationsByTab[tab] || DEFAULT_ORIENTATION;
    orientationsByTab[tab] = {
      alpha: typeof o.alpha === 'number' ? o.alpha : prevOri.alpha,
      beta:  typeof o.beta  === 'number' ? o.beta  : prevOri.beta,
      gamma: typeof o.gamma === 'number' ? o.gamma : prevOri.gamma,
      ts: Date.now()
    };
  }
  lastUpdatedTab = tab;
  if (tab !== DEFAULT_TAB) {
    locationsByTab[DEFAULT_TAB] = locationsByTab[tab];
    orientationsByTab[DEFAULT_TAB] = orientationsByTab[tab];
  }
}

function getLocationForTab(tabId) {
  if (tabId && locationsByTab[tabId]) {
    return Object.assign({}, locationsByTab[tabId], {
      orientation: orientationsByTab[tabId] || DEFAULT_ORIENTATION
    });
  }
  // Fallback: aba desconhecida retorna a default (ultima atualizada)
  return Object.assign({}, locationsByTab[DEFAULT_TAB] || DEFAULT_LOCATION, {
    orientation: orientationsByTab[DEFAULT_TAB] || DEFAULT_ORIENTATION
  });
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let total = 0;
    req.on('data', function (chunk) {
      total += chunk.length;
      if (total > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  // Private Network Access (PNA): Chromium bloqueia requests de https:// pra localhost
  // sem este header desde ~v117. Setar sempre, inclusive em preflight OPTIONS.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url && req.url.indexOf('/location') === 0) {
    // Suporta /location e /location?tab=X (alpha4 multi-abas)
    const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const params = {};
    q.split('&').forEach(function (pair) {
      if (!pair) return;
      const [k, v] = pair.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getLocationForTab(params.tab)));
    return;
  }
  // v0.1.14: lista de abas pra extension popular o dropdown.
  // Enriquecido com remoteActive por aba (celular remoto enviando < 2s)
  if (req.method === 'GET' && req.url === '/tabs') {
    const now = Date.now();
    const enriched = currentTabsList.map(function (t) {
      const ts = remoteOrientationTs[t.id];
      return Object.assign({}, t, {
        remoteActive: !!(ts && (now - ts) < REMOTE_FRESH_MS),
        remoteLastSeenMs: ts ? (now - ts) : null
      });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tabs: enriched }));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'fake-gps-pc', version: '0.1.14' }));
    return;
  }
  // v0.1.13+: POST /orientation - celular remoto manda os dados do sensor real.
  // v0.1.14 fase 2: sensor e GLOBAL (uma unica conexao atende todas as abas).
  // Suavizacao: media movel das ultimas N amostras pra reduzir tremor da bussola.
  if (req.method === 'POST' && req.url === '/orientation') {
    readJsonBody(req).then(function (data) {
      if (data && typeof data.alpha === 'number'
          && typeof data.beta === 'number' && typeof data.gamma === 'number') {
        const now = Date.now();
        const smoothed = pushOrientationSample(data);
        const ori = {
          alpha: smoothed.alpha,
          beta: smoothed.beta,
          gamma: smoothed.gamma,
          ts: now
        };
        currentTabsList.forEach(function (t) {
          if (t && t.id) {
            orientationsByTab[t.id] = ori;
            remoteOrientationTs[t.id] = now;
          }
        });
        orientationsByTab[DEFAULT_TAB] = ori;
        remoteOrientationTs[DEFAULT_TAB] = now;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }).catch(function (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }
  // GET /sensor - pagina HTML servida pro celular do user
  if (req.method === 'GET' && req.url && req.url.indexOf('/sensor') === 0) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SENSOR_HTML);
    return;
  }
  if (req.method === 'POST' && req.url === '/crates') {
    readJsonBody(req).then(function (data) {
      if (data && Array.isArray(data.crates) && onCratesCallback) {
        onCratesCallback({
          crates: data.crates,
          lures: Array.isArray(data.lures) ? data.lures : [],
          ts: data.ts || Date.now()
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: data && data.crates ? data.crates.length : 0 }));
    }).catch(function (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // v0.1.14: Extension (content.js) posta o Bearer token do gocollect capturado
  // automaticamente no gocollect.fun. Zero auth (localhost only).
  if (req.method === 'POST' && req.url === '/gocollect-token') {
    readJsonBody(req).then(function (data) {
      if (data && typeof data.token === 'string' && data.token.length > 10) {
        if (onGocollectTokenCallback) onGocollectTokenCallback(data.token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'token ausente ou inválido' }));
      }
    }).catch(function (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  res.writeHead(404); res.end('not found');
}

function startHttpsServer() {
  // Cert self-signed valido por 1 ano, gerado em runtime (nao salva em disco)
  const attrs = [{ name: 'commonName', value: 'fakegps-pc.local' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          // IPs locais serao aceitos via self-signed de qualquer forma
          { type: 7, ip: '0.0.0.0' }
        ]
      }
    ]
  });
  return new Promise(function (resolve, reject) {
    const server = https.createServer({ cert: pems.cert, key: pems.private }, handler);
    server.once('error', function (err) {
      if (err.code === 'EADDRINUSE') {
        console.warn('[Fake GPS Server] porta HTTPS ' + HTTPS_PORT + ' ocupada, HTTPS desligado');
        resolve({ port: null, server: null });
      } else { reject(err); }
    });
    server.listen(HTTPS_PORT, '0.0.0.0', function () {
      resolve({ port: HTTPS_PORT, server: server });
    });
  });
}

function start(ports) {
  const list = ports || DEFAULT_PORTS;
  return new Promise(function (resolve, reject) {
    tryPort(0);
    function tryPort(i) {
      if (i >= list.length) {
        return reject(new Error('No available port in ' + list.join(',')));
      }
      const port = list[i];
      const server = http.createServer(handler);
      server.once('error', function (err) {
        if (err.code === 'EADDRINUSE') { tryPort(i + 1); }
        else { reject(err); }
      });
      server.listen(port, '0.0.0.0', function () {
        const ips = getLocalIps();
        console.log('[Fake GPS Server] HTTP http://127.0.0.1:' + port + '/location (+ /crates, /sensor)');
        // Inicia HTTPS em paralelo pro sensor remoto
        startHttpsServer().then(function (httpsInfo) {
          if (httpsInfo.port && ips.length > 0) {
            console.log('[Fake GPS Server] HTTPS https://' + ips[0].address + ':' + httpsInfo.port + '/sensor');
          }
          resolve({ port: port, server: server, httpsPort: httpsInfo.port, httpsServer: httpsInfo.server });
        }).catch(function (err) {
          console.warn('[Fake GPS Server] falha ao iniciar HTTPS:', err.message);
          resolve({ port: port, server: server, httpsPort: null });
        });
      });
    }
  });
}

// --- Pagina HTML servida em /sensor pro celular remoto ---
const SENSOR_HTML = `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Fake GPS - Sensor Remoto</title>
  <style>
    :root {
      --bg: #0f1419; --panel: #1a2029; --text: #e8eaed;
      --muted: #9aa0a6; --accent: #1a73e8; --ok: #0f9d58; --err: #e53935;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text); margin: 0; padding: 20px;
      min-height: 100vh; display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center;
    }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .sub { color: var(--muted); font-size: 14px; margin-bottom: 30px; }
    #tab-info {
      background: rgba(26,115,232,0.1); color: var(--accent);
      padding: 6px 12px; border-radius: 20px; font-size: 12px;
      margin-bottom: 20px; display: inline-block;
    }
    button {
      background: var(--accent); color: white; border: none;
      padding: 18px 32px; border-radius: 10px; font-size: 18px;
      font-weight: 600; cursor: pointer; width: 100%; max-width: 320px;
    }
    button:disabled { background: var(--ok); }
    .status {
      margin-top: 24px; font-size: 15px; color: var(--muted);
    }
    .status.on { color: var(--ok); }
    .status.err { color: var(--err); }
    .values {
      font-family: Consolas, monospace; font-size: 14px; color: var(--muted);
      margin-top: 20px; padding: 14px 20px; background: var(--panel);
      border-radius: 8px; min-width: 260px;
    }
    .values .row { display: flex; justify-content: space-between; margin: 4px 0; }
    .values .k { color: var(--muted); }
    .values .v { color: var(--text); font-weight: 600; }
    .counter {
      font-size: 11px; color: var(--muted); margin-top: 10px;
    }
    .hint { color: var(--muted); font-size: 12px; max-width: 320px; margin-top: 24px; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>📱 Sensor Remoto</h1>
  <div class="sub">Fake GPS PC</div>
  <div id="tab-info"></div>
  <button id="btn-start">Autorizar sensor</button>
  <button id="btn-stop" style="display:none; background: var(--err);">⏸ Parar envio</button>
  <div id="status" class="status">Toque no botao pra comecar</div>
  <div class="values">
    <div class="row"><span class="k">Alpha (bussola)</span><span class="v" id="v-a">—</span></div>
    <div class="row"><span class="k">Beta (frente/tras)</span><span class="v" id="v-b">—</span></div>
    <div class="row"><span class="k">Gamma (lateral)</span><span class="v" id="v-g">—</span></div>
  </div>
  <div class="counter" id="counter"></div>
  <div class="hint">Mantenha esta aba aberta. Pode minimizar o navegador - continua enviando enquanto a tela estiver ligada.</div>

  <script>
    // v0.1.14 fase 2: sensor global - afeta todas as abas
    document.getElementById('tab-info').textContent = 'Modo global (todas as abas)';

    const statusEl = document.getElementById('status');
    const counterEl = document.getElementById('counter');
    const vA = document.getElementById('v-a'), vB = document.getElementById('v-b'), vG = document.getElementById('v-g');
    const btn = document.getElementById('btn-start');

    const tabId = '';  // v0.1.14 fase 2: sempre vazio = global
    let lastValues = { alpha: 0, beta: 70, gamma: 0 };
    let sending = false;
    let sentCount = 0, errCount = 0;

    const btnStop = document.getElementById('btn-stop');
    let eventCount = 0;
    let eventChecker = null;
    let orientationListener = null;

    btnStop.addEventListener('click', () => {
      sending = false;
      if (orientationListener) {
        window.removeEventListener('deviceorientation', orientationListener);
        orientationListener = null;
      }
      btn.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Autorizar sensor';
      btnStop.style.display = 'none';
      statusEl.textContent = 'Envio pausado. Toque pra retomar.';
      statusEl.className = 'status';
      vA.textContent = '—'; vB.textContent = '—'; vG.textContent = '—';
      if (eventChecker) { clearTimeout(eventChecker); eventChecker = null; }
    });

    btn.addEventListener('click', async () => {
      try {
        if (typeof DeviceOrientationEvent === 'undefined') {
          statusEl.innerHTML = 'Browser nao suporta DeviceOrientationEvent.<br>Tente Chrome ou Safari atualizado.';
          statusEl.className = 'status err';
          return;
        }

        // iOS Safari 13+ e Chrome Android recente tem requestPermission.
        // Chamamos se existir, mas NAO abortamos se retornar denied -
        // em alguns Androids retorna denied mas o listener ainda funciona.
        let permState = 'granted';
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          try {
            permState = await DeviceOrientationEvent.requestPermission();
          } catch (e) {
            permState = 'error';
          }
          if (permState === 'denied') {
            statusEl.innerHTML = '⚠️ Permissao negada antes.<br>'
              + 'Chrome Android: toque no cadeado 🔒 da URL → "Permissoes" → libere sensores.<br>'
              + 'Depois recarregue esta pagina e tente de novo.';
            statusEl.className = 'status err';
            return;
          }
        }

        orientationListener = (e) => {
          eventCount++;
          if (e.alpha === null && e.beta === null && e.gamma === null) {
            vA.textContent = 'null';
            vB.textContent = 'null';
            vG.textContent = 'null';
            return;
          }
          lastValues.alpha = e.alpha || 0;
          lastValues.beta = e.beta || 0;
          lastValues.gamma = e.gamma || 0;
          vA.textContent = lastValues.alpha.toFixed(0) + '°';
          vB.textContent = lastValues.beta.toFixed(0) + '°';
          vG.textContent = lastValues.gamma.toFixed(0) + '°';
        };
        window.addEventListener('deviceorientation', orientationListener);

        sending = true;
        btn.style.display = 'none';
        btnStop.style.display = '';
        statusEl.textContent = 'Enviando pro PC...';
        statusEl.className = 'status on';
        sendLoop();

        // Depois de 2s, se nenhum evento disparou, mostra aviso HTTPS
        eventChecker = setTimeout(() => {
          if (eventCount === 0) {
            statusEl.innerHTML = '⚠️ Evento n&atilde;o disparou (0 em 2s).<br>'
              + 'Causa prov&aacute;vel: sensor exige <b>HTTPS</b> (iOS Safari 13+ e Chrome Android novo).<br>'
              + 'Pedir ao desenvolvedor pra ativar HTTPS no servidor.';
            statusEl.className = 'status err';
          } else if (vA.textContent === 'null') {
            statusEl.innerHTML = '⚠️ Evento disparou (' + eventCount + 'x) mas valores s&atilde;o null.<br>'
              + 'Dispositivo pode n&atilde;o ter sensor giroscopio.';
            statusEl.className = 'status err';
          }
        }, 2000);
      } catch (err) {
        statusEl.textContent = 'Erro: ' + err.message;
        statusEl.className = 'status err';
      }
    });

    async function sendLoop() {
      if (!sending) return;
      try {
        await fetch('/orientation', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ tabId: tabId, ...lastValues })
        });
        sentCount++;
      } catch (e) { errCount++; }
      counterEl.textContent = sentCount + ' enviados · ' + errCount + ' erros';
      setTimeout(sendLoop, 50);  // 20Hz
    }
  </script>
</body>
</html>`;

module.exports = {
  start: start,
  updateLocation: updateLocation,
  setOnCrates: setOnCrates,
  setOnGocollectToken: setOnGocollectToken,
  getLocalIps: getLocalIps,
  updateTabsList: updateTabsList
};
