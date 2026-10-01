(function (global) {
  'use strict';

  // Velocidades realistas:
  //   walking medio adulto: 5 km/h = 1.39 m/s
  //   running leve: 12 km/h = 3.33 m/s
  const MODES = {
    walk: { maxSpeedKmh: 5 },
    run:  { maxSpeedKmh: 12 }
  };

  const config = {
    mode: 'walk',
    maxSpeedKmh: 5,
    variationKmh: 1.0,    // amplitude da oscilacao natural (+-X km/h)
    variationIntervalMs: 1000, // trocar alvo a cada N ms
    variationLerpRate: 2.0     // km/h por segundo pra atingir o novo alvo
  };

  // Provider do kind do preset ativo (walk/run/car/custom) + config do carro.
  // Preenchido pelo app.js. Sem provider, assume kind='walk' e formula padrao.
  let activeKindProvider = function () { return 'walk'; };
  function setActiveKindProvider(fn) { if (typeof fn === 'function') activeKindProvider = fn; }

  function getCarConfig() {
    return (global.FakeGPS && global.FakeGPS.CarConfig) ? global.FakeGPS.CarConfig.getConfig() : null;
  }

  // accelTime dinamico:
  //   kind='car' → usa config.accelSeconds da CarConfig
  //   kind='walk'|'run'|'custom' → formula 0.3 + kmh/15
  function computeAccelTime() {
    const kind = activeKindProvider();
    if (kind === 'car') {
      const cc = getCarConfig();
      if (cc && typeof cc.accelSeconds === 'number' && cc.accelSeconds > 0) {
        return cc.accelSeconds;
      }
    }
    return 0.3 + config.maxSpeedKmh / 15;
  }

  const state = {
    lat: 0,
    lon: 0,
    speedMps: 0,
    heading: 0,
    variationTargetKmh: 0,  // alvo atual da variacao (-X a +X)
    variationKmh: 0         // valor interpolado atual
  };

  // Timer que randomiza o alvo da variacao a cada ~1s
  // (jitter de ±150ms pra nao ficar cadenciado perfeito)
  function rollVariation() {
    state.variationTargetKmh = (Math.random() - 0.5) * 2 * config.variationKmh;
    const nextIn = config.variationIntervalMs + (Math.random() - 0.5) * 300;
    setTimeout(rollVariation, nextIn);
  }
  rollVariation();

  function kmhToMps(k) { return k / 3.6; }
  function mpsToKmh(m) { return m * 3.6; }

  function init(lat, lon) {
    state.lat = lat;
    state.lon = lon;
    state.speedMps = 0;
    state.heading = 0;
  }

  // Teletransporta instantaneamente pro ponto. Nao preserva velocidade.
  function teleport(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (!isFinite(lat) || !isFinite(lon)) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    state.lat = lat;
    state.lon = lon;
    state.speedMps = 0;
  }

  function setMode(mode) {
    if (!MODES[mode]) return;
    config.mode = mode;
    config.maxSpeedKmh = MODES[mode].maxSpeedKmh;
  }

  function setMaxSpeedKmh(kmh) {
    config.maxSpeedKmh = Math.max(0.5, Math.min(200, kmh));
  }

  // dt em segundos | input: { x, y, magnitude, heading }
  function update(dt, input) {
    // Interpola variacao em direcao ao alvo atual (suave, nao salta)
    const varDiff = state.variationTargetKmh - state.variationKmh;
    const varStep = Math.sign(varDiff) * Math.min(Math.abs(varDiff), config.variationLerpRate * dt);
    state.variationKmh += varStep;

    // Velocidade efetiva com variacao (nunca negativa, min 0.3 km/h se o motor estiver "andando")
    const effectiveMaxKmh = Math.max(0.3, config.maxSpeedKmh + state.variationKmh);
    const targetMps = kmhToMps(effectiveMaxKmh) * (input.magnitude || 0);

    // Rampa de aceleracao/desaceleracao suave (tempo depende da velocidade maxima)
    const accel = kmhToMps(config.maxSpeedKmh) / computeAccelTime(); // m/s^2
    const diff = targetMps - state.speedMps;
    const change = Math.sign(diff) * Math.min(Math.abs(diff), accel * dt);
    state.speedMps += change;
    if (state.speedMps < 0.001) state.speedMps = 0;

    // Atualiza heading so se input tiver magnitude relevante
    if (input.magnitude > 0.05) {
      state.heading = input.heading;
    }

    if (state.speedMps > 0) {
      const dist = state.speedMps * dt; // metros
      const headingRad = state.heading * Math.PI / 180;

      // Componentes norte (lat) e leste (lon)
      const dNorth = dist * Math.cos(headingRad);
      const dEast  = dist * Math.sin(headingRad);

      // Conversao metros -> graus
      const latRad = state.lat * Math.PI / 180;
      state.lat += dNorth / 111320;
      state.lon += dEast  / (111320 * Math.cos(latRad));
    }
  }

  // Posicao exata (sem jitter) pra desenhar no mapa suavemente
  function getRaw() {
    return {
      lat: state.lat,
      lon: state.lon,
      heading: state.heading,
      speedMps: state.speedMps,
      speedKmh: mpsToKmh(state.speedMps)
    };
  }

  // Posicao "ruidosa" (com micro-jitter) pra expor pro mundo externo.
  // GPS real nunca fica 100% cravado - entrega ±2-3m de ruido.
  // Usado futuramente pelo servidor HTTP (v0.1.2).
  function getNoisy() {
    const j = function () { return (Math.random() - 0.5) * 0.00003; };
    return {
      lat: state.lat + j(),
      lon: state.lon + j(),
      heading: state.heading,
      speedMps: state.speedMps,
      speedKmh: mpsToKmh(state.speedMps),
      accuracy: 5 + Math.random() * 5
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.Movement = {
    init: init,
    teleport: teleport,
    update: update,
    setMode: setMode,
    setMaxSpeedKmh: setMaxSpeedKmh,
    setActiveKindProvider: setActiveKindProvider,
    getRaw: getRaw,
    getNoisy: getNoisy,
    config: config
  };
})(window);
