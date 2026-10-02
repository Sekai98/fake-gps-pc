// Planejador de rota multi-stop. Factory + instance default (compat).

(function (global) {
  'use strict';

  const DEFAULT_STORAGE_KEY = 'fake-gps-pc:route-plan';
  const CHANGE_DEBOUNCE_MS = 400;

  function createRoutePlanner(options) {
    options = options || {};
    const STORAGE_KEY = options.storageKey || DEFAULT_STORAGE_KEY;

    let stops = [];
    const listeners = [];
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
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stops)); } catch (e) {}
    }

    loadFromStorage();

    function emitChange() {
      saveToStorage();
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        const snap = all();
        listeners.forEach(function (cb) {
          try { cb(snap); } catch (e) {}
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

    function destroy() {
      if (debounceTimer) clearTimeout(debounceTimer);
      listeners.length = 0;
    }

    return {
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
      destroy: destroy,
      CHANGE_DEBOUNCE_MS: CHANGE_DEBOUNCE_MS
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.createRoutePlanner = createRoutePlanner;
  global.FakeGPS.RoutePlanner = createRoutePlanner();
})(window);
