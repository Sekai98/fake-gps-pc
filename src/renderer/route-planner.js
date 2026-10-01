// Planejador de rota multi-stop (crates do gocollect.fun).
// Mantem lista ordenada de { id, lat, lon, label }, dispara listeners em qualquer mudanca.
// Persiste no localStorage pra sobreviver a reload.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'fake-gps-pc:route-plan';
  const CHANGE_DEBOUNCE_MS = 400;

  let stops = [];           // array ordenado de { id, lat, lon, label }
  const listeners = [];     // chamados em cada change
  let debounceTimer = null;

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      stops = arr.filter(function (s) {
        return s && typeof s.id === 'string'
          && typeof s.lat === 'number' && typeof s.lon === 'number';
      });
    } catch (e) { /* silencio */ }
  }

  function saveToStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stops)); } catch (e) { /* silencio */ }
  }

  loadFromStorage();

  function emitChange() {
    saveToStorage();
    // Debounce: evita disparo multiplo quando o usuario esta reorganizando rapido
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      const snap = all();
      listeners.forEach(function (cb) {
        try { cb(snap); } catch (e) { /* silencio */ }
      });
    }, CHANGE_DEBOUNCE_MS);
  }

  function onChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function all() { return stops.slice(); }
  function count() { return stops.length; }
  function has(id) { return stops.some(function (s) { return s.id === id; }); }
  function indexOf(id) {
    for (let i = 0; i < stops.length; i++) if (stops[i].id === id) return i;
    return -1;
  }

  function add(stop) {
    if (!stop || typeof stop.id !== 'string') return false;
    if (has(stop.id)) return false;
    if (typeof stop.lat !== 'number' || typeof stop.lon !== 'number') return false;
    stops.push({
      id: stop.id,
      lat: stop.lat,
      lon: stop.lon,
      label: stop.label || stop.id
    });
    emitChange();
    return true;
  }

  function remove(id) {
    const idx = indexOf(id);
    if (idx < 0) return false;
    stops.splice(idx, 1);
    emitChange();
    return true;
  }

  function move(id, direction) {
    // direction: -1 (sobe) ou +1 (desce)
    const idx = indexOf(id);
    if (idx < 0) return false;
    const target = idx + direction;
    if (target < 0 || target >= stops.length) return false;
    const [s] = stops.splice(idx, 1);
    stops.splice(target, 0, s);
    emitChange();
    return true;
  }

  function clear() {
    if (stops.length === 0) return;
    stops = [];
    emitChange();
  }

  function toggle(stop) {
    if (has(stop.id)) {
      remove(stop.id);
      return 'removed';
    } else {
      add(stop);
      return 'added';
    }
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.RoutePlanner = {
    all: all,
    count: count,
    has: has,
    indexOf: indexOf,
    add: add,
    remove: remove,
    move: move,
    clear: clear,
    toggle: toggle,
    onChange: onChange,
    CHANGE_DEBOUNCE_MS: CHANGE_DEBOUNCE_MS
  };
})(window);
