// Modulo que simula pausas naturais pra parecer caminhada humana real.
// Dois tipos de pausa:
//   - Micropausa (1-3s): "olhou o celular", "amarrou o tenis"
//   - Pausa longa  (15-45s): "esperando sinal / cruzamento"
// Só dispara enquanto o personagem esta se movendo (speedMps > 0).

(function (global) {
  'use strict';

  const CONFIG_STORAGE_KEY = 'fake-gps-pc:humanity-config';

  const DEFAULT_CONFIG = {
    // Intervalo entre rolls de probabilidade
    checkIntervalMinMs: 15000,
    checkIntervalMaxMs: 60000,

    // Probabilidades (soma pode ser < 1, resto = "continua andando")
    microPauseChance: 0.18,
    trafficStopChance: 0.32,

    // Duracoes
    microPauseMinMs: 1000,
    microPauseMaxMs: 3000,
    trafficStopMinMs: 15000,
    trafficStopMaxMs: 45000
  };

  const config = Object.assign({}, DEFAULT_CONFIG);

  function loadConfigFromStorage() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      // Aceita so chaves conhecidas e valida numeros
      Object.keys(DEFAULT_CONFIG).forEach(function (k) {
        if (typeof saved[k] === 'number' && isFinite(saved[k]) && saved[k] >= 0) {
          config[k] = saved[k];
        }
      });
    } catch (e) { /* silencio */ }
  }

  function saveConfigToStorage() {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (e) { /* silencio */ }
  }

  loadConfigFromStorage();

  const state = {
    enabled: false,
    pausedUntil: 0,     // timestamp em ms (0 = nao pausado por humanity)
    pauseType: null,    // 'micro' | 'traffic' | null
    pendingTimer: null
  };

  // Callback externo que avisa quando o personagem esta parado (speed 0).
  // Chamado pelo app.js. Retorna true se devemos pular o roll (parado = sem contexto pra pausar).
  let isActuallyMovingFn = function () { return true; };

  function setIsMovingProvider(fn) {
    if (typeof fn === 'function') isActuallyMovingFn = fn;
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function scheduleNext() {
    if (!state.enabled) return;
    const nextIn = randRange(config.checkIntervalMinMs, config.checkIntervalMaxMs);
    if (state.pendingTimer) clearTimeout(state.pendingTimer);
    state.pendingTimer = setTimeout(roll, nextIn);
  }

  function roll() {
    if (!state.enabled) return;

    // Nao pausar se o personagem estiver parado - nao faz sentido simular sinal se nao esta andando
    if (!isActuallyMovingFn()) {
      scheduleNext();
      return;
    }

    const r = Math.random();
    if (r < config.microPauseChance) {
      const dur = randRange(config.microPauseMinMs, config.microPauseMaxMs);
      state.pausedUntil = Date.now() + dur;
      state.pauseType = 'micro';
    } else if (r < config.microPauseChance + config.trafficStopChance) {
      const dur = randRange(config.trafficStopMinMs, config.trafficStopMaxMs);
      state.pausedUntil = Date.now() + dur;
      state.pauseType = 'traffic';
    }
    // else: nao pausa, segue andando

    scheduleNext();
  }

  function enable() {
    if (state.enabled) return;
    state.enabled = true;
    state.pausedUntil = 0;
    state.pauseType = null;
    scheduleNext();
  }

  function disable() {
    state.enabled = false;
    state.pausedUntil = 0;
    state.pauseType = null;
    if (state.pendingTimer) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function isEnabled() { return state.enabled; }

  function isSimulatedPaused() {
    if (!state.enabled) return false;
    return Date.now() < state.pausedUntil;
  }

  function currentPauseType() {
    return isSimulatedPaused() ? state.pauseType : null;
  }

  function remainingMs() {
    if (!isSimulatedPaused()) return 0;
    return Math.max(0, state.pausedUntil - Date.now());
  }

  function getConfig() {
    return Object.assign({}, config); // copia defensiva
  }

  function setConfig(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const next = {};
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      const v = patch[k];
      if (typeof v === 'number' && isFinite(v) && v >= 0) {
        next[k] = v;
      }
    });
    // Valida min <= max nos pares
    if (next.checkIntervalMinMs !== undefined && next.checkIntervalMaxMs !== undefined &&
        next.checkIntervalMinMs > next.checkIntervalMaxMs) return false;
    if (next.microPauseMinMs !== undefined && next.microPauseMaxMs !== undefined &&
        next.microPauseMinMs > next.microPauseMaxMs) return false;
    if (next.trafficStopMinMs !== undefined && next.trafficStopMaxMs !== undefined &&
        next.trafficStopMinMs > next.trafficStopMaxMs) return false;
    // Chances devem ficar em [0, 1]
    if (next.microPauseChance !== undefined && (next.microPauseChance < 0 || next.microPauseChance > 1)) return false;
    if (next.trafficStopChance !== undefined && (next.trafficStopChance < 0 || next.trafficStopChance > 1)) return false;

    Object.assign(config, next);
    saveConfigToStorage();
    return true;
  }

  function resetConfig() {
    Object.assign(config, DEFAULT_CONFIG);
    saveConfigToStorage();
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.Humanity = {
    enable: enable,
    disable: disable,
    isEnabled: isEnabled,
    isSimulatedPaused: isSimulatedPaused,
    currentPauseType: currentPauseType,
    remainingMs: remainingMs,
    setIsMovingProvider: setIsMovingProvider,
    getConfig: getConfig,
    setConfig: setConfig,
    resetConfig: resetConfig,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    config: config
  };
})(window);
