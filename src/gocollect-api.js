// Modulo isolado que chama a API privada do gocollect.fun (/v1/crates).
// Roda no main process do Electron (precisa do token Bearer da conta scout).
// Chamada manual sob demanda - sem polling - pra minimizar risco de detecao.

'use strict';

const https = require('https');

const HOST = 'gocollect.fun';
const PATH = '/v1/crates';

// Formato esperado da resposta (resumo):
//   {
//     crates: [{ id, lat, lng, expiresAt, openedByMe, lure?: { id, kind } }, ...],
//     lures:  [{ id, kind, lat, lng, litAt, endsAt, card?: {...} }, ...],
//     pending, commit
//   }

/**
 * Chama POST /v1/crates com o lat/lng e devolve { crates, lures, raw }.
 * @throws em caso de 401/429/etc com { status, body } anexado.
 */
function fetchCrates(token, lat, lng) {
  return new Promise(function (resolve, reject) {
    if (!token || typeof token !== 'string') {
      reject(new Error('Token Bearer ausente'));
      return;
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      reject(new Error('lat/lng invalidos'));
      return;
    }
    const body = JSON.stringify({ lat: lat, lng: lng });
    const req = https.request({
      hostname: HOST,
      port: 443,
      path: PATH,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'authorization': 'Bearer ' + token,
        'origin': 'https://gocollect.fun',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FakeGPS/0.1'
      }
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          const err = new Error('gocollect API HTTP ' + res.statusCode);
          err.status = res.statusCode;
          err.body = bodyStr;
          reject(err);
          return;
        }
        try {
          const parsed = JSON.parse(bodyStr);
          resolve({
            crates: Array.isArray(parsed.crates) ? parsed.crates : [],
            lures: Array.isArray(parsed.lures) ? parsed.lures : [],
            raw: parsed
          });
        } catch (e) {
          reject(new Error('Resposta inválida: ' + e.message));
        }
      });
    });
    req.on('error', function (e) {
      reject(e);
    });
    req.setTimeout(10000, function () {
      req.destroy(new Error('Timeout 10s na chamada /v1/crates'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Haversine em metros.
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * A partir do payload da API, extrai lures com distância do ponto fornecido,
 * ordenados do mais próximo pro mais distante.
 */
function extractNearbyLures(apiResponse, fromLat, fromLng) {
  const lures = (apiResponse && apiResponse.lures) || [];
  return lures
    .map(function (l) {
      return {
        id: l.id,
        kind: l.kind,
        lat: l.lat,
        lng: l.lng,
        litAt: l.litAt,
        endsAt: l.endsAt,
        card: l.card || null,
        host: l.host,
        mine: !!l.mine,
        visitors: l.visitors || 0,
        cardFound: !!l.cardFound,
        foundByMe: !!l.foundByMe,
        distanceMeters: distanceMeters(fromLat, fromLng, l.lat, l.lng)
      };
    })
    .sort(function (a, b) { return a.distanceMeters - b.distanceMeters; });
}

/**
 * Monta grid de pontos cobrindo circulo de raio em km ao redor de (centerLat, centerLng).
 * Step em km (default 3) - cada chamada cobre raio ~2km, step 3km da overlap seguro.
 */
function buildScanGrid(centerLat, centerLng, radiusKm, stepKm) {
  // v0.1.25: step 2.0km (antes 2.5) + margem de borda +2.5km. Garante que:
  //  1. Nenhum ponto interno fica sem cobertura (step 2km + raio chamada ~2km = overlap seguro)
  //  2. Borda do círculo é coberta por pontos "fora" do raio visual (necessário porque
  //     uma chamada em (R, 0) só cobre até distância 2km de si mesma; pontos VIZINHOS
  //     fora do raio é que cobrem a borda interna)
  const step = typeof stepKm === 'number' ? stepKm : 2.0;
  const marginKm = 2.5;  // raio da chamada (~2km) + half-step (overlap seguro)
  const expandedKm = radiusKm + marginKm;
  const latDegPerKm = 1 / 111;
  const lngDegPerKm = 1 / (111 * Math.cos(centerLat * Math.PI / 180));
  const stepLat = step * latDegPerKm;
  const stepLng = step * lngDegPerKm;
  const spanLat = expandedKm * latDegPerKm;
  const spanLng = expandedKm * lngDegPerKm;
  const points = [];
  points.push({ lat: centerLat, lng: centerLng, _d: 0 });
  for (let dLat = -spanLat; dLat <= spanLat + 1e-9; dLat += stepLat) {
    for (let dLng = -spanLng; dLng <= spanLng + 1e-9; dLng += stepLng) {
      if (dLat === 0 && dLng === 0) continue;
      const pt = { lat: centerLat + dLat, lng: centerLng + dLng };
      const dist = distanceMeters(centerLat, centerLng, pt.lat, pt.lng);
      if (dist <= expandedKm * 1000) { pt._d = dist; points.push(pt); }
    }
  }
  // v0.1.22: scan em "espiral" - ordena do centro pra fora
  points.sort(function (a, b) { return a._d - b._d; });
  return points;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/**
 * Varre grid de pontos chamando fetchCrates em cada um, com pacing + dedupe + paralelismo opcional.
 * @param {string} token - Bearer
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm - raio em km (2-100)
 * @param {object} opts - { pacingMs=600, stepKm=3, concurrency=1, onProgress(progress), shouldCancel() }
 * @returns {Promise<{lures: [], scanned: n, total: n, cancelled: bool, errors: n, aborted?: string}>}
 */
async function scanRegion(token, centerLat, centerLng, radiusKm, opts) {
  opts = opts || {};
  const pacingMs = typeof opts.pacingMs === 'number' ? opts.pacingMs : 600;
  const stepKm = typeof opts.stepKm === 'number' ? opts.stepKm : 2.0;
  const concurrency = Math.max(1, Math.min(10, typeof opts.concurrency === 'number' ? opts.concurrency : 1));
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const shouldCancel = typeof opts.shouldCancel === 'function' ? opts.shouldCancel : null;

  const onLuresFound = typeof opts.onLuresFound === 'function' ? opts.onLuresFound : null;
  const onCratesFound = typeof opts.onCratesFound === 'function' ? opts.onCratesFound : null;

  const points = buildScanGrid(centerLat, centerLng, radiusKm, stepKm);
  const total = points.length;
  const luresMap = {};  // dedupe por id
  const cratesMap = {}; // dedupe por id (crates normais e de lure)
  let scanned = 0;
  let errors = 0;
  let cancelled = false;
  let abortedReason = null;
  let nextIdx = 0;

  function reportProgress() {
    if (onProgress) onProgress({
      scanned: scanned, total: total,
      lureCount: Object.keys(luresMap).length,
      crateCount: Object.keys(cratesMap).length,
      aborted: abortedReason
    });
  }

  async function worker() {
    while (true) {
      if (abortedReason || cancelled) break;
      if (shouldCancel && shouldCancel()) { cancelled = true; break; }
      const idx = nextIdx++;
      if (idx >= points.length) break;
      const pt = points[idx];
      try {
        const data = await fetchCrates(token, pt.lat, pt.lng);
        if (data) {
          // Lures (novos)
          const newLures = [];
          if (Array.isArray(data.lures)) {
            data.lures.forEach(function (l) {
              if (!l || typeof l.id === 'undefined') return;
              if (!luresMap[l.id]) {
                const enriched = Object.assign({}, l, {
                  distanceMeters: distanceMeters(centerLat, centerLng, l.lat, l.lng)
                });
                luresMap[l.id] = enriched;
                newLures.push(enriched);
              }
            });
          }
          // Crates (novos)
          const newCrates = [];
          if (Array.isArray(data.crates)) {
            data.crates.forEach(function (c) {
              if (!c || typeof c.id === 'undefined') return;
              if (!cratesMap[c.id]) {
                // Normaliza lng/lon porque o resto do app usa .lon
                const enriched = Object.assign({}, c, {
                  lon: typeof c.lon === 'number' ? c.lon : c.lng
                });
                cratesMap[c.id] = enriched;
                newCrates.push(enriched);
              }
            });
          }
          if (newLures.length && onLuresFound) onLuresFound(newLures);
          if (newCrates.length && onCratesFound) onCratesFound(newCrates);
        }
      } catch (e) {
        errors++;
        if (e.status === 401) {
          abortedReason = 'unauthorized';
          break;
        }
      }
      scanned++;
      reportProgress();
      if (nextIdx < points.length && !abortedReason && !cancelled) {
        await sleep(pacingMs);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return {
    lures: Object.values(luresMap).sort(function (a, b) { return a.distanceMeters - b.distanceMeters; }),
    crates: Object.values(cratesMap),
    scanned: scanned, total: total, cancelled: cancelled, errors: errors, aborted: abortedReason
  };
}

/**
 * v0.1.21: investigação do endpoint /v1/crates/preview?lat=X&lng=Y
 * Esperamos que retorne info sobre o crate mais próximo (card, tier, etc) ANTES de abrir.
 * Chame via IPC pra testar e me manda o payload cru.
 */
function fetchCratePreview(token, lat, lng) {
  return new Promise(function (resolve, reject) {
    if (!token || typeof token !== 'string') { reject(new Error('Token Bearer ausente')); return; }
    if (typeof lat !== 'number' || typeof lng !== 'number') { reject(new Error('lat/lng invalidos')); return; }
    const path = '/v1/crates/preview?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng);
    const req = https.request({
      hostname: HOST,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        'authorization': 'Bearer ' + token,
        'origin': 'https://gocollect.fun',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FakeGPS/0.1'
      }
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed !== null ? parsed : body });
      });
    });
    req.on('error', function (e) { reject(e); });
    req.setTimeout(10000, function () { req.destroy(new Error('Timeout 10s na chamada /v1/crates/preview')); });
    req.end();
  });
}

module.exports = {
  fetchCrates: fetchCrates,
  fetchCratePreview: fetchCratePreview,
  extractNearbyLures: extractNearbyLures,
  distanceMeters: distanceMeters,
  buildScanGrid: buildScanGrid,
  scanRegion: scanRegion
};
