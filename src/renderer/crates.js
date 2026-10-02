// Estado dos crates detectados pela extension. Factory + instance default.

(function (global) {
  'use strict';

  function normalize(raw) {
    if (!raw || typeof raw.id !== 'string') return null;
    const lat = typeof raw.lat === 'number' ? raw.lat : null;
    const lon = typeof raw.lng === 'number' ? raw.lng : (typeof raw.lon === 'number' ? raw.lon : null);
    if (lat === null || lon === null) return null;
    return {
      id: raw.id,
      lat: lat,
      lon: lon,
      expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : null,
      openedByMe: !!raw.openedByMe
    };
  }

  // Haversine em metros - pura, fica fora
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function createCrates() {
    const crates = new Map();
    let listeners = [];

    function update(rawList) {
      if (!Array.isArray(rawList)) return;
      crates.clear();
      rawList.forEach(function (r) {
        const n = normalize(r);
        if (n) crates.set(n.id, n);
      });
      emit();
    }

    function all() {
      return Array.from(crates.values());
    }

    function available() {
      const now = Date.now();
      return all().filter(function (c) {
        if (c.openedByMe) return false;
        if (c.expiresAt && c.expiresAt < now) return false;
        return true;
      });
    }

    function byId(id) { return crates.get(id) || null; }

    function nearest(fromLat, fromLon) {
      const avail = available();
      if (avail.length === 0) return null;
      let best = null;
      let bestDist = Infinity;
      for (const c of avail) {
        const d = distanceMeters(fromLat, fromLon, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      return best ? { crate: best, distanceMeters: bestDist } : null;
    }

    function onUpdate(cb) {
      if (typeof cb === 'function') listeners.push(cb);
    }

    function emit() {
      const snapshot = all();
      listeners.forEach(function (cb) {
        try { cb(snapshot); } catch (e) {}
      });
    }

    function count() { return crates.size; }

    function destroy() {
      crates.clear();
      listeners.length = 0;
    }

    return {
      update: update,
      all: all,
      available: available,
      nearest: nearest,
      byId: byId,
      onUpdate: onUpdate,
      count: count,
      destroy: destroy,
      distanceMeters: distanceMeters
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.createCrates = createCrates;
  global.FakeGPS.Crates = createCrates();
})(window);
