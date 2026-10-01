// Presets de velocidade editaveis. Default: Walk, Run, Carro.
// Persiste em localStorage. Usuario pode add/remove/renomear/alterar velocidade.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'fake-gps-pc:speed-presets';

  // kind: 'walk' | 'run' | 'car' | 'custom'
  //   walk/run → config via modal de Humanidade (pausas pedestre)
  //   car      → config via modal de Comportamento de Carro (aceleracao, curvas)
  //   custom   → sem config avancada
  const DEFAULT_PRESETS = [
    { id: 'walk', name: 'Walk',  emoji: '🚶', kmh: 5,  kind: 'walk' },
    { id: 'run',  name: 'Run',   emoji: '🏃', kmh: 12, kind: 'run' },
    { id: 'car',  name: 'Carro', emoji: '🚗', kmh: 50, kind: 'car' }
  ];

  function sanitizeName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().slice(0, 20);
  }
  function sanitizeEmoji(emoji) {
    if (typeof emoji !== 'string') return '🏷️';
    return emoji.trim().slice(0, 4) || '🏷️';
  }
  function sanitizeKmh(kmh) {
    const v = parseFloat(kmh);
    if (!isFinite(v) || v <= 0) return 5;
    return Math.min(200, Math.max(0.5, v));
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PRESETS.slice();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_PRESETS.slice();
      return arr.filter(function (p) {
        return p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.kmh === 'number';
      }).map(function (p) {
        // Preenche kind faltando pra retrocompatibilidade
        if (!p.kind) {
          if (p.id === 'walk') p.kind = 'walk';
          else if (p.id === 'run') p.kind = 'run';
          else if (p.id === 'car') p.kind = 'car';
          else p.kind = 'custom';
        }
        return p;
      });
    } catch (e) {
      return DEFAULT_PRESETS.slice();
    }
  }

  function saveAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function replaceAll(list) {
    if (!Array.isArray(list)) return false;
    const clean = list.map(function (p) {
      const kind = (p.kind === 'walk' || p.kind === 'run' || p.kind === 'car') ? p.kind : 'custom';
      return {
        id: p.id || ('p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
        name: sanitizeName(p.name) || 'Preset',
        emoji: sanitizeEmoji(p.emoji),
        kmh: sanitizeKmh(p.kmh),
        kind: kind
      };
    });
    saveAll(clean);
    return true;
  }

  function reset() {
    saveAll(DEFAULT_PRESETS);
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.Presets = {
    loadAll: loadAll,
    saveAll: saveAll,
    replaceAll: replaceAll,
    reset: reset,
    DEFAULT_PRESETS: DEFAULT_PRESETS,
    sanitizeName: sanitizeName,
    sanitizeEmoji: sanitizeEmoji,
    sanitizeKmh: sanitizeKmh
  };
})(window);
