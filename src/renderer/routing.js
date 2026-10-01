// Modulo de routing via OSRM publico.
// Usa routing.openstreetmap.de/routed-foot que mantem o perfil "foot" real,
// diferente do router.project-osrm.org que atualmente so expoe o perfil car.
// Pedestre: ignora sentidos de via, usa calcadas, trilhas, vias pedestres (highway=footway, path, pedestrian).
// Rate limit informal, uso casual OK.

(function (global) {
  'use strict';

  // Endpoint com perfil foot real. O "driving" no path eh o nome do metodo OSRM
  // (nao o perfil); o perfil eh definido pelo subdominio routed-foot.
  const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

  // Calcula distancia em metros entre dois pontos (Haversine).
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Interpola pontos em linha reta de A -> B a cada ~5m pra parecer caminhada natural.
  // Retorna array de waypoints (sem incluir A, inclui B).
  function interpolateStraight(fromLat, fromLon, toLat, toLon, stepMeters) {
    const step = stepMeters || 5;
    const d = haversine(fromLat, fromLon, toLat, toLon);
    if (d < 1) return [{ lat: toLat, lon: toLon }];
    const steps = Math.max(1, Math.ceil(d / step));
    const out = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      out.push({
        lat: fromLat + (toLat - fromLat) * t,
        lon: fromLon + (toLon - fromLon) * t
      });
    }
    return out;
  }

  // Busca rota a pe de A -> B.
  // Retorna { waypoints: [{lat, lon}, ...], distanceMeters, durationSeconds }
  // Lanca erro se nao conseguir.
  //
  // Comportamento: se o OSRM fizer snap do inicio/fim pra rua mais proxima
  // (quando o usuario clica dentro de uma residencia ou area sem via),
  // adicionamos aproximacao em linha reta no comeco e no final pra o personagem
  // efetivamente chegar no ponto clicado.
  async function fetchFootRoute(fromLat, fromLon, toLat, toLon) {
    // Formato OSRM: lon,lat (NAO lat,lon)
    const url = OSRM_BASE
      + '/' + fromLon + ',' + fromLat
      + ';' + toLon + ',' + toLat
      + '?overview=full&geometries=geojson&steps=false';

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) throw new Error('OSRM HTTP ' + resp.status);

    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      throw new Error(data.message || 'rota nao encontrada');
    }
    const route = data.routes[0];
    const coords = route.geometry && route.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error('rota com dados invalidos');
    }
    // OSRM retorna [lon, lat] - convertemos pra {lat, lon}
    let waypoints = coords.map(function (c) {
      return { lat: c[1], lon: c[0] };
    });

    // Augment inicio: se o primeiro waypoint OSRM esta longe do ponto real de origem,
    // adiciona passos em linha reta pra chegar ate la antes de comecar a rota.
    const first = waypoints[0];
    const prefixDist = haversine(fromLat, fromLon, first.lat, first.lon);
    if (prefixDist > 2) {
      const prefix = interpolateStraight(fromLat, fromLon, first.lat, first.lon);
      // Nao duplicamos o first (interpolateStraight termina exatamente nele)
      waypoints = prefix.slice(0, -1).concat(waypoints);
    }

    // Augment fim: se o ultimo waypoint OSRM esta longe do destino clicado,
    // adiciona passos em linha reta pra chegar no ponto exato.
    const last = waypoints[waypoints.length - 1];
    const suffixDist = haversine(last.lat, last.lon, toLat, toLon);
    if (suffixDist > 2) {
      const suffix = interpolateStraight(last.lat, last.lon, toLat, toLon);
      waypoints = waypoints.concat(suffix);
    }

    return {
      waypoints: waypoints,
      distanceMeters: (route.distance || 0) + prefixDist + suffixDist,
      durationSeconds: route.duration || 0
    };
  }

  // Rota multi-stop (N pontos em sequencia).
  // Entrada: points = [{lat, lon}, {lat, lon}, ...] com pelo menos 2 elementos.
  // Faz UMA request OSRM com todos os pontos. Resposta tem a rota completa percorrendo todos em ordem.
  async function fetchMultiFootRoute(points) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('precisa de pelo menos 2 pontos');
    }
    // Formato OSRM: lon,lat;lon,lat;lon,lat
    const path = points.map(function (p) {
      return p.lon + ',' + p.lat;
    }).join(';');
    const url = OSRM_BASE + '/' + path + '?overview=full&geometries=geojson&steps=false';

    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error('OSRM HTTP ' + resp.status);
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      throw new Error(data.message || 'rota multi-stop nao encontrada');
    }
    const route = data.routes[0];
    const coords = route.geometry && route.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new Error('rota com dados invalidos');
    }
    let waypoints = coords.map(function (c) { return { lat: c[1], lon: c[0] }; });

    // Augment: igual ao single-point, mas so no final (destino final).
    // No comeco, o usuario precisa estar na origem; no fim, chegar no ultimo stop exato.
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const firstWp = waypoints[0];
    const lastWp = waypoints[waypoints.length - 1];

    const prefixDist = haversine(firstPoint.lat, firstPoint.lon, firstWp.lat, firstWp.lon);
    if (prefixDist > 2) {
      const prefix = interpolateStraight(firstPoint.lat, firstPoint.lon, firstWp.lat, firstWp.lon);
      waypoints = prefix.slice(0, -1).concat(waypoints);
    }
    const suffixDist = haversine(lastWp.lat, lastWp.lon, lastPoint.lat, lastPoint.lon);
    if (suffixDist > 2) {
      const suffix = interpolateStraight(lastWp.lat, lastWp.lon, lastPoint.lat, lastPoint.lon);
      waypoints = waypoints.concat(suffix);
    }

    return {
      waypoints: waypoints,
      distanceMeters: (route.distance || 0) + prefixDist + suffixDist,
      durationSeconds: route.duration || 0,
      legs: route.legs || []
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.Routing = {
    fetchFootRoute: fetchFootRoute,
    fetchMultiFootRoute: fetchMultiFootRoute,
    haversine: haversine
  };
})(window);
