(function (global) {
  'use strict';

  // Velocidades realistas:
  //   walking medio adulto: 5 km/h = 1.39 m/s
  //   running leve: 12 km/h = 3.33 m/s
  const MODES = {
    walk: { maxSpeedKmh: 5 },
    run:  { maxSpeedKmh: 12 }
  };

  function kmhToMps(k) { return k / 3.6; }
  function mpsToKmh(m) { return m * 3.6; }

  // Factory function: cria uma instancia INDEPENDENTE de Movement.
  // Usada tanto pela API global (compatibilidade) quanto por multi-abas (v0.2.0).
  function createMovement(options) {
    options = options || {};

    const config = {
      mode: 'walk',
      maxSpeedKmh: 5,
      variationKmh: 1.0,
      variationIntervalMs: 1000,
      variationLerpRate: 2.0
    };

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
      lat: typeof options.lat === 'number' ? options.lat : 0,
      lon: typeof options.lon === 'number' ? options.lon : 0,
      speedMps: 0,
      heading: 0,
      variationTargetKmh: 0,
      variationKmh: 0
    };

    // Timer de variacao natural - cada instance tem o seu
    let variationTimer = null;
    function rollVariation() {
      state.variationTargetKmh = (Math.random() - 0.5) * 2 * config.variationKmh;
      const nextIn = config.variationIntervalMs + (Math.random() - 0.5) * 300;
      variationTimer = setTimeout(rollVariation, nextIn);
    }
    rollVariation();

    function init(lat, lon) {
      state.lat = lat;
      state.lon = lon;
      state.speedMps = 0;
      state.heading = 0;
    }

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

    function update(dt, input) {
      const varDiff = state.variationTargetKmh - state.variationKmh;
      const varStep = Math.sign(varDiff) * Math.min(Math.abs(varDiff), config.variationLerpRate * dt);
      state.variationKmh += varStep;

      const effectiveMaxKmh = Math.max(0.3, config.maxSpeedKmh + state.variationKmh);
      const targetMps = kmhToMps(effectiveMaxKmh) * (input.magnitude || 0);

      const accel = kmhToMps(config.maxSpeedKmh) / computeAccelTime();
      const diff = targetMps - state.speedMps;
      const change = Math.sign(diff) * Math.min(Math.abs(diff), accel * dt);
      state.speedMps += change;
      if (state.speedMps < 0.001) state.speedMps = 0;

      if (input.magnitude > 0.05) {
        state.heading = input.heading;
      }

      if (state.speedMps > 0) {
        const dist = state.speedMps * dt;
        const headingRad = state.heading * Math.PI / 180;
        const dNorth = dist * Math.cos(headingRad);
        const dEast  = dist * Math.sin(headingRad);
        const latRad = state.lat * Math.PI / 180;
        state.lat += dNorth / 111320;
        state.lon += dEast  / (111320 * Math.cos(latRad));
      }
    }

    function getRaw() {
      return {
        lat: state.lat,
        lon: state.lon,
        heading: state.heading,
        speedMps: state.speedMps,
        speedKmh: mpsToKmh(state.speedMps)
      };
    }

    function getNoisy() {
      // Jitter so quando efetivamente andando (evita tremor com personagem parado)
      const moving = state.speedMps > 0.1;
      const j = moving
        ? function () { return (Math.random() - 0.5) * 0.00001; }  // ~1m
        : function () { return 0; };
      return {
        lat: state.lat + j(),
        lon: state.lon + j(),
        heading: state.heading,
        speedMps: state.speedMps,
        speedKmh: mpsToKmh(state.speedMps),
        accuracy: moving ? (3 + Math.random() * 3) : 3
      };
    }

    // Destroi a instance (para timer, limpa estado).
    // Usado quando a aba e fechada no multi-abas.
    function destroy() {
      if (variationTimer) {
        clearTimeout(variationTimer);
        variationTimer = null;
      }
    }

    return {
      init: init,
      teleport: teleport,
      update: update,
      setMode: setMode,
      setMaxSpeedKmh: setMaxSpeedKmh,
      setActiveKindProvider: setActiveKindProvider,
      getRaw: getRaw,
      getNoisy: getNoisy,
      destroy: destroy,
      config: config
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  // Factory novo (usado pelo multi-abas)
  global.FakeGPS.createMovement = createMovement;
  // Instance default (compatibilidade com app.js atual - singleton)
  global.FakeGPS.Movement = createMovement();
})(window);
