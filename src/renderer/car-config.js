// Config do preset de carro (comportamento de direcao).
// Persiste em localStorage. Consultado por movement.js e autopilot.js
// quando o preset ativo tem kind === 'car'.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'fake-gps-pc:car-config';

  const DEFAULT_CONFIG = {
    accelSeconds: 3.6,          // tempo pra ir de 0 ate maxSpeed (0->50 realista)
    curveSlowdownMin: 0.35,     // em curva fechada (>=90deg), reduz pra 35% da max
    approachMeters: 15,         // comeca a frear 15m antes do destino final
    trafficStopChance: 0.25,    // 25% dos "cruzamentos" ha semaforo que para
    trafficStopMinMs: 3000,     // sinal vermelho min
    trafficStopMaxMs: 8000      // sinal vermelho max
  };

  const config = Object.assign({}, DEFAULT_CONFIG);

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      Object.keys(DEFAULT_CONFIG).forEach(function (k) {
        if (typeof saved[k] === 'number' && isFinite(saved[k]) && saved[k] >= 0) {
          config[k] = saved[k];
        }
      });
    } catch (e) { /* silencio */ }
  }

  function saveToStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch (e) { /* silencio */ }
  }

  loadFromStorage();

  function getConfig() {
    return Object.assign({}, config);
  }

  function setConfig(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const next = {};
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      const v = patch[k];
      if (typeof v === 'number' && isFinite(v) && v >= 0) next[k] = v;
    });
    // Valida ranges
    if (next.curveSlowdownMin !== undefined && (next.curveSlowdownMin < 0.05 || next.curveSlowdownMin > 1)) return false;
    if (next.trafficStopChance !== undefined && (next.trafficStopChance < 0 || next.trafficStopChance > 1)) return false;
    if (next.trafficStopMinMs !== undefined && next.trafficStopMaxMs !== undefined && next.trafficStopMinMs > next.trafficStopMaxMs) return false;
    if (next.accelSeconds !== undefined && (next.accelSeconds < 0.1 || next.accelSeconds > 30)) return false;
    if (next.approachMeters !== undefined && (next.approachMeters < 0 || next.approachMeters > 100)) return false;

    Object.assign(config, next);
    saveToStorage();
    return true;
  }

  function resetConfig() {
    Object.assign(config, DEFAULT_CONFIG);
    saveToStorage();
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.CarConfig = {
    getConfig: getConfig,
    setConfig: setConfig,
    resetConfig: resetConfig,
    DEFAULT_CONFIG: DEFAULT_CONFIG
  };
})(window);
