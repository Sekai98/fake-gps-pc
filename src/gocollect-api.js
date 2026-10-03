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

module.exports = {
  fetchCrates: fetchCrates,
  extractNearbyLures: extractNearbyLures,
  distanceMeters: distanceMeters
};
