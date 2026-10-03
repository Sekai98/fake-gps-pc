(function () {
  'use strict';

  // Captura UA ORIGINAL antes de qualquer patch pra detectar se roda em mobile real
  const ORIGINAL_UA = navigator.userAgent;
  const IS_MOBILE_BROWSER = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ORIGINAL_UA);

  // --- MOBILE EMULATION (gocollect.fun) ---
  // Aplicado em document_start, antes do site renderizar.
  // Faz o site "achar" que esta num Android Pixel 8 Pro (UA, platform, touch, viewport).
  // Android emulado > iPhone emulado porque nosso engine real e Chromium: zero divergencia.
  // Nao redimensiona a janela real do Brave — so engana os checks via JS.
  function applyMobileEmulation() {
    const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    const VIEW_W = 412;  // Pixel 8 Pro
    const VIEW_H = 915;
    const DPR = 2.625;

    function define(obj, key, getter) {
      try {
        Object.defineProperty(obj, key, { get: getter, configurable: true });
      } catch (e) { /* silencio */ }
    }

    // navigator overrides
    define(navigator, 'userAgent', function () { return ANDROID_UA; });
    define(navigator, 'platform', function () { return 'Linux armv81'; });
    define(navigator, 'vendor', function () { return 'Google Inc.'; });
    define(navigator, 'maxTouchPoints', function () { return 5; });
    define(navigator, 'userAgentData', function () {
      const brands = [
        { brand: 'Google Chrome', version: '131' },
        { brand: 'Chromium', version: '131' },
        { brand: 'Not_A Brand', version: '24' }
      ];
      return {
        brands: brands,
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: function (hints) {
          const base = {
            brands: brands,
            mobile: true,
            platform: 'Android',
            platformVersion: '14.0.0',
            architecture: 'arm',
            bitness: '64',
            model: 'Pixel 8 Pro',
            uaFullVersion: '131.0.6778.86'
          };
          const out = {};
          if (Array.isArray(hints)) {
            hints.forEach(function (h) { if (base[h] !== undefined) out[h] = base[h]; });
          }
          return Promise.resolve(Object.keys(out).length ? out : base);
        },
        toJSON: function () { return { brands: brands, mobile: true, platform: 'Android' }; }
      };
    });
    // devicePixelRatio - Pixel 8 Pro
    define(window, 'devicePixelRatio', function () { return DPR; });

    // ontouchstart in window (sinal classico de touch)
    try {
      if (!('ontouchstart' in window)) {
        Object.defineProperty(window, 'ontouchstart', { value: null, writable: true, configurable: true });
      }
    } catch (e) { /* silencio */ }

    // Viewport dimensions
    define(window, 'innerWidth', function () { return VIEW_W; });
    define(window, 'innerHeight', function () { return VIEW_H; });
    define(window, 'outerWidth', function () { return VIEW_W; });
    define(window, 'outerHeight', function () { return VIEW_H; });

    // Screen dimensions
    define(screen, 'width', function () { return VIEW_W; });
    define(screen, 'height', function () { return VIEW_H; });
    define(screen, 'availWidth', function () { return VIEW_W; });
    define(screen, 'availHeight', function () { return VIEW_H; });

    // matchMedia: responde "true" pra queries tipicas de mobile
    const originalMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
    if (originalMatchMedia) {
      window.matchMedia = function (query) {
        const result = originalMatchMedia(query);
        // Pointer coarse / hover none sao sinais de mobile
        if (/pointer\s*:\s*coarse/.test(query) || /hover\s*:\s*none/.test(query)) {
          return new Proxy(result, { get: function (t, p) { return p === 'matches' ? true : t[p]; } });
        }
        // Media queries de max-width que o viewport mobile satisfaz
        const maxMatch = query.match(/max-width\s*:\s*(\d+)px/);
        if (maxMatch && VIEW_W <= parseInt(maxMatch[1], 10)) {
          return new Proxy(result, { get: function (t, p) { return p === 'matches' ? true : t[p]; } });
        }
        // min-width que o viewport NAO satisfaz
        const minMatch = query.match(/min-width\s*:\s*(\d+)px/);
        if (minMatch && VIEW_W < parseInt(minMatch[1], 10)) {
          return new Proxy(result, { get: function (t, p) { return p === 'matches' ? false : t[p]; } });
        }
        return result;
      };
    }

    console.log('%c[Fake GPS] Android emulado', 'background:#4caf50;color:#fff;padding:2px 6px;border-radius:3px', '(Pixel 8 Pro / Chrome 131)');
  }

  // --- MOTION / ORIENTATION SENSORS (DeviceMotionEvent + DeviceOrientationEvent) ---
  // Em desktop Chrome esses eventos nunca disparam, mas sites mobile usam pra detectar
  // passos / orientacao / "movimento real". Simulamos sinteticamente baseado no
  // speedMps + heading recebidos do fake GPS (via content.js postMessage).
  //
  // getCurrent: () => { speedMps, heading } - closure sobre CURRENT (definido abaixo)
  function applyMotionSensorEmulation(getCurrent, isEnabled) {
    const g = 9.81;
    const FIRE_HZ = 60; // Android Chrome dispara motion a ~60Hz
    // Android nao exige requestPermission() (so iOS 13+ exige), entao nenhum patch necessario.

    const tStart = performance.now();

    function noise(amp) { return (Math.random() - 0.5) * amp; }

    // Cria DeviceMotionEvent (ou fallback com Event + defineProperty)
    function makeMotionEvent(acc, accG, rot, interval) {
      try {
        return new DeviceMotionEvent('devicemotion', {
          acceleration: acc,
          accelerationIncludingGravity: accG,
          rotationRate: rot,
          interval: interval
        });
      } catch (e) {
        const evt = new Event('devicemotion');
        Object.defineProperty(evt, 'acceleration', { value: acc });
        Object.defineProperty(evt, 'accelerationIncludingGravity', { value: accG });
        Object.defineProperty(evt, 'rotationRate', { value: rot });
        Object.defineProperty(evt, 'interval', { value: interval });
        return evt;
      }
    }

    function makeOrientationEvent(type, alpha, beta, gamma, absolute) {
      try {
        return new DeviceOrientationEvent(type, {
          alpha: alpha, beta: beta, gamma: gamma, absolute: absolute
        });
      } catch (e) {
        const evt = new Event(type);
        Object.defineProperty(evt, 'alpha', { value: alpha });
        Object.defineProperty(evt, 'beta', { value: beta });
        Object.defineProperty(evt, 'gamma', { value: gamma });
        Object.defineProperty(evt, 'absolute', { value: absolute });
        return evt;
      }
    }

    function fireEvents() {
      if (!isEnabled()) return;
      const now = performance.now();
      const t = (now - tStart) / 1000;
      const c = getCurrent();
      const speedMps = c.speedMps || 0;
      const headingDeg = c.heading || 0;

      // Cadencia de passos: 2Hz walking, 3Hz running, 0 parado
      const stepFreq = speedMps < 0.3 ? 0 : (speedMps < 2 ? 2 : (speedMps < 4 ? 3 : 3.5));
      const stepPhase = 2 * Math.PI * stepFreq * t;

      // Amplitude de passo em m/s² (cresce com velocidade, cap em 3)
      const stepAmp = speedMps < 0.3 ? 0.05 : Math.min(3, 1 + speedMps * 0.4);

      // Acceleration sem gravidade (celular na mao, eixos: x=lateral, y=frontal, z=vertical)
      const accX = Math.sin(stepPhase) * stepAmp * 0.3 + noise(0.15);
      const accY = Math.cos(stepPhase * 0.8) * stepAmp * 0.4 + noise(0.15);
      const accZ = Math.sin(stepPhase * 2) * stepAmp + noise(0.15);

      // Acceleration + gravity (celular semi-vertical: z recebe ~9.81)
      const acc = { x: accX, y: accY, z: accZ };
      const accG = { x: accX, y: accY, z: accZ + g };

      // Rotation rate (deg/s) - oscila levemente
      const rot = {
        alpha: Math.sin(stepPhase * 0.5) * 5 + noise(8),
        beta:  Math.cos(stepPhase * 0.3) * 3 + noise(8),
        gamma: Math.sin(stepPhase * 0.7) * 4 + noise(8)
      };

      window.dispatchEvent(makeMotionEvent(acc, accG, rot, 1000 / FIRE_HZ));

      // Orientation: se o fake GPS mandou valores manuais, usa eles.
      // Senao, calcula automaticamente: alpha=heading (CW->CCW), beta/gamma oscilando leve.
      let alpha, beta, gamma;
      if (CURRENT_ORIENTATION) {
        alpha = CURRENT_ORIENTATION.alpha;
        beta  = CURRENT_ORIENTATION.beta;
        gamma = CURRENT_ORIENTATION.gamma;
      } else {
        alpha = ((360 - headingDeg) % 360 + 360) % 360;
        beta  = 70 + Math.sin(stepPhase * 0.4) * 3;
        gamma = Math.sin(stepPhase * 0.6) * 5;
      }

      window.dispatchEvent(makeOrientationEvent('deviceorientation', alpha, beta, gamma, true));
      window.dispatchEvent(makeOrientationEvent('deviceorientationabsolute', alpha, beta, gamma, true));
    }

    setInterval(fireEvents, 1000 / FIRE_HZ);

    console.log('%c[Fake GPS] motion sensors ativos', 'background:#4caf50;color:#fff;padding:2px 6px;border-radius:3px', '(60Hz devicemotion + deviceorientation)');
  }

  // Aplica somente em gocollect.fun. Outros sites ficam intactos.
  // Pula se ja estamos num browser mobile real (nao precisa emular - os checks ja passam).
  if (location.hostname && location.hostname.indexOf('gocollect.fun') !== -1 && !IS_MOBILE_BROWSER) {
    applyMobileEmulation();
  }


  // Cache local da posicao atual.
  // Fallback estatico (Av. Paulista) usado quando o Electron NAO esta rodando.
  // Quando o Electron esta aberto, o content.js alimenta este cache via postMessage a 2Hz.
  let CURRENT = {
    lat: -23.561684,
    lon: -46.655981,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    heading: 0,
    speedMps: 0
  };
  let CURRENT_ORIENTATION = null; // { alpha, beta, gamma } ou null (usa calculo automatico)
  let LAST_UPDATE_TS = 0;

  // Flag mestre: quando false, redirecionamos pros metodos NATIVOS do navegador
  // (localizacao real do SO). Controlado pelo botao do popup via content.js.
  let overrideEnabled = true;

  // Motion sensors sinteticos - usam CURRENT.speedMps + heading via closure.
  // IMPORTANTE: so no DESKTOP. No mobile real, o sensor nativo (bussola, acelerometro)
  // precisa funcionar normalmente - nossa dispatch sintetica a 60Hz competia com ele
  // e dominava, impedindo o celular de controlar a bussola do site.
  if (location.hostname && location.hostname.indexOf('gocollect.fun') !== -1 && !IS_MOBILE_BROWSER) {
    applyMotionSensorEmulation(
      function () { return { speedMps: CURRENT.speedMps, heading: CURRENT.heading }; },
      function () { return overrideEnabled; }
    );
  }

  // Guarda refs ORIGINAIS antes de qualquer override pra podermos "desligar" de verdade
  const _geolocation = navigator.geolocation;
  const _nativeToString = Function.prototype.toString;
  const nativeGetCurrentPosition = _geolocation.getCurrentPosition.bind(_geolocation);
  const nativeWatchPosition = _geolocation.watchPosition.bind(_geolocation);
  const nativeClearWatch = _geolocation.clearWatch.bind(_geolocation);
  const nativePermissionsQuery = (navigator.permissions && navigator.permissions.query)
    ? navigator.permissions.query.bind(navigator.permissions)
    : null;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  // --- Interceptor de fetch pra detectar crates do gocollect.fun ---
  // Procura responses JSON com campo `crates` (array). Envia via postMessage.
  // Agnostico de URL: funciona com qualquer endpoint que retorne {crates: [...]}.
  // v0.1.14: tambem captura o Authorization: Bearer de requests autenticados
  //          em gocollect.fun pra o Fake GPS listar beacons sem o usuário colar token.
  let lastCapturedToken = null;
  function extractBearerFromInit(input, init) {
    try {
      let headers = null;
      if (input instanceof Request) headers = input.headers;
      else if (init && init.headers) {
        headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
      }
      if (!headers) return null;
      const auth = headers.get('authorization') || headers.get('Authorization');
      if (!auth) return null;
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function requestUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (input instanceof Request) return input.url;
      if (input && input.url) return input.url;
    } catch (e) {}
    return '';
  }

  if (nativeFetch) {
    window.fetch = async function (input, init) {
      // Captura token Bearer em requests pra gocollect.fun (antes do fetch nativo).
      // Resolve URL relativa (ex: '/v1/crates') contra location.href pra pegar o host atual.
      try {
        const url = requestUrl(input);
        let fullUrl = '';
        try { fullUrl = new URL(url || '', location.href).href; } catch (e) {}
        if (fullUrl.indexOf('gocollect.fun') !== -1) {
          const token = extractBearerFromInit(input, init);
          if (token && token !== lastCapturedToken) {
            lastCapturedToken = token;
            window.postMessage({
              __fakegps_gocollect_token: true,
              token: token,
              ts: Date.now()
            }, '*');
          }
        }
      } catch (e) { /* silencio */ }

      const resp = await nativeFetch(input, init);
      try {
        const ct = resp.headers.get('content-type') || '';
        if (ct.indexOf('application/json') !== -1) {
          // Clona pra nao consumir o body original
          const clone = resp.clone();
          clone.json().then(function (data) {
            if (data && Array.isArray(data.crates)) {
              window.postMessage({
                __fakegps_crates: true,
                crates: data.crates,
                lures: Array.isArray(data.lures) ? data.lures : [],
                ts: Date.now()
              }, '*');
            }
          }).catch(function () { /* nao-json valido, ignora */ });
        }
      } catch (e) { /* silencio: nao interfere no fetch do site */ }
      return resp;
    };
    // Stealth: toString nativa pra o fetch wrapper
    // (adicionado ao mapa depois dos outros overrides)
  }

  // Escuta mensagens do content.js (que faz polling do servidor local)
  window.addEventListener('message', function (evt) {
    if (evt.source !== window) return;
    const d = evt.data;
    if (!d || d.__fakegps_poc !== true) return;
    if (d.kind === 'location' && d.location) {
      CURRENT = {
        lat: d.location.lat,
        lon: d.location.lon,
        accuracy: d.location.accuracy || 8,
        altitude: null,
        altitudeAccuracy: null,
        heading: typeof d.location.heading === 'number' ? d.location.heading : CURRENT.heading,
        speedMps: typeof d.location.speedMps === 'number' ? d.location.speedMps : 0
      };
      // Orientation vem junto no payload do /location se o fake GPS esta rodando
      if (d.location.orientation && typeof d.location.orientation === 'object') {
        const o = d.location.orientation;
        if (typeof o.alpha === 'number' && typeof o.beta === 'number' && typeof o.gamma === 'number') {
          CURRENT_ORIENTATION = { alpha: o.alpha, beta: o.beta, gamma: o.gamma };
        }
      }
      LAST_UPDATE_TS = Date.now();
    }
    if (d.kind === 'enabled') {
      overrideEnabled = !!d.value;
      // Log so quando muda de estado
      console.log(
        '%c[Fake GPS] ' + (overrideEnabled ? 'LIGADO' : 'DESLIGADO (usando GPS real)'),
        'background:' + (overrideEnabled ? '#1a73e8' : '#e53935') + ';color:#fff;padding:2px 6px;border-radius:3px'
      );
    }
  });

  function makePosition() {
    // Se faz > 2s que nao recebemos update, estamos em fallback estatico -> adiciona micro-jitter
    // Senao, o Electron ja envia posicao com jitter natural do getNoisy()
    const inFallback = (Date.now() - LAST_UPDATE_TS) > 2000;
    const jitter = inFallback ? ((Math.random() - 0.5) * 0.00005) : 0;
    return {
      coords: {
        latitude: CURRENT.lat + jitter,
        longitude: CURRENT.lon + jitter,
        accuracy: CURRENT.accuracy + Math.random() * 2,
        altitude: CURRENT.altitude,
        altitudeAccuracy: CURRENT.altitudeAccuracy,
        heading: CURRENT.speedMps > 0.1 ? CURRENT.heading : null,
        speed: CURRENT.speedMps
      },
      timestamp: Date.now()
    };
  }

  function fakeGetCurrentPosition(success, error, options) {
    // Se desligado, passa direto pro nativo
    if (!overrideEnabled) {
      return nativeGetCurrentPosition(success, error, options);
    }
    const delay = 50 + Math.random() * 150;
    setTimeout(function () {
      try { success(makePosition()); } catch (e) { /* silencio */ }
    }, delay);
  }

  const watches = new Map();           // id proprio -> intervalId
  const nativeWatches = new Map();     // id proprio -> watchId nativo (quando desligado)
  let nextWatchId = 1;

  function fakeWatchPosition(success, error, options) {
    const id = nextWatchId++;
    if (!overrideEnabled) {
      // Delega totalmente pro nativo (guarda watchId pra conseguir clearWatch depois)
      const nativeId = nativeWatchPosition(success, error, options);
      nativeWatches.set(id, nativeId);
      return id;
    }
    setTimeout(function () {
      try { success(makePosition()); } catch (e) { /* silencio */ }
    }, 100);
    const interval = setInterval(function () {
      // Durante um watch ativo, se o override for desligado em tempo real,
      // mantemos o watch rodando (nao migra pra nativo on-the-fly) -
      // isso evita bagunca; o site pode re-subscrever se quiser.
      try { success(makePosition()); } catch (e) { /* silencio */ }
    }, 950 + Math.random() * 100);
    watches.set(id, interval);
    return id;
  }

  function fakeClearWatch(id) {
    const interval = watches.get(id);
    if (interval) { clearInterval(interval); watches.delete(id); return; }
    const nativeId = nativeWatches.get(id);
    if (nativeId !== undefined) { nativeClearWatch(nativeId); nativeWatches.delete(id); return; }
  }

  Object.defineProperty(_geolocation, 'getCurrentPosition', {
    value: fakeGetCurrentPosition, writable: true, configurable: true, enumerable: true
  });
  Object.defineProperty(_geolocation, 'watchPosition', {
    value: fakeWatchPosition, writable: true, configurable: true, enumerable: true
  });
  Object.defineProperty(_geolocation, 'clearWatch', {
    value: fakeClearWatch, writable: true, configurable: true, enumerable: true
  });

  // STEALTH: Function.prototype.toString devolve string nativa pros nossos targets
  const nativeStrings = new Map([
    [_geolocation.getCurrentPosition, 'function getCurrentPosition() { [native code] }'],
    [_geolocation.watchPosition, 'function watchPosition() { [native code] }'],
    [_geolocation.clearWatch, 'function clearWatch() { [native code] }']
  ]);
  if (nativeFetch) {
    nativeStrings.set(window.fetch, 'function fetch() { [native code] }');
  }

  Function.prototype.toString = new Proxy(_nativeToString, {
    apply: function (target, thisArg, args) {
      if (nativeStrings.has(thisArg)) return nativeStrings.get(thisArg);
      return Reflect.apply(target, thisArg, args);
    }
  });

  // Permissions API: finge que geolocation ja foi concedido (so se override ligado)
  if (navigator.permissions && navigator.permissions.query && nativePermissionsQuery) {
    navigator.permissions.query = function (descriptor) {
      if (overrideEnabled && descriptor && descriptor.name === 'geolocation') {
        return Promise.resolve({
          state: 'granted', status: 'granted', onchange: null,
          addEventListener: function () {}, removeEventListener: function () {},
          dispatchEvent: function () { return true; }
        });
      }
      return nativePermissionsQuery(descriptor);
    };
    nativeStrings.set(navigator.permissions.query, 'function query() { [native code] }');
  }

  // Marca pro popup detectar e debugar
  try {
    window.__FAKE_GPS_POC__ = {
      active: true,
      get enabled() { return overrideEnabled; },
      get target() { return { lat: CURRENT.lat, lon: CURRENT.lon }; },
      get dynamic() { return (Date.now() - LAST_UPDATE_TS) < 2000; },
      get speedMps() { return CURRENT.speedMps; },
      version: '0.1.14'
    };
  } catch (e) { /* silencio */ }

  console.log(
    '%c[Fake GPS] carregado',
    'background:#1a73e8;color:#fff;padding:2px 6px;border-radius:3px',
    '(fallback: ' + CURRENT.lat + ', ' + CURRENT.lon + ' | aguardando estado do popup)'
  );
})();
