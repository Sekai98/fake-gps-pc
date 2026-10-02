// Servidor HTTP local do Electron.
// Endpoints:
//   GET  /location  - posicao atual do joystick (lida pela extension)
//   POST /crates    - lista de crates detectada pela extension (encaminhada ao renderer)
//   GET  /health    - heartbeat pra extension descobrir a porta
// Zero deps (modulo http nativo). Fallback de porta se 3477 estiver ocupada.

const http = require('http');

const DEFAULT_PORTS = [3477, 3478, 3479, 3480];
const MAX_BODY_SIZE = 512 * 1024; // 512 KB (gocollect manda ~1-5 KB por batch)

let currentLocation = {
  lat: -23.561684,
  lon: -46.655981,
  heading: 0,
  speedMps: 0,
  accuracy: 8,
  ts: Date.now()
};

// Orientacao do celular virtual (DeviceOrientationEvent).
// Default: celular semi-vertical na mao (beta ~70°)
let currentOrientation = { alpha: 0, beta: 70, gamma: 0, ts: Date.now() };

// Callback registrado pelo main.js. Dispara quando chega POST /crates.
let onCratesCallback = null;
function setOnCrates(fn) { onCratesCallback = (typeof fn === 'function') ? fn : null; }

function updateLocation(loc) {
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return;
  currentLocation = {
    lat: loc.lat,
    lon: loc.lon,
    heading: typeof loc.heading === 'number' ? loc.heading : currentLocation.heading,
    speedMps: typeof loc.speedMps === 'number' ? loc.speedMps : 0,
    accuracy: typeof loc.accuracy === 'number' ? loc.accuracy : 8,
    ts: Date.now()
  };
  // Orientacao vem junto no mesmo payload (opcional)
  if (loc.orientation && typeof loc.orientation === 'object') {
    const o = loc.orientation;
    currentOrientation = {
      alpha: typeof o.alpha === 'number' ? o.alpha : currentOrientation.alpha,
      beta:  typeof o.beta  === 'number' ? o.beta  : currentOrientation.beta,
      gamma: typeof o.gamma === 'number' ? o.gamma : currentOrientation.gamma,
      ts: Date.now()
    };
  }
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

  if (req.method === 'GET' && req.url === '/location') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.assign({}, currentLocation, { orientation: currentOrientation })));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'fake-gps-pc', version: '0.1.12' }));
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

  res.writeHead(404); res.end('not found');
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
      server.listen(port, '127.0.0.1', function () {
        console.log('[Fake GPS Server] http://127.0.0.1:' + port + '/location (+ /crates)');
        resolve({ port: port, server: server });
      });
    }
  });
}

module.exports = {
  start: start,
  updateLocation: updateLocation,
  setOnCrates: setOnCrates
};
