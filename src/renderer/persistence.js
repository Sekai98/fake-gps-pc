(function (global) {
  'use strict';

  const DEFAULT_STORAGE_KEY = 'fake-gps-pc:state';
  const AUTOSAVE_MS = 5000;

  function createPersistence(options) {
    options = options || {};
    const STORAGE_KEY = options.storageKey || DEFAULT_STORAGE_KEY;

    function save(data) {
      try {
        const payload = {
          lat: data.lat,
          lon: data.lon,
          heading: data.heading || 0,
          mode: data.mode || 'walk',
          maxSpeedKmh: data.maxSpeedKmh || 5,
          paused: !!data.paused,
          humanityEnabled: !!data.humanityEnabled,
          activePresetId: data.activePresetId,
          savedAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return true;
      } catch (e) {
        return false;
      }
    }

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (typeof d.lat !== 'number' || typeof d.lon !== 'number') return null;
        if (!isFinite(d.lat) || !isFinite(d.lon)) return null;
        if (Math.abs(d.lat) > 90 || Math.abs(d.lon) > 180) return null;
        return d;
      } catch (e) {
        return null;
      }
    }

    function clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    return {
      save: save,
      load: load,
      clear: clear,
      AUTOSAVE_MS: AUTOSAVE_MS,
      STORAGE_KEY: STORAGE_KEY
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.createPersistence = createPersistence;
  global.FakeGPS.Persistence = createPersistence();
})(window);
