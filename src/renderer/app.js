(function (global) {
  'use strict';

  const TabsManager = global.FakeGPS.TabsManager;
  const Humanity = global.FakeGPS.Humanity;
  const Routing = global.FakeGPS.Routing;
  const Presets = global.FakeGPS.Presets;
  const CarConfig = global.FakeGPS.CarConfig;
  const Input = global.FakeGPS.Input;

  // --- Isolamento por aba (alpha3) ---
  // Pega a aba ativa e cria instances com storageKey namespaced.
  // Troca de aba = reload da pagina (vai no onswitch mais abaixo).
  const activeTabId = TabsManager.getActiveId();
  const activeTab = TabsManager.getActive();
  console.log('[Tab ativa]', activeTab && activeTab.name, '(' + activeTabId + ')');

  // Persistence e RoutePlanner: isoladas por aba via storageKey
  const Persistence = global.FakeGPS.createPersistence({
    storageKey: TabsManager.storageKey(activeTabId, 'state')
  });
  const RoutePlanner = global.FakeGPS.createRoutePlanner({
    storageKey: TabsManager.storageKey(activeTabId, 'route-plan')
  });

  // Movement/AutoPilot/Crates/Map: compartilham a instance default do window.
  // Como cada troca de aba faz reload, fica fresh por aba naturalmente.
  // Presets/CarConfig/Humanity: continuam compartilhados entre abas (config global).
  const Movement = global.FakeGPS.Movement;
  const AutoPilot = global.FakeGPS.AutoPilot;
  const Crates = global.FakeGPS.Crates;
  const Map = global.FakeGPS.Map;

  // --- UI refs ---
  const latEl = document.getElementById('lat');
  const lonEl = document.getElementById('lon');
  const headEl = document.getElementById('heading');
  const speedoValue = document.getElementById('speedo-value');
  const speedoMax = document.getElementById('speedo-max');
  const speedoEta = document.getElementById('speedo-eta');
  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');
  const btnCenter = document.getElementById('btn-center');
  const btnLock = document.getElementById('btn-lock');
  const btnCancelRoute = document.getElementById('btn-cancel-route');
  const btnPause = document.getElementById('btn-pause');
  const statusIndicator = document.getElementById('status-indicator');
  const speedSelector = document.getElementById('speed-selector');
  const btnEditPresets = document.getElementById('btn-edit-presets');

  // --- State ---
  let isPaused = false;
  let activePresetId = 'walk'; // preset atualmente ativo (walk/run/car/custom id)

  function getActivePreset() {
    const presets = Presets.loadAll();
    return presets.find(function (p) { return p.id === activePresetId; }) || presets[0];
  }

  // Providers: movement.js e autopilot.js consultam pra decidir se usam
  // config do carro ou formula padrao.
  Movement.setActiveKindProvider(function () {
    const p = getActivePreset();
    return p ? p.kind : 'walk';
  });
  AutoPilot.setActiveKindProvider(function () {
    const p = getActivePreset();
    return p ? p.kind : 'walk';
  });

  // Cadeado de teleporte: trancado por padrao. Destravar da 5s de janela.
  let teleportLocked = true;
  let lockReArmTimeoutId = null;
  let lockCountdownIntervalId = null;
  const UNLOCK_WINDOW_MS = 5000;

  function isTeleportAllowed() { return !teleportLocked; }

  function updateLockUI(secondsLeft) {
    if (teleportLocked) {
      btnLock.textContent = '🔒 Teleporte: BLOQUEADO';
      btnLock.classList.remove('lock-unlocked');
      btnLock.classList.add('lock-locked');
    } else {
      const sec = typeof secondsLeft === 'number' ? Math.max(1, Math.ceil(secondsLeft)) : 5;
      btnLock.textContent = '🔓 Teleporte: LIVRE (' + sec + 's)';
      btnLock.classList.remove('lock-locked');
      btnLock.classList.add('lock-unlocked');
    }
  }

  function clearLockTimers() {
    if (lockReArmTimeoutId) { clearTimeout(lockReArmTimeoutId); lockReArmTimeoutId = null; }
    if (lockCountdownIntervalId) { clearInterval(lockCountdownIntervalId); lockCountdownIntervalId = null; }
  }

  function unlockTeleportTemporarily() {
    teleportLocked = false;
    clearLockTimers();
    updateLockUI(5);
    const start = Date.now();
    lockCountdownIntervalId = setInterval(function () {
      const elapsed = Date.now() - start;
      const left = (UNLOCK_WINDOW_MS - elapsed) / 1000;
      if (left <= 0) {
        clearLockTimers();
        teleportLocked = true;
        updateLockUI();
      } else {
        updateLockUI(left);
      }
    }, 200);
  }

  function lockTeleportNow() {
    teleportLocked = true;
    clearLockTimers();
    updateLockUI();
  }

  btnLock.addEventListener('click', function () {
    if (teleportLocked) unlockTeleportTemporarily();
    else lockTeleportNow();
  });
  updateLockUI();

  // --- Presets de velocidade: render dinamico ---
  // Cada preset = .preset-group com .mode-btn (seleciona) + .preset-gear-btn (config)
  function renderPresets() {
    const presets = Presets.loadAll();
    speedSelector.innerHTML = '';
    presets.forEach(function (p) {
      const group = document.createElement('div');
      group.className = 'preset-group';

      const btn = document.createElement('button');
      btn.className = 'mode-btn' + (p.id === activePresetId ? ' active' : '');
      btn.dataset.id = p.id;
      btn.dataset.kmh = String(p.kmh);
      btn.dataset.kind = p.kind;
      btn.innerHTML = '<span class="emoji">' + escapeHtml(p.emoji) + '</span> '
        + escapeHtml(p.name) + ' <span class="sub">' + p.kmh + ' km/h</span>';
      btn.addEventListener('click', function () {
        selectPreset(p.id);
      });

      const gearBtn = document.createElement('button');
      gearBtn.className = 'preset-gear-btn';
      gearBtn.title = 'Configuracoes de "' + p.name + '"';
      gearBtn.textContent = '⚙';
      gearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openPresetConfig(p);
      });

      group.appendChild(btn);
      group.appendChild(gearBtn);
      speedSelector.appendChild(group);
    });
  }

  function selectPreset(id) {
    const presets = Presets.loadAll();
    const p = presets.find(function (x) { return x.id === id; });
    if (!p) return;
    activePresetId = id;
    Movement.setMaxSpeedKmh(p.kmh);
    const sliderMax = parseFloat(speedSlider.max);
    speedSlider.value = Math.min(p.kmh, sliderMax);
    speedValue.textContent = p.kmh.toFixed(1);
    speedSelector.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.id === id);
    });
    saveNow();
  }

  renderPresets();

  // --- Init: carrega posicao salva ou usa Paulista default ---
  (function initPosition() {
    const saved = Persistence.load();
    if (saved) {
      Movement.init(saved.lat, saved.lon);
      if (typeof saved.maxSpeedKmh === 'number') {
        Movement.setMaxSpeedKmh(saved.maxSpeedKmh);
        const sliderMax = parseFloat(speedSlider.max);
        speedSlider.value = Math.min(saved.maxSpeedKmh, sliderMax);
        speedValue.textContent = saved.maxSpeedKmh.toFixed(1);
      }
      // Reflete preset ativo pelo kmh salvo
      renderPresets();
      // Centra o mapa na posicao salva
      Map.map.setView([saved.lat, saved.lon], Map.map.getZoom());
      // Restaura estado de pausa
      if (saved.paused) {
        isPaused = true;
        updatePauseUI();
      }
      // Restaura preset ativo + humanidade
      if (saved.activePresetId) {
        activePresetId = saved.activePresetId;
      }
      if (saved.humanityEnabled) {
        Humanity.enable();
      }
      renderPresets();
      console.log('[Fake GPS PC] posicao restaurada:', saved.lat.toFixed(6), saved.lon.toFixed(6));
    } else {
      Movement.init(Map.startPosition.lat, Map.startPosition.lon);
    }
  })();

  // --- UI wiring ---
  speedSlider.addEventListener('input', function () {
    const v = parseFloat(speedSlider.value);
    speedValue.textContent = v.toFixed(1);
    Movement.setMaxSpeedKmh(v);
    // Sincroniza selecao visual: se slider bate exato em algum preset, destaca
    const presets = Presets.loadAll();
    speedSelector.querySelectorAll('.mode-btn').forEach(function (b) { b.classList.remove('active'); });
    const match = presets.find(function (p) { return Math.abs(v - p.kmh) < 0.1; });
    if (match) {
      activePresetId = match.id;
      const btn = speedSelector.querySelector('[data-id="' + match.id + '"]');
      if (btn) btn.classList.add('active');
    }
  });

  // --- Modal editar presets ---
  const modalPresets = document.getElementById('modal-presets');
  const presetsListEl = document.getElementById('presets-list');
  const modalPresetsError = document.getElementById('modal-presets-error');

  let draftPresets = [];

  function renderPresetsEditor() {
    presetsListEl.innerHTML = '';
    draftPresets.forEach(function (p, idx) {
      const row = document.createElement('div');
      row.className = 'preset-row';
      row.innerHTML = [
        '<input class="preset-emoji" value="', escapeHtml(p.emoji), '" maxlength="4" title="Emoji">',
        '<input class="preset-name" value="', escapeHtml(p.name), '" maxlength="20" placeholder="Nome">',
        '<input class="preset-kmh" type="number" min="0.5" max="200" step="0.5" value="', p.kmh, '">',
        '<span class="preset-kmh-unit">km/h</span>',
        '<button data-action="remove" title="Remover">✕</button>'
      ].join('');
      row.querySelector('.preset-emoji').addEventListener('input', function (e) {
        draftPresets[idx].emoji = e.target.value;
      });
      row.querySelector('.preset-name').addEventListener('input', function (e) {
        draftPresets[idx].name = e.target.value;
      });
      row.querySelector('.preset-kmh').addEventListener('input', function (e) {
        draftPresets[idx].kmh = parseFloat(e.target.value) || 0;
      });
      row.querySelector('[data-action="remove"]').addEventListener('click', function () {
        draftPresets.splice(idx, 1);
        renderPresetsEditor();
      });
      presetsListEl.appendChild(row);
    });
  }

  function openPresetsModal() {
    draftPresets = Presets.loadAll().map(function (p) {
      return { id: p.id, name: p.name, emoji: p.emoji, kmh: p.kmh };
    });
    modalPresetsError.classList.add('hidden');
    renderPresetsEditor();
    modalPresets.classList.remove('hidden');
  }
  function closePresetsModal() { modalPresets.classList.add('hidden'); }

  function savePresets() {
    // Validacao
    for (const p of draftPresets) {
      if (!p.name || !p.name.trim()) {
        modalPresetsError.textContent = 'Todos os presets precisam ter nome.';
        modalPresetsError.classList.remove('hidden');
        return;
      }
      if (!(p.kmh > 0 && p.kmh <= 200)) {
        modalPresetsError.textContent = 'Velocidade deve ser entre 0.5 e 200 km/h.';
        modalPresetsError.classList.remove('hidden');
        return;
      }
    }
    Presets.replaceAll(draftPresets);
    renderPresets();
    closePresetsModal();
  }

  btnEditPresets.addEventListener('click', openPresetsModal);
  document.getElementById('btn-add-preset').addEventListener('click', function () {
    draftPresets.push({
      id: 'p_' + Date.now(),
      name: 'Novo',
      emoji: '🏷️',
      kmh: 10
    });
    renderPresetsEditor();
  });
  document.getElementById('modal-presets-cancel').addEventListener('click', closePresetsModal);
  document.getElementById('modal-presets-save').addEventListener('click', savePresets);
  document.getElementById('modal-presets-reset').addEventListener('click', function () {
    draftPresets = Presets.DEFAULT_PRESETS.map(function (p) {
      return { id: p.id, name: p.name, emoji: p.emoji, kmh: p.kmh };
    });
    modalPresetsError.classList.add('hidden');
    renderPresetsEditor();
  });
  modalPresets.addEventListener('click', function (e) {
    if (e.target === modalPresets) closePresetsModal();
  });

  btnCenter.addEventListener('click', function () {
    Map.centerOnMarker(true);
  });

  btnPause.addEventListener('click', function () {
    isPaused = !isPaused;
    updatePauseUI();
    saveNow(); // persiste estado imediatamente
  });

  // --- Estado de orientacao do celular (DeviceOrientationEvent) ---
  const ORIENTATION_STORAGE_KEY = 'fake-gps-pc:orientation';
  const DEFAULT_ORIENTATION = { alpha: 0, beta: 70, gamma: 0, alphaFromHeading: true };

  function loadOrientationState() {
    try {
      const raw = localStorage.getItem(ORIENTATION_STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object'
            && typeof o.alpha === 'number' && typeof o.beta === 'number' && typeof o.gamma === 'number') {
          return {
            alpha: o.alpha, beta: o.beta, gamma: o.gamma,
            alphaFromHeading: o.alphaFromHeading !== false
          };
        }
      }
    } catch (e) { /* silencio */ }
    return Object.assign({}, DEFAULT_ORIENTATION);
  }
  function saveOrientationState() {
    try { localStorage.setItem(ORIENTATION_STORAGE_KEY, JSON.stringify(orientationState)); } catch (e) {}
  }

  let orientationState = loadOrientationState();

  // --- Modal 3D de orientacao ---
  const modalOrientation = document.getElementById('modal-orientation');
  const btnOrientation = document.getElementById('btn-orientation');
  const phone3d = document.getElementById('phone-3d');
  const oriAlpha = document.getElementById('ori-alpha');
  const oriBeta = document.getElementById('ori-beta');
  const oriGamma = document.getElementById('ori-gamma');
  const oriAlphaVal = document.getElementById('ori-alpha-val');
  const oriBetaVal = document.getElementById('ori-beta-val');
  const oriGammaVal = document.getElementById('ori-gamma-val');
  const oriAlphaFromHeading = document.getElementById('ori-alpha-from-heading');

  // Converte alpha 0-360 (interno/W3C) pra -180..180 (slider UI).
  // 0° fica no centro do slider, 90° a direita (CCW), -90° a esquerda (CW).
  function alphaToSlider(a) {
    let v = a % 360;
    if (v > 180) v -= 360;
    return v;
  }
  function sliderToAlpha(v) {
    let a = v % 360;
    if (a < 0) a += 360;
    return a;
  }

  function applyOrientationToUI() {
    const a = orientationState.alpha;
    const b = orientationState.beta;
    const g = orientationState.gamma;
    // Ordem Z-X'-Y'' (DeviceOrientation spec). CSS aplica da direita pra esquerda.
    phone3d.style.transform = 'rotateZ(' + a + 'deg) rotateX(' + b + 'deg) rotateY(' + g + 'deg)';
    oriAlpha.value = alphaToSlider(a);
    oriBeta.value = b;
    oriGamma.value = g;
    const sliderA = alphaToSlider(a);
    oriAlphaVal.textContent = sliderA.toFixed(0) + '°';
    oriBetaVal.textContent = b.toFixed(0) + '°';
    oriGammaVal.textContent = g.toFixed(0) + '°';
    oriAlphaFromHeading.checked = orientationState.alphaFromHeading;
  }

  function openOrientationModal() {
    applyOrientationToUI();
    modalOrientation.classList.remove('hidden');
  }
  function closeOrientationModal() { modalOrientation.classList.add('hidden'); }

  // --- Espelhamento do sensor remoto no preview 3D ---
  // Quando sensor remoto esta ativo E modal 3D aberto, atualiza o preview em tempo real
  // SEM alterar orientationState (nao salva, so visualiza).
  const phone3dMirrorBadge = document.getElementById('phone-3d-mirror-badge');
  let isMirroringRemote = false;

  // Angulos cumulativos pra evitar "flicks" quando alpha passa de 359->0 ou similar.
  // CSS rotateZ(0) depois de rotateZ(359) faz animacao de volta inteira - visualmente
  // parece pulo. Unwrap mantem a rotacao continua.
  let cumulAlpha = null, cumulBeta = null, cumulGamma = null;
  let lastRawAlpha = null, lastRawBeta = null, lastRawGamma = null;

  function unwrapAngle(cumul, lastRaw, newRaw) {
    if (cumul === null || lastRaw === null) return { cumul: newRaw, lastRaw: newRaw };
    let delta = newRaw - lastRaw;
    // Menor diferenca angular (-180 a 180) considerando wrap
    delta = ((delta + 540) % 360) - 180;
    return { cumul: cumul + delta, lastRaw: newRaw };
  }

  function applyMirrored3D(alpha, beta, gamma) {
    const a = unwrapAngle(cumulAlpha, lastRawAlpha, alpha);
    const b = unwrapAngle(cumulBeta, lastRawBeta, beta);
    // Gamma e small range (-90 a 90), raramente wrap - simplifica
    cumulAlpha = a.cumul; lastRawAlpha = a.lastRaw;
    cumulBeta = b.cumul; lastRawBeta = b.lastRaw;
    cumulGamma = gamma; lastRawGamma = gamma;
    phone3d.style.transform = 'rotateZ(' + cumulAlpha + 'deg) rotateX(' + cumulBeta + 'deg) rotateY(' + cumulGamma + 'deg)';
  }

  function resetMirrorCumulatives() {
    cumulAlpha = null; cumulBeta = null; cumulGamma = null;
    lastRawAlpha = null; lastRawBeta = null; lastRawGamma = null;
  }

  // --- Gravador de orientacao (debug) ---
  let isRecording = false;
  let recordStartTs = 0;
  let recordedData = [];
  let lastRecordedAlpha = null, lastRecordedBeta = null, lastRecordedGamma = null;
  const oriRecordBtn = document.getElementById('ori-record-btn');
  const oriRecordCopy = document.getElementById('ori-record-copy');
  const oriRecordClear = document.getElementById('ori-record-clear');
  const oriRecordCount = document.getElementById('ori-record-count');
  const oriRecordLog = document.getElementById('ori-record-log');

  function recordTick(alpha, beta, gamma) {
    if (!isRecording) return;
    // So grava se mudou (evita spam de ticks identicos)
    const changed = lastRecordedAlpha === null
      || Math.abs(alpha - lastRecordedAlpha) > 0.1
      || Math.abs(beta - lastRecordedBeta) > 0.1
      || Math.abs(gamma - lastRecordedGamma) > 0.1;
    if (!changed) return;
    const t = Date.now() - recordStartTs;
    recordedData.push({ t: t, alpha: alpha, beta: beta, gamma: gamma });
    lastRecordedAlpha = alpha;
    lastRecordedBeta = beta;
    lastRecordedGamma = gamma;
    if (oriRecordCount) oriRecordCount.textContent = recordedData.length + ' ticks';
  }

  function startRecording() {
    isRecording = true;
    recordedData = [];
    recordStartTs = Date.now();
    lastRecordedAlpha = null;
    lastRecordedBeta = null;
    lastRecordedGamma = null;
    oriRecordBtn.classList.add('recording');
    oriRecordBtn.textContent = '⏹ Parar gravacao';
    oriRecordCopy.classList.add('hidden');
    oriRecordClear.classList.add('hidden');
    oriRecordLog.classList.add('hidden');
    oriRecordLog.value = '';
    if (oriRecordCount) oriRecordCount.textContent = '0 ticks';
  }

  function stopRecording() {
    isRecording = false;
    oriRecordBtn.classList.remove('recording');
    oriRecordBtn.textContent = '⏺ Gravar movimento';
    // Formata log
    const header = 't(ms)\tα(alpha)\tβ(beta)\tγ(gamma)\tΔα\tΔβ\tΔγ';
    const lines = [header];
    let prev = null;
    recordedData.forEach(function (r) {
      const da = prev ? (r.alpha - prev.alpha).toFixed(2) : '—';
      const db = prev ? (r.beta - prev.beta).toFixed(2) : '—';
      const dg = prev ? (r.gamma - prev.gamma).toFixed(2) : '—';
      lines.push(
        r.t + '\t' + r.alpha.toFixed(2) + '\t' + r.beta.toFixed(2)
        + '\t' + r.gamma.toFixed(2) + '\t' + da + '\t' + db + '\t' + dg
      );
      prev = r;
    });
    oriRecordLog.value = lines.join('\n');
    oriRecordLog.classList.remove('hidden');
    oriRecordCopy.classList.remove('hidden');
    oriRecordClear.classList.remove('hidden');
  }

  if (oriRecordBtn) {
    oriRecordBtn.addEventListener('click', function () {
      if (isRecording) stopRecording();
      else startRecording();
    });
  }
  if (oriRecordCopy) {
    oriRecordCopy.addEventListener('click', function () {
      navigator.clipboard.writeText(oriRecordLog.value);
      oriRecordCopy.textContent = '✓ Copiado!';
      setTimeout(function () { oriRecordCopy.textContent = '📋 Copiar log'; }, 1500);
    });
  }
  if (oriRecordClear) {
    oriRecordClear.addEventListener('click', function () {
      recordedData = [];
      oriRecordLog.value = '';
      oriRecordLog.classList.add('hidden');
      oriRecordCopy.classList.add('hidden');
      oriRecordClear.classList.add('hidden');
      if (oriRecordCount) oriRecordCount.textContent = '';
    });
  }

  async function mirrorRemoteSensor() {
    if (modalOrientation.classList.contains('hidden')) {
      if (isMirroringRemote) {
        isMirroringRemote = false;
        if (phone3dMirrorBadge) phone3dMirrorBadge.classList.add('hidden');
      }
      return;
    }
    try {
      const r = await fetch('http://127.0.0.1:3477/location?tab=' + encodeURIComponent(activeTabId));
      const d = await r.json();
      if (!d || !d.orientation || !d.orientation.ts) return;
      const freshMs = Date.now() - d.orientation.ts;
      const isLive = freshMs < 2000;
      if (isLive) {
        if (!isMirroringRemote) {
          isMirroringRemote = true;
          resetMirrorCumulatives();  // comeca do zero no primeiro frame live
          if (phone3dMirrorBadge) phone3dMirrorBadge.classList.remove('hidden');
        }
        const o = d.orientation;
        // Aplica no visual via unwrap pra evitar flicks em 359->0
        applyMirrored3D(o.alpha, o.beta, o.gamma);
        // Display dos valores NO RANGE ORIGINAL (nao cumulativo)
        if (oriAlphaVal) oriAlphaVal.textContent = alphaToSlider(o.alpha).toFixed(0) + '°';
        if (oriBetaVal) oriBetaVal.textContent = o.beta.toFixed(0) + '°';
        if (oriGammaVal) oriGammaVal.textContent = o.gamma.toFixed(0) + '°';
        // Grava tick se gravacao ativa
        recordTick(o.alpha, o.beta, o.gamma);
      } else {
        if (isMirroringRemote) {
          isMirroringRemote = false;
          if (phone3dMirrorBadge) phone3dMirrorBadge.classList.add('hidden');
          resetMirrorCumulatives();
          applyOrientationToUI();  // volta aos valores manuais
        }
      }
    } catch (e) {}
  }
  setInterval(mirrorRemoteSensor, 100);  // 10Hz pra ficar fluido

  btnOrientation.addEventListener('click', openOrientationModal);
  document.getElementById('modal-ori-close').addEventListener('click', closeOrientationModal);
  modalOrientation.addEventListener('click', function (e) {
    if (e.target === modalOrientation) closeOrientationModal();
  });

  document.getElementById('modal-ori-reset').addEventListener('click', function () {
    orientationState = Object.assign({}, DEFAULT_ORIENTATION);
    applyOrientationToUI();
    saveOrientationState();
  });

  // Sliders
  oriAlpha.addEventListener('input', function (e) {
    // Slider range: -180..180. Converte pro interno 0..360 (W3C).
    orientationState.alpha = sliderToAlpha(parseFloat(e.target.value) || 0);
    if (orientationState.alphaFromHeading) {
      // Se usuario mexe no slider manualmente, desacopla
      orientationState.alphaFromHeading = false;
      oriAlphaFromHeading.checked = false;
    }
    applyOrientationToUI();
    saveOrientationState();
  });
  oriBeta.addEventListener('input', function (e) {
    orientationState.beta = parseFloat(e.target.value) || 0;
    applyOrientationToUI();
    saveOrientationState();
  });
  oriGamma.addEventListener('input', function (e) {
    orientationState.gamma = parseFloat(e.target.value) || 0;
    applyOrientationToUI();
    saveOrientationState();
  });
  oriAlphaFromHeading.addEventListener('change', function (e) {
    orientationState.alphaFromHeading = e.target.checked;
    saveOrientationState();
  });

  // Drag do celular 3D: dy -> beta, dx -> gamma, Shift+drag -> alpha
  let oriDrag = { active: false, x0: 0, y0: 0, a0: 0, b0: 0, g0: 0 };
  phone3d.addEventListener('mousedown', function (e) {
    oriDrag.active = true;
    oriDrag.x0 = e.clientX;
    oriDrag.y0 = e.clientY;
    oriDrag.a0 = orientationState.alpha;
    oriDrag.b0 = orientationState.beta;
    oriDrag.g0 = orientationState.gamma;
    phone3d.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', function (e) {
    if (!oriDrag.active) return;
    const dx = e.clientX - oriDrag.x0;
    const dy = e.clientY - oriDrag.y0;
    if (e.shiftKey) {
      // Shift: rotate alpha (sensibilidade suave)
      let a = (oriDrag.a0 + dx * 0.1) % 360;
      if (a < 0) a += 360;
      orientationState.alpha = a;
      if (orientationState.alphaFromHeading) {
        orientationState.alphaFromHeading = false;
        oriAlphaFromHeading.checked = false;
      }
    } else {
      // Normal: dy invertido -> beta (arrastar pra cima = topo pra frente),
      //         dx -> gamma. Sensibilidade suave pra ajuste fino.
      orientationState.beta = Math.max(-180, Math.min(180, oriDrag.b0 - dy * 0.12));
      orientationState.gamma = Math.max(-90, Math.min(90, oriDrag.g0 + dx * 0.08));
    }
    applyOrientationToUI();
  });
  window.addEventListener('mouseup', function () {
    if (oriDrag.active) {
      oriDrag.active = false;
      phone3d.classList.remove('dragging');
      saveOrientationState();
    }
  });

  // --- Velocimetro visual ---
  // Cor progressiva: < 60% max = verde (default), 60-90% = amarelo, > 90% = vermelho
  function updateSpeedometer(speedKmh) {
    const max = parseFloat(speedSlider.value) || 1;
    const ratio = speedKmh / max;
    speedoValue.textContent = speedKmh.toFixed(1);
    speedoValue.classList.remove('mid', 'high');
    if (ratio >= 0.9) speedoValue.classList.add('high');
    else if (ratio >= 0.6) speedoValue.classList.add('mid');
    speedoMax.textContent = 'max ' + max.toFixed(0);
  }
  updateSpeedometer(0);

  // Formato ETA: "~45s", "3min 12s", "1h 23min". NUNCA retorna string vazia.
  function formatETA(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    if (seconds < 1) return 'chegando';
    if (seconds < 60) return '~' + Math.round(seconds) + 's';
    const totalSec = Math.round(seconds);
    if (totalSec < 3600) {
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return min + 'min ' + (sec < 10 ? '0' + sec : sec) + 's';
    }
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return h + 'h ' + (m < 10 ? '0' + m : m) + 'min';
  }

  // Atualiza ETA baseado na distancia restante do autopilot + velocidade max do preset.
  // Defensivo: valida refs, loga valores anomalos se window.__fakegps_eta_debug = true.
  function updateETA(currentLat, currentLon) {
    if (!speedoEta) return;
    const active = AutoPilot && typeof AutoPilot.isActive === 'function' && AutoPilot.isActive();
    if (!active) {
      speedoEta.textContent = '⏱ --:--';
      speedoEta.classList.remove('active');
      return;
    }
    let remainingMeters = 0;
    if (typeof AutoPilot.getRemainingDistanceMeters === 'function') {
      remainingMeters = AutoPilot.getRemainingDistanceMeters(currentLat, currentLon);
    }
    const maxKmh = parseFloat(speedSlider.value) || 1;
    const etaSeconds = maxKmh > 0 ? (remainingMeters / 1000) / maxKmh * 3600 : 0;
    const formatted = formatETA(etaSeconds);
    speedoEta.textContent = '⏱ ' + (formatted || '--:--');
    speedoEta.classList.add('active');
    if (window.__fakegps_eta_debug) {
      console.log('[ETA]', { active, remainingMeters, maxKmh, etaSeconds, formatted });
    }
  }

  // --- Humanidade: provider ---
  Humanity.setIsMovingProvider(function () {
    return Movement.getRaw().speedMps > 0.3;
  });

  // --- Dispatcher: ⚙ dos presets abre modal correto ---
  function openPresetConfig(preset) {
    if (preset.kind === 'walk' || preset.kind === 'run') {
      openSettings(preset);
    } else if (preset.kind === 'car') {
      openCarConfig();
    } else {
      openGenericPresetModal();
    }
  }

  // Modal generico pra preset custom
  const modalGeneric = document.getElementById('modal-preset-generic');
  function openGenericPresetModal() { modalGeneric.classList.remove('hidden'); }
  function closeGenericPresetModal() { modalGeneric.classList.add('hidden'); }
  document.getElementById('modal-preset-generic-ok').addEventListener('click', closeGenericPresetModal);
  modalGeneric.addEventListener('click', function (e) {
    if (e.target === modalGeneric) closeGenericPresetModal();
  });

  // --- Modal de configuracoes de Humanidade (abre via ⚙ Walk/Run) ---
  const modalSettings = document.getElementById('modal-settings');
  const modalSettingsTitle = document.getElementById('modal-settings-title');
  const cfgHumanityEnabled = document.getElementById('cfg-humanityEnabled');
  const modalSettingsError = document.getElementById('modal-settings-error');
  const cfgFields = {
    checkIntervalMinMs: document.getElementById('cfg-checkIntervalMin'),
    checkIntervalMaxMs: document.getElementById('cfg-checkIntervalMax'),
    trafficStopChance: document.getElementById('cfg-trafficStopChance'),
    trafficStopMinMs: document.getElementById('cfg-trafficStopMin'),
    trafficStopMaxMs: document.getElementById('cfg-trafficStopMax'),
    microPauseChance: document.getElementById('cfg-microPauseChance'),
    microPauseMinMs: document.getElementById('cfg-microPauseMin'),
    microPauseMaxMs: document.getElementById('cfg-microPauseMax')
  };

  function fillSettingsForm() {
    const cfg = Humanity.getConfig();
    cfgHumanityEnabled.checked = Humanity.isEnabled();
    cfgFields.checkIntervalMinMs.value = (cfg.checkIntervalMinMs / 1000).toFixed(0);
    cfgFields.checkIntervalMaxMs.value = (cfg.checkIntervalMaxMs / 1000).toFixed(0);
    cfgFields.trafficStopChance.value = (cfg.trafficStopChance * 100).toFixed(0);
    cfgFields.trafficStopMinMs.value = (cfg.trafficStopMinMs / 1000).toFixed(0);
    cfgFields.trafficStopMaxMs.value = (cfg.trafficStopMaxMs / 1000).toFixed(0);
    cfgFields.microPauseChance.value = (cfg.microPauseChance * 100).toFixed(0);
    cfgFields.microPauseMinMs.value = (cfg.microPauseMinMs / 1000).toFixed(1);
    cfgFields.microPauseMaxMs.value = (cfg.microPauseMaxMs / 1000).toFixed(1);
  }

  function openSettings(preset) {
    fillSettingsForm();
    if (preset) {
      modalSettingsTitle.textContent = '⚙️ Humanidade - ' + preset.emoji + ' ' + preset.name;
    } else {
      modalSettingsTitle.textContent = '⚙️ Humanidade (pedestre)';
    }
    modalSettingsError.classList.add('hidden');
    modalSettings.classList.remove('hidden');
  }

  function closeSettings() { modalSettings.classList.add('hidden'); }

  function saveSettings() {
    const patch = {
      checkIntervalMinMs: parseFloat(cfgFields.checkIntervalMinMs.value) * 1000,
      checkIntervalMaxMs: parseFloat(cfgFields.checkIntervalMaxMs.value) * 1000,
      trafficStopChance: parseFloat(cfgFields.trafficStopChance.value) / 100,
      trafficStopMinMs: parseFloat(cfgFields.trafficStopMinMs.value) * 1000,
      trafficStopMaxMs: parseFloat(cfgFields.trafficStopMaxMs.value) * 1000,
      microPauseChance: parseFloat(cfgFields.microPauseChance.value) / 100,
      microPauseMinMs: parseFloat(cfgFields.microPauseMinMs.value) * 1000,
      microPauseMaxMs: parseFloat(cfgFields.microPauseMaxMs.value) * 1000
    };
    const ok = Humanity.setConfig(patch);
    if (!ok) {
      modalSettingsError.textContent = 'Valores invalidos. Verifique: min <= max, chances entre 0 e 100%, numeros positivos.';
      modalSettingsError.classList.remove('hidden');
      return;
    }
    // Aplica toggle de habilitado/desabilitado
    if (cfgHumanityEnabled.checked) Humanity.enable();
    else Humanity.disable();
    saveNow();
    closeSettings();
  }

  function resetSettings() {
    Humanity.resetConfig();
    fillSettingsForm();
    modalSettingsError.classList.add('hidden');
  }

  document.getElementById('modal-settings-cancel').addEventListener('click', closeSettings);
  document.getElementById('modal-settings-save').addEventListener('click', saveSettings);
  document.getElementById('modal-settings-reset').addEventListener('click', resetSettings);
  modalSettings.addEventListener('click', function (e) {
    if (e.target === modalSettings) closeSettings();
  });
  document.addEventListener('keydown', function (e) {
    if (!modalSettings.classList.contains('hidden') && e.key === 'Escape') closeSettings();
  });

  // --- Modal de configuracoes do Carro (abre via ⚙ do preset Carro) ---
  const modalCar = document.getElementById('modal-car');
  const modalCarError = document.getElementById('modal-car-error');
  const carFields = {
    accelSeconds: document.getElementById('car-accelSeconds'),
    approachMeters: document.getElementById('car-approachMeters'),
    trafficStopChance: document.getElementById('car-trafficStopChance'),
    trafficStopMinMs: document.getElementById('car-trafficStopMin'),
    trafficStopMaxMs: document.getElementById('car-trafficStopMax')
  };

  function fillCarForm() {
    const c = CarConfig.getConfig();
    carFields.accelSeconds.value = c.accelSeconds.toFixed(1);
    carFields.approachMeters.value = c.approachMeters.toFixed(0);
    carFields.trafficStopChance.value = (c.trafficStopChance * 100).toFixed(0);
    carFields.trafficStopMinMs.value = (c.trafficStopMinMs / 1000).toFixed(0);
    carFields.trafficStopMaxMs.value = (c.trafficStopMaxMs / 1000).toFixed(0);
  }
  function openCarConfig() {
    fillCarForm();
    modalCarError.classList.add('hidden');
    modalCar.classList.remove('hidden');
  }
  function closeCarConfig() { modalCar.classList.add('hidden'); }
  function saveCarConfig() {
    const patch = {
      accelSeconds: parseFloat(carFields.accelSeconds.value),
      approachMeters: parseFloat(carFields.approachMeters.value),
      trafficStopChance: parseFloat(carFields.trafficStopChance.value) / 100,
      trafficStopMinMs: parseFloat(carFields.trafficStopMinMs.value) * 1000,
      trafficStopMaxMs: parseFloat(carFields.trafficStopMaxMs.value) * 1000
    };
    const ok = CarConfig.setConfig(patch);
    if (!ok) {
      modalCarError.textContent = 'Valores invalidos. Verifique: aceleracao 0.1-30, chance 0-100%, min <= max.';
      modalCarError.classList.remove('hidden');
      return;
    }
    closeCarConfig();
  }
  document.getElementById('modal-car-cancel').addEventListener('click', closeCarConfig);
  document.getElementById('modal-car-save').addEventListener('click', saveCarConfig);
  document.getElementById('modal-car-reset').addEventListener('click', function () {
    CarConfig.resetConfig();
    fillCarForm();
    modalCarError.classList.add('hidden');
  });
  modalCar.addEventListener('click', function (e) {
    if (e.target === modalCar) closeCarConfig();
  });
  document.addEventListener('keydown', function (e) {
    if (!modalCar.classList.contains('hidden') && e.key === 'Escape') closeCarConfig();
  });

  // --- Barra indicadora de pausa (motivo + countdown) ---
  const pauseBar = document.getElementById('pause-bar');
  const pauseIcon = document.getElementById('pause-icon');
  const pauseText = document.getElementById('pause-text');
  const pauseCountdown = document.getElementById('pause-countdown');

  function formatCountdown(ms) {
    const total = Math.ceil(ms / 1000);
    const mm = Math.floor(total / 60).toString().padStart(2, '0');
    const ss = (total % 60).toString().padStart(2, '0');
    return mm + ':' + ss;
  }

  function updatePauseBar() {
    if (isPaused) {
      pauseBar.classList.remove('hidden');
      pauseIcon.textContent = '⏸';
      pauseText.textContent = 'Pausado manualmente';
      pauseCountdown.textContent = '--:--';
      return;
    }
    if (Humanity.isSimulatedPaused()) {
      const type = Humanity.currentPauseType();
      pauseBar.classList.remove('hidden');
      if (type === 'traffic') {
        pauseIcon.textContent = '🚦';
        pauseText.textContent = 'Esperando sinal / cruzamento';
      } else {
        pauseIcon.textContent = '⏱';
        pauseText.textContent = 'Micropausa (olhando celular)';
      }
      pauseCountdown.textContent = formatCountdown(Humanity.remainingMs());
      return;
    }
    pauseBar.classList.add('hidden');
  }

  // Atualiza a barra a 2Hz (suficiente pro countdown de segundos)
  setInterval(updatePauseBar, 500);

  // Provider pro map saber se mostra ou esconde o botao de teleport no popup
  Map.setTeleportLockProvider(function () { return teleportLocked; });

  // --- Teleporte via click no mapa ---
  Map.onAction('teleport', function (lat, lon) {
    if (!isTeleportAllowed()) {
      console.warn('[Fake GPS PC] teleporte bloqueado (cadeado trancado)');
      return;
    }
    // Cancela auto-walk se tiver ativo (teleporte invalida a rota)
    if (AutoPilot.isActive()) {
      AutoPilot.stop();
      Map.clearRoute();
      btnCancelRoute.classList.add('hidden');
    }
    Movement.teleport(lat, lon);
    saveNow();
    // Re-trava imediatamente apos usar (defesa extra)
    lockTeleportNow();
    console.log('[Fake GPS PC] teleportado para', lat.toFixed(6), lon.toFixed(6));
  });

  // --- Rota automatica (OSRM foot) ---
  Map.onAction('route', async function (lat, lon) {
    // Cancela rota anterior se tiver
    if (AutoPilot.isActive()) {
      AutoPilot.stop();
      Map.clearRoute();
    }
    const pos = Movement.getRaw();
    try {
      console.log('[AutoPilot] buscando rota a pe...');
      const route = await Routing.fetchFootRoute(pos.lat, pos.lon, lat, lon);
      Map.drawRoute(route.waypoints);
      const started = AutoPilot.start(route.waypoints, {
        onComplete: function () {
          console.log('[AutoPilot] chegou no destino');
          Map.clearRoute();
          btnCancelRoute.classList.add('hidden');
          saveNow();
        },
        onProgress: function (current, total) {
          // Log a cada 10 waypoints
          if (current % 10 === 0) console.log('[AutoPilot] ' + current + '/' + total);
        }
      });
      if (started) {
        btnCancelRoute.classList.remove('hidden');
        const km = (route.distanceMeters / 1000).toFixed(2);
        const min = Math.round(route.durationSeconds / 60);
        console.log('[AutoPilot] rota de ' + route.waypoints.length + ' pontos (' + km + ' km, ~' + min + ' min)');
      }
    } catch (err) {
      console.error('[AutoPilot] erro:', err.message);
      alert('Nao foi possivel calcular a rota: ' + err.message);
    }
  });

  btnCancelRoute.addEventListener('click', function () {
    AutoPilot.stop();
    Map.clearRoute();
    btnCancelRoute.classList.add('hidden');
    console.log('[AutoPilot] rota cancelada pelo usuario');
  });

  // --- Crates: recebe lista do servidor local (via extension) e renderiza no mapa ---
  async function routeToCrate(crate) {
    if (AutoPilot.isActive()) {
      AutoPilot.stop();
      Map.clearRoute();
    }
    const pos = Movement.getRaw();
    try {
      console.log('[Crates] rota ate crate', crate.id);
      const route = await Routing.fetchFootRoute(pos.lat, pos.lon, crate.lat, crate.lon);
      Map.drawRoute(route.waypoints);
      AutoPilot.start(route.waypoints, {
        onComplete: function () {
          console.log('[Crates] chegou na crate', crate.id);
          Map.clearRoute();
          btnCancelRoute.classList.add('hidden');
          saveNow();
        }
      });
      btnCancelRoute.classList.remove('hidden');
      const km = (route.distanceMeters / 1000).toFixed(2);
      console.log('[Crates] rota de ' + route.waypoints.length + ' pontos (' + km + ' km)');
    } catch (err) {
      console.error('[Crates] erro:', err.message);
      alert('Nao foi possivel calcular a rota ate a crate: ' + err.message);
    }
  }

  Map.onCrateAction(function (crate) {
    routeToCrate(crate);
  });

  // Toggle da rota planejada (adicionar/remover crate)
  Map.setPlannedRouteChecker(function (crateId) {
    return RoutePlanner.indexOf(crateId);
  });
  Map.onCrateToggleRoute(function (crate) {
    RoutePlanner.toggle({
      id: crate.id,
      lat: crate.lat,
      lon: crate.lon,
      label: crate.id.substring(0, 20)
    });
  });

  // --- Pontos custom na rota (click no mapa → ➕ Adicionar a rota) ---
  const CUSTOM_PREFIX = 'custom:';
  function isCustomStop(id) { return typeof id === 'string' && id.indexOf(CUSTOM_PREFIX) === 0; }

  Map.onAction('add-to-route', function (lat, lon) {
    const id = CUSTOM_PREFIX + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    RoutePlanner.add({ id: id, lat: lat, lon: lon, label: '' });
  });

  Map.onCustomPinRemove(function (id) {
    RoutePlanner.remove(id);
  });

  // Re-renderiza os pins azuis sempre que a rota muda (ordem/add/remove)
  function syncCustomPins() {
    const stops = RoutePlanner.all();
    const list = [];
    stops.forEach(function (s, idx) {
      if (isCustomStop(s.id)) {
        list.push({ id: s.id, lat: s.lat, lon: s.lon, routeIndex: idx });
      }
    });
    Map.renderCustomPins(list);
  }

  if (window.FakeGPSBridge && typeof window.FakeGPSBridge.onCrates === 'function') {
    window.FakeGPSBridge.onCrates(function (payload) {
      if (!payload || !Array.isArray(payload.crates)) return;
      Crates.update(payload.crates);
      Map.renderCrates(Crates.all());
      console.log('[Crates] ' + Crates.count() + ' crates recebidas (' + Crates.available().length + ' disponiveis)');
    });
  }

  // --- Planejador de rota multi-stop ---
  const panelRoutePlanner = document.getElementById('route-planner-panel');
  const routePlannerCountEl = document.getElementById('route-planner-count');
  const routePlannerDistEl = document.getElementById('route-planner-dist');
  const routePlannerListEl = document.getElementById('route-planner-list');
  const btnRouteStart = document.getElementById('btn-route-start');
  const btnRouteClear = document.getElementById('btn-route-clear');

  let plannedRouteData = null; // { waypoints, distanceMeters, ... } ou null

  function formatETA(meters, kmh) {
    if (!meters || !kmh || kmh <= 0) return '';
    const seconds = (meters / 1000) / kmh * 3600;
    if (seconds < 60) return '~' + Math.round(seconds) + 's';
    const totalMin = Math.round(seconds / 60);
    if (totalMin < 60) return '~' + totalMin + ' min';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return '~' + h + 'h ' + m + 'min';
  }

  function updateRouteStartButton() {
    const active = AutoPilot.isActive();
    if (active) {
      btnRouteStart.textContent = '⏸ Parar rota';
      btnRouteStart.classList.remove('route-planner-btn-primary');
      btnRouteStart.classList.add('route-planner-btn-danger');
    } else {
      btnRouteStart.textContent = '▶ Iniciar';
      btnRouteStart.classList.remove('route-planner-btn-danger');
      btnRouteStart.classList.add('route-planner-btn-primary');
    }
  }

  function renderRoutePlannerList() {
    const stops = RoutePlanner.all();
    if (stops.length === 0) {
      panelRoutePlanner.classList.add('hidden');
      Map.renderCrates(Crates.all()); // re-render crates sem numeracao
      Map.clearPlannedRoute();
      return;
    }
    panelRoutePlanner.classList.remove('hidden');
    const totalKm = plannedRouteData && plannedRouteData.distanceMeters
      ? (plannedRouteData.distanceMeters / 1000).toFixed(2) + ' km'
      : '';
    const speedKmh = parseFloat(speedSlider.value) || 5;
    const etaStr = plannedRouteData && plannedRouteData.distanceMeters
      ? formatETA(plannedRouteData.distanceMeters, speedKmh)
      : '';
    routePlannerCountEl.textContent = stops.length + ' stop' + (stops.length === 1 ? '' : 's');
    routePlannerDistEl.innerHTML = totalKm
      ? '· ' + totalKm + ' <span class="route-planner-eta">· ' + etaStr + '</span>'
      : '';

    routePlannerListEl.innerHTML = '';
    stops.forEach(function (s, idx) {
      const pos = Movement.getRaw();
      const prev = idx === 0 ? { lat: pos.lat, lon: pos.lon } : stops[idx - 1];
      const segDist = Crates.distanceMeters(prev.lat, prev.lon, s.lat, s.lon);

      const row = document.createElement('div');
      row.className = 'route-planner-item';
      row.setAttribute('draggable', 'true');
      row.dataset.stopId = s.id;
      const isCustom = isCustomStop(s.id);
      // Numeracao de pontos custom e automatica: posicao sequencial entre custom stops
      let customNumber = 0;
      if (isCustom) {
        for (let k = 0; k <= idx; k++) if (isCustomStop(stops[k].id)) customNumber++;
      }
      const emoji = isCustom ? '📍' : '📦';
      const displayLabel = isCustom ? 'Ponto ' + customNumber : escapeHtml(s.label);
      const titleAttr = isCustom
        ? s.lat.toFixed(5) + ', ' + s.lon.toFixed(5)
        : escapeHtml(s.id);
      row.innerHTML = [
        '<span class="route-planner-idx">', idx + 1, '</span>',
        '<span class="route-planner-label" title="', titleAttr, '">', emoji, ' ', displayLabel, '</span>',
        '<span class="route-planner-item-dist">', Math.round(segDist), 'm</span>',
        '<button class="route-planner-item-btn" data-action="up" ', (idx === 0 ? 'disabled' : ''), ' title="Subir">↑</button>',
        '<button class="route-planner-item-btn" data-action="down" ', (idx === stops.length - 1 ? 'disabled' : ''), ' title="Descer">↓</button>',
        '<button class="route-planner-item-btn delete" data-action="remove" title="Remover">✕</button>'
      ].join('');
      row.querySelector('[data-action="up"]').addEventListener('click', function () { RoutePlanner.move(s.id, -1); });
      row.querySelector('[data-action="down"]').addEventListener('click', function () { RoutePlanner.move(s.id, +1); });
      row.querySelector('[data-action="remove"]').addEventListener('click', function () { RoutePlanner.remove(s.id); });

      // Drag & drop handlers
      row.addEventListener('dragstart', function (e) {
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id);
      });
      row.addEventListener('dragend', function () {
        row.classList.remove('dragging');
        routePlannerListEl.querySelectorAll('.route-planner-item').forEach(function (el) {
          el.classList.remove('drag-over');
        });
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('drag-over');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === s.id) return;
        // Reinsere o dragged na posicao do item alvo
        const fromIdx = RoutePlanner.indexOf(draggedId);
        const toIdx = RoutePlanner.indexOf(s.id);
        if (fromIdx < 0 || toIdx < 0) return;
        const delta = toIdx - fromIdx;
        const step = Math.sign(delta);
        for (let i = 0; i < Math.abs(delta); i++) {
          RoutePlanner.move(draggedId, step);
        }
      });

      routePlannerListEl.appendChild(row);
    });

    btnRouteStart.disabled = stops.length < 1;
    updateRouteStartButton();
  }

  async function recalcPlannedRoute() {
    const stops = RoutePlanner.all();
    if (stops.length === 0) {
      plannedRouteData = null;
      Map.clearPlannedRoute();
      Map.renderCrates(Crates.all());
      renderRoutePlannerList();
      return;
    }
    const origin = Movement.getRaw();
    // Pontos: posicao atual -> cada crate em ordem
    const points = [{ lat: origin.lat, lon: origin.lon }].concat(stops.map(function (s) {
      return { lat: s.lat, lon: s.lon };
    }));
    try {
      const route = await Routing.fetchMultiFootRoute(points);
      plannedRouteData = route;
      Map.drawPlannedRoute(route.waypoints);
    } catch (err) {
      console.warn('[RoutePlanner] falha ao calcular rota:', err.message);
      plannedRouteData = null;
      Map.clearPlannedRoute();
    }
    // Re-render crates com numeracao da rota + lista
    Map.renderCrates(Crates.all());
    renderRoutePlannerList();
  }

  RoutePlanner.onChange(function () {
    recalcPlannedRoute();
    syncCustomPins();
  });
  syncCustomPins(); // sync inicial (caso tenha pontos custom persistidos)

  btnRouteClear.addEventListener('click', function () {
    RoutePlanner.clear();
  });

  btnRouteStart.addEventListener('click', async function () {
    // Se autopilot ativo, botao vira "parar"
    if (AutoPilot.isActive()) {
      AutoPilot.stop();
      Map.clearRoute();
      btnCancelRoute.classList.add('hidden');
      // Rota amarela/preta ja esta visivel (nao e removida ao iniciar)
      updateRouteStartButton();
      renderRoutePlannerList();
      return;
    }

    const stops = RoutePlanner.all();
    if (stops.length === 0) return;
    if (!plannedRouteData || !plannedRouteData.waypoints) {
      alert('Rota ainda nao calculada. Espera uns segundos.');
      return;
    }
    Map.drawRoute(plannedRouteData.waypoints);
    // Rota amarela/preta permanece visivel durante autopilot (sobrepoe com a azul pontilhada)
    const started = AutoPilot.start(plannedRouteData.waypoints, {
      onComplete: function () {
        console.log('[RoutePlanner] rota multi-stop concluida');
        Map.clearRoute();
        btnCancelRoute.classList.add('hidden');
        RoutePlanner.clear();
        updateRouteStartButton();
        saveNow();
      }
    });
    if (started) {
      btnCancelRoute.classList.remove('hidden');
      const km = (plannedRouteData.distanceMeters / 1000).toFixed(2);
      console.log('[RoutePlanner] iniciada: ' + stops.length + ' stops · ' + km + ' km');
      updateRouteStartButton();
    }
  });

  // ETA recalcula quando velocidade muda
  speedSlider.addEventListener('input', function () { renderRoutePlannerList(); });

  // Render inicial (caso tenha rota salva no storage)
  recalcPlannedRoute();

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function updatePauseUI() {
    btnPause.classList.toggle('paused', isPaused);
    btnPause.textContent = isPaused ? '▶ Retomar GPS' : '⏸ Congelar GPS';
    statusIndicator.classList.toggle('paused', isPaused);
    statusIndicator.textContent = isPaused ? '📍 CONGELADO' : 'ATIVO';
    btnPause.title = isPaused
      ? 'GPS congelado - extension recebe mesma loc fixa. Click pra retomar.'
      : 'Congela a loc enviada pra extension. Sensor remoto continua funcionando normal.';
  }

  // --- Main loop (requestAnimationFrame ~60fps) ---
  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    // Prioridade de input: autopilot > joystick/teclado. Pausa zera tudo.
    const currentPos = Movement.getRaw();
    const autoInput = AutoPilot.computeInput(currentPos.lat, currentPos.lon);
    const rawInput = autoInput || Input.getInput();
    const humanityPaused = Humanity.isSimulatedPaused();
    const input = (isPaused || humanityPaused)
      ? { x: 0, y: 0, magnitude: 0, heading: rawInput.heading }
      : rawInput;

    Movement.update(dt, input);
    const pos = Movement.getRaw();

    Map.setPosition(pos.lat, pos.lon, pos.heading);

    latEl.textContent = pos.lat.toFixed(6);
    lonEl.textContent = pos.lon.toFixed(6);
    headEl.textContent = pos.heading.toFixed(0) + '°';
    updateSpeedometer(pos.speedKmh);
    updateETA(pos.lat, pos.lon);

    // Status visual: prioridade = PAUSADO manual > humanity pause > ATIVO
    if (isPaused) {
      // Ja setado pelo updatePauseUI
    } else if (humanityPaused) {
      const type = Humanity.currentPauseType();
      const label = type === 'traffic' ? '🚦 SINAL' : '⏱ PAUSA';
      if (statusIndicator.textContent !== label) {
        statusIndicator.textContent = label;
        statusIndicator.classList.add('paused');
      }
    } else {
      if (statusIndicator.textContent !== 'ATIVO') {
        statusIndicator.textContent = 'ATIVO';
        statusIndicator.classList.remove('paused');
      }
    }


    // Mapa NAO centraliza automaticamente - apenas quando o usuario clica em "Centralizar".
    // (Antes v0.1.7.1 centralizava durante autopilot; removido a pedido.)

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // --- Autosave: salva posicao a cada 5s + no fechamento ---
  function saveNow() {
    const pos = Movement.getRaw();
    Persistence.save({
      lat: pos.lat,
      lon: pos.lon,
      heading: pos.heading,
      activePresetId: activePresetId,
      maxSpeedKmh: parseFloat(speedSlider.value),
      paused: isPaused,
      humanityEnabled: Humanity.isEnabled()
    });
  }
  setInterval(saveNow, Persistence.AUTOSAVE_MS);
  window.addEventListener('beforeunload', saveNow);

  // --- Publica posicao pro servidor HTTP a 10Hz (100ms) ---
  // Se pausado: para de publicar location (server mantem ultima = loc congelada
  // pra extension). Orientation continua vindo via POST /orientation do sensor remoto.
  setInterval(function () {
    if (!window.FakeGPSBridge || !window.FakeGPSBridge.publishLocation) return;
    if (isPaused) return;
    const pos = Movement.getNoisy();
    // Alpha: se alphaFromHeading ligado, bussola segue heading do GPS (CW->CCW conversion).
    //        Senao, usa o valor manual do slider/drag.
    const rawHeading = Movement.getRaw().heading;
    const alpha = orientationState.alphaFromHeading
      ? ((360 - rawHeading) % 360 + 360) % 360
      : orientationState.alpha;
    window.FakeGPSBridge.publishLocation({
      tabId: activeTabId,  // alpha4: isola localizacao por aba no server
      lat: pos.lat,
      lon: pos.lon,
      heading: pos.heading,
      speedMps: pos.speedMps,
      accuracy: pos.accuracy,
      orientation: {
        alpha: alpha,
        beta: orientationState.beta,
        gamma: orientationState.gamma
      }
    });
  }, 100);

  // --- Modal sensor remoto (conexao GLOBAL - uma URL atende todas as abas) ---
  const modalRemoteSensor = document.getElementById('modal-remote-sensor');
  const btnRemoteSensor = document.getElementById('header-remote-sensor');
  const headerRsState = document.getElementById('rs-state');
  const remoteSensorUrlText = document.getElementById('remote-sensor-url-text');
  const remoteSensorStatus = document.getElementById('remote-sensor-status');
  const remoteSensorIps = document.getElementById('remote-sensor-ips');

  let cachedLocalIps = null;

  async function ensureLocalIps() {
    if (cachedLocalIps) return cachedLocalIps;
    if (window.FakeGPSBridge && window.FakeGPSBridge.getLocalIps) {
      cachedLocalIps = await window.FakeGPSBridge.getLocalIps();
    } else {
      cachedLocalIps = { port: 3477, httpsPort: null, ips: [] };
    }
    return cachedLocalIps;
  }

  function globalSensorUrl(info) {
    const ips = (info && info.ips) || [];
    if (ips.length === 0) return null;
    const primary = ips[0];
    const port = info.httpsPort || info.port;
    const proto = info.httpsPort ? 'https' : 'http';
    // Sem ?tab - server aplica globalmente em todas as abas
    return proto + '://' + primary.address + ':' + port + '/sensor';
  }

  async function renderRemoteSensorModal() {
    const info = await ensureLocalIps();
    const ips = (info && info.ips) || [];
    const url = globalSensorUrl(info);

    remoteSensorUrlText.textContent = url || '(nenhum IP LAN detectado)';
    if (ips.length === 0) {
      remoteSensorIps.textContent = 'nenhum IP LAN detectado';
    } else {
      remoteSensorIps.innerHTML = ips.map(function (ip) {
        return ip.address + ' <span style="color:var(--muted)">(' + ip.name + ')</span>';
      }).join(' · ');
    }
  }

  function openRemoteSensorModal() {
    modalRemoteSensor.classList.remove('hidden');
    renderRemoteSensorModal();
  }

  if (btnRemoteSensor) {
    btnRemoteSensor.addEventListener('click', openRemoteSensorModal);
    const closeBtn = document.getElementById('modal-remote-sensor-close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      modalRemoteSensor.classList.add('hidden');
    });
    modalRemoteSensor.addEventListener('click', function (e) {
      if (e.target === modalRemoteSensor) modalRemoteSensor.classList.add('hidden');
    });
  }

  // Polling: status global (basta UMA aba ter remoteActive - como e global, todas tem o mesmo ts)
  async function pollRemoteSensorStatus() {
    try {
      const r = await fetch('http://127.0.0.1:3477/tabs');
      const d = await r.json();
      const tabs = (d && d.tabs) || [];
      const anyActive = tabs.some(function (t) { return t.remoteActive; });

      if (headerRsState) {
        if (anyActive) {
          headerRsState.textContent = 'Ativo';
          btnRemoteSensor.classList.add('active');
        } else {
          headerRsState.textContent = 'Desativado';
          btnRemoteSensor.classList.remove('active');
        }
      }
      if (remoteSensorStatus) {
        if (anyActive) {
          remoteSensorStatus.textContent = '🟢 Conectado (recebendo)';
          remoteSensorStatus.classList.add('connected');
        } else {
          remoteSensorStatus.textContent = '⚪ Aguardando conexao';
          remoteSensorStatus.classList.remove('connected');
        }
      }
    } catch (e) {}
  }
  setInterval(pollRemoteSensorStatus, 500);

  // --- Tab bar (UI das abas - alpha2: s/ troca de contexto real) ---
  const tabBarEl = document.getElementById('tab-bar');

  function renderTabBar() {
    if (!tabBarEl) return;
    tabBarEl.innerHTML = '';
    const activeId = TabsManager.getActiveId();
    TabsManager.all().forEach(function (tab) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeId ? ' active' : '');
      el.dataset.tabId = tab.id;
      const hasProxy = tab.proxy && tab.proxy.ip;
      const proxyLabel = hasProxy
        ? 'Proxy: ' + tab.proxy.ip + (tab.proxy.port ? ':' + tab.proxy.port : '')
        : '';
      el.innerHTML = [
        '<span class="tab-dot"></span>',
        '<span class="tab-name" data-rename>', escapeHtml(tab.name), '</span>',
        hasProxy ? '<span class="tab-proxy-icon" title="' + escapeHtml(proxyLabel) + '">🌐</span>' : '',
        '<button class="tab-config-btn" title="Config da aba">⚙</button>',
        (TabsManager.all().length > 1
          ? '<button class="tab-close" title="Fechar aba">✕</button>'
          : '')
      ].join('');

      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('tab-close')) return;
        if (e.target.classList.contains('tab-config-btn')) return;
        if (e.target.hasAttribute('data-rename') && e.detail === 2) return;
        TabsManager.switchTo(tab.id);
      });

      const nameEl = el.querySelector('[data-rename]');
      nameEl.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        startRename(tab.id, nameEl);
      });

      const configBtn = el.querySelector('.tab-config-btn');
      if (configBtn) {
        configBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openTabConfig(tab.id);
        });
      }

      const closeBtn = el.querySelector('.tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (confirm('Fechar aba "' + tab.name + '"? Essa ação apaga o estado dela.')) {
            TabsManager.remove(tab.id);
          }
        });
      }

      tabBarEl.appendChild(el);
    });

    // Botao "+"
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add';
    addBtn.title = 'Nova aba';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', function () {
      const tab = TabsManager.create();
      TabsManager.switchTo(tab.id);
    });
    tabBarEl.appendChild(addBtn);
  }

  function startRename(tabId, nameEl) {
    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-name-input';
    input.value = currentName;
    input.maxLength = 20;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        TabsManager.rename(tabId, newName);
      } else {
        renderTabBar();
      }
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  // v0.1.14: publica lista de abas pro server (pra extension listar no dropdown)
  function syncTabsListToServer() {
    if (window.FakeGPSBridge && window.FakeGPSBridge.publishTabsList) {
      // Envia versao limpa (sem metadados internos)
      const tabs = TabsManager.all().map(function (t) {
        return {
          id: t.id,
          name: t.name,
          proxy: t.proxy ? { ip: t.proxy.ip, port: t.proxy.port } : null
        };
      });
      window.FakeGPSBridge.publishTabsList(tabs);
    }
  }

  TabsManager.on('change', function () { renderTabBar(); syncTabsListToServer(); });
  TabsManager.on('switch', function () {
    console.log('[Tabs] trocando pra', TabsManager.getActive() && TabsManager.getActive().name,
      '- recarregando contexto...');
    setTimeout(function () { window.location.reload(); }, 100);
  });
  renderTabBar();
  syncTabsListToServer();

  // --- Modal "Config da aba" (v0.1.14) ---
  const modalTabConfig = document.getElementById('modal-tab-config');
  const tabConfigName = document.getElementById('tab-config-name');
  const tabConfigRename = document.getElementById('tab-config-rename');
  const tabConfigProxyOneline = document.getElementById('tab-config-proxy-oneline');
  const tabConfigProxyIp = document.getElementById('tab-config-proxy-ip');
  const tabConfigProxyPort = document.getElementById('tab-config-proxy-port');
  const tabConfigProxyUser = document.getElementById('tab-config-proxy-user');
  const tabConfigProxyPass = document.getElementById('tab-config-proxy-pass');

  // Parse "IP:PORT:USER:PASS" (ou subset) nos campos individuais
  function parseProxyOneline() {
    const raw = (tabConfigProxyOneline.value || '').trim();
    if (!raw) return;
    const parts = raw.split(':');
    tabConfigProxyIp.value = parts[0] || '';
    tabConfigProxyPort.value = parts[1] || '';
    tabConfigProxyUser.value = parts[2] || '';
    // Senha pode conter ':' - junta tudo depois do 3o separador
    tabConfigProxyPass.value = parts.length > 3 ? parts.slice(3).join(':') : '';
  }
  if (tabConfigProxyOneline) {
    tabConfigProxyOneline.addEventListener('paste', function () {
      setTimeout(parseProxyOneline, 10);  // apos o paste terminar
    });
    const parseBtn = document.getElementById('tab-config-parse-proxy');
    if (parseBtn) parseBtn.addEventListener('click', parseProxyOneline);
  }
  const tabConfigLocationInfo = document.getElementById('tab-config-location-info');
  const tabConfigLocationText = document.getElementById('tab-config-location-text');
  const tabConfigError = document.getElementById('tab-config-error');
  let currentConfigTabId = null;

  function openTabConfig(tabId) {
    const tab = TabsManager.get(tabId);
    if (!tab) return;
    currentConfigTabId = tabId;
    tabConfigName.textContent = tab.name;
    tabConfigRename.value = tab.name;
    const proxy = tab.proxy || {};
    tabConfigProxyOneline.value = '';  // sempre vazio ao abrir (so pra COLAR novo)
    tabConfigProxyIp.value = proxy.ip || '';
    tabConfigProxyPort.value = proxy.port || '';
    tabConfigProxyUser.value = proxy.user || '';
    tabConfigProxyPass.value = proxy.password || '';
    if (proxy.lat != null && proxy.lon != null) {
      tabConfigLocationText.textContent = (proxy.locationLabel || 'coord')
        + ' (' + proxy.lat.toFixed(4) + ', ' + proxy.lon.toFixed(4) + ')';
      tabConfigLocationInfo.classList.remove('hidden');
    } else {
      tabConfigLocationInfo.classList.add('hidden');
    }
    tabConfigError.classList.add('hidden');
    modalTabConfig.classList.remove('hidden');
  }

  function closeTabConfig() {
    const tab = TabsManager.get(currentConfigTabId);
    if (!tab) { modalTabConfig.classList.add('hidden'); return; }
    const newName = tabConfigRename.value.trim().slice(0, 20);
    if (newName && newName !== tab.name) TabsManager.rename(tab.id, newName);
    const ip = tabConfigProxyIp.value.trim();
    const port = tabConfigProxyPort.value.trim();
    const user = tabConfigProxyUser.value;
    const password = tabConfigProxyPass.value;
    if (ip) {
      const prev = tab.proxy && tab.proxy.ip === ip ? tab.proxy : {};
      TabsManager.updateProxy(tab.id, {
        ip: ip, port: port, user: user, password: password,
        lat: prev.lat, lon: prev.lon,
        locationLabel: prev.locationLabel,
        locatedAt: prev.locatedAt
      });
    } else {
      TabsManager.updateProxy(tab.id, null);
    }
    modalTabConfig.classList.add('hidden');
  }

  async function locateProxyAndTeleport() {
    const ip = tabConfigProxyIp.value.trim();
    if (!ip) {
      tabConfigError.textContent = 'Preenche o IP da proxy primeiro.';
      tabConfigError.classList.remove('hidden');
      return;
    }
    tabConfigError.textContent = 'Localizando...';
    tabConfigError.classList.remove('hidden');
    try {
      // ipwho.is - HTTPS gratis, nao precisa auth, retorna lat/lon
      const r = await fetch('https://ipwho.is/' + encodeURIComponent(ip));
      const data = await r.json();
      if (!data.success) {
        tabConfigError.textContent = 'Falha: ' + (data.message || 'IP invalido');
        return;
      }
      const label = [data.city, data.region, data.country].filter(Boolean).join(', ');
      tabConfigLocationText.textContent = label + ' (' + data.latitude.toFixed(4) + ', ' + data.longitude.toFixed(4) + ')';
      tabConfigLocationInfo.classList.remove('hidden');
      tabConfigError.classList.add('hidden');

      const port = tabConfigProxyPort.value.trim();
      const user = tabConfigProxyUser.value;
      const password = tabConfigProxyPass.value;
      TabsManager.updateProxy(currentConfigTabId, {
        ip: ip, port: port, user: user, password: password,
        lat: data.latitude, lon: data.longitude,
        locationLabel: label, locatedAt: Date.now()
      });

      // Se a aba configurada e a ativa, teleporta agora
      if (currentConfigTabId === TabsManager.getActiveId()) {
        Movement.teleport(data.latitude, data.longitude);
        Map.map.setView([data.latitude, data.longitude], Map.map.getZoom(), { animate: true });
        saveNow();
      } else {
        tabConfigError.textContent = '✓ Localizado. Clique na aba pra teleportar la.';
        tabConfigError.classList.remove('hidden');
      }
    } catch (err) {
      tabConfigError.textContent = 'Erro: ' + err.message;
      tabConfigError.classList.remove('hidden');
    }
  }

  function clearProxyFromTab() {
    tabConfigProxyOneline.value = '';
    tabConfigProxyIp.value = '';
    tabConfigProxyPort.value = '';
    tabConfigProxyUser.value = '';
    tabConfigProxyPass.value = '';
    tabConfigLocationInfo.classList.add('hidden');
    tabConfigError.classList.add('hidden');
  }

  document.getElementById('tab-config-close').addEventListener('click', closeTabConfig);
  document.getElementById('tab-config-locate').addEventListener('click', locateProxyAndTeleport);
  document.getElementById('tab-config-clear').addEventListener('click', clearProxyFromTab);
  modalTabConfig.addEventListener('click', function (e) {
    if (e.target === modalTabConfig) closeTabConfig();
  });
  document.addEventListener('keydown', function (e) {
    if (!modalTabConfig.classList.contains('hidden') && e.key === 'Escape') closeTabConfig();
  });

  // ===== v0.1.20: Toggle do card Joystick+Posição =====
  (function initJoyPosToggle() {
    const panel = document.getElementById('joy-pos-panel');
    const btn = document.getElementById('btn-joy-pos-toggle');
    if (!panel || !btn) return;
    const KEY = 'fake-gps-pc:joy-pos-collapsed';
    function apply(collapsed) {
      panel.classList.toggle('collapsed', collapsed);
      btn.textContent = collapsed ? '▶' : '▼';
      btn.title = collapsed ? 'Expandir' : 'Minimizar';
    }
    apply(localStorage.getItem(KEY) === '1');
    btn.addEventListener('click', function () {
      const nowCollapsed = !panel.classList.contains('collapsed');
      apply(nowCollapsed);
      localStorage.setItem(KEY, nowCollapsed ? '1' : '0');
    });
  })();

  // ===== v0.1.14: Painel de beacons do gocollect =====
  (function initBeaconsPanel() {
    const bridge = window.FakeGPSBridge && window.FakeGPSBridge.gocollect;
    if (!bridge) return;

    const elStatus = document.getElementById('beacons-token-status');
    const btnRefresh = document.getElementById('btn-beacons-refresh');
    const btnCancel = document.getElementById('btn-beacons-cancel');
    const btnClear = document.getElementById('btn-beacons-clear-token');
    const elHint = document.getElementById('beacons-hint');
    const elList = document.getElementById('beacons-list');
    // v0.1.14.2: widget do header (cola manual + badge visual)
    const headerBadge = document.getElementById('gc-token-badge');
    const headerInput = document.getElementById('gc-token-input');
    const headerSave = document.getElementById('gc-token-save');
    // v0.1.15: scan regional
    const radiusInput = document.getElementById('beacons-radius-input');
    const radiusHint = document.getElementById('beacons-radius-hint');
    // v0.1.16: pacing configurável
    const pacingInput = document.getElementById('beacons-pacing-input');
    const pacingHint = document.getElementById('beacons-pacing-hint');
    // v0.1.18: paralelismo configurável
    const parallInput = document.getElementById('beacons-parall-input');
    const parallHint = document.getElementById('beacons-parall-hint');
    // v0.1.17: centro do scan (default = avatar, pode fixar via click no mapa)
    // v0.1.21: persistido em localStorage
    const centerLabel = document.getElementById('beacons-center-label');
    const btnPickCenter = document.getElementById('btn-beacons-pick-center');
    const btnResetCenter = document.getElementById('btn-beacons-reset-center');
    const SAVED_CENTER_KEY = 'fake-gps-pc:beacons-center';
    let scanCenter = null;
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_CENTER_KEY) || 'null');
      if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number') {
        scanCenter = saved;
      }
    } catch (e) {}
    // v0.1.19: filtros + crates acumulados no mapa
    const filterNormal = document.getElementById('filter-normal');
    const filterBeacon = document.getElementById('filter-beacon');
    const filterGoldRush = document.getElementById('filter-gold-rush');
    const scanCratesMap = {};  // dedupe de crates descobertos no scan atual (id -> crate)
    const elProgress = document.getElementById('beacons-progress');
    const elProgressFill = document.getElementById('beacons-progress-fill');
    const elProgressText = document.getElementById('beacons-progress-text');
    let currentLures = [];

    const SAVED_RADIUS_KEY = 'fake-gps-pc:beacons-radius-km';
    const SAVED_PACING_KEY = 'fake-gps-pc:beacons-pacing-ms';
    const SAVED_PARALL_KEY = 'fake-gps-pc:beacons-parall';

    const savedRadius = parseInt(localStorage.getItem(SAVED_RADIUS_KEY), 10);
    if (savedRadius >= 2 && savedRadius <= 500) radiusInput.value = savedRadius;

    const savedPacing = parseInt(localStorage.getItem(SAVED_PACING_KEY), 10);
    if (savedPacing >= 100 && savedPacing <= 5000) pacingInput.value = savedPacing;

    const savedParall = parseInt(localStorage.getItem(SAVED_PARALL_KEY), 10);
    if (savedParall >= 1 && savedParall <= 10) parallInput.value = savedParall;

    function currentRadius() { return Math.max(2, Math.min(500, parseInt(radiusInput.value, 10) || 30)); }
    function currentPacing() { return Math.max(100, Math.min(5000, parseInt(pacingInput.value, 10) || 600)); }
    function currentParall() { return Math.max(1, Math.min(10, parseInt(parallInput.value, 10) || 1)); }
    function estimatedCalls(r) { return Math.max(1, Math.round(Math.PI * r * r / 9)); }
    function fmtSeconds(s) {
      if (s < 60) return '~' + s + 's';
      const m = Math.floor(s / 60); const r = s % 60;
      return '~' + m + 'min' + (r > 0 ? r + 's' : '');
    }

    function updateHints() {
      const r = currentRadius();
      const p = currentPacing();
      const n = currentParall();
      const calls = estimatedCalls(r);
      let radiusWarn = '';
      if (r > 250) radiusWarn = ' ⛔ impraticável';
      else if (r > 100) radiusWarn = ' ⚠ muito lento';
      radiusHint.textContent = '(~' + calls + ' chamadas' + radiusWarn + ')';

      // Taxa total agregada = N workers / (pacing/1000)
      const reqPerSec = n * (1000 / p);
      const totalSec = Math.round((calls / n) * p / 1000);
      let risk = 'low', icon = '🟢';
      if (reqPerSec > 5) { risk = 'high'; icon = '🔴'; }
      else if (reqPerSec > 2) { risk = 'med'; icon = '🟡'; }
      pacingHint.className = 'beacons-radius-hint beacons-pacing-risk-' + risk;
      pacingHint.textContent = icon + ' ' + reqPerSec.toFixed(1) + ' req/s · ' + fmtSeconds(totalSec);
      parallHint.textContent = '(' + n + ' em paralelo)';

      syncScanAreaCircle();
    }

    // v0.1.22: círculo preview no mapa (área de busca do próximo scan)
    const MapRef = global.FakeGPS && global.FakeGPS.Map;
    function syncScanAreaCircle() {
      if (!MapRef || typeof MapRef.setScanAreaCircle !== 'function') return;
      const r = currentRadius();
      let lat, lng;
      if (scanCenter) {
        lat = scanCenter.lat; lng = scanCenter.lng;
      } else {
        const Mov = global.FakeGPS && global.FakeGPS.Movement;
        if (!Mov) return;
        const snap = Mov.getRaw();
        lat = snap.lat; lng = snap.lon;
      }
      try { MapRef.setScanAreaCircle({ lat: lat, lng: lng }, r * 1000); } catch (e) {}
    }

    radiusInput.addEventListener('input', function () {
      updateHints();
      const r = parseInt(radiusInput.value, 10);
      if (r >= 2 && r <= 500) localStorage.setItem(SAVED_RADIUS_KEY, String(r));
    });
    pacingInput.addEventListener('input', function () {
      updateHints();
      const p = parseInt(pacingInput.value, 10);
      if (p >= 100 && p <= 5000) localStorage.setItem(SAVED_PACING_KEY, String(p));
    });
    parallInput.addEventListener('input', function () {
      updateHints();
      const n = parseInt(parallInput.value, 10);
      if (n >= 1 && n <= 10) localStorage.setItem(SAVED_PARALL_KEY, String(n));
    });
    updateHints();

    // --- v0.1.17: picker de centro no mapa ---
    const Map = global.FakeGPS && global.FakeGPS.Map;

    function refreshCenterLabel() {
      if (scanCenter) {
        centerLabel.textContent = '🎯 ' + scanCenter.lat.toFixed(5) + ', ' + scanCenter.lng.toFixed(5);
        btnResetCenter.style.display = '';
      } else {
        centerLabel.textContent = '📍 Avatar';
        btnResetCenter.style.display = 'none';
      }
    }

    function startPickingCenter() {
      if (!Map || typeof Map.onNextClick !== 'function') return;
      btnPickCenter.classList.add('picking');
      btnPickCenter.textContent = 'Clique no mapa...';
      const mapContainer = document.getElementById('map');
      if (mapContainer) mapContainer.classList.add('selecting-scan-center');

      function cancelPicking() {
        btnPickCenter.classList.remove('picking');
        btnPickCenter.textContent = 'Alterar';
        if (mapContainer) mapContainer.classList.remove('selecting-scan-center');
        document.removeEventListener('keydown', escHandler);
      }
      function escHandler(e) {
        if (e.key === 'Escape') { Map.onNextClick(null); cancelPicking(); }
      }
      document.addEventListener('keydown', escHandler);

      Map.onNextClick(function (latlng) {
        scanCenter = { lat: latlng.lat, lng: latlng.lng };
        try { localStorage.setItem(SAVED_CENTER_KEY, JSON.stringify(scanCenter)); } catch (e) {}
        try { Map.setScanCenterMarker(latlng); } catch (e) {}
        refreshCenterLabel();
        syncScanAreaCircle();
        cancelPicking();
      });
    }

    function resetCenter() {
      scanCenter = null;
      try { localStorage.removeItem(SAVED_CENTER_KEY); } catch (e) {}
      try { if (Map && Map.clearScanCenterMarker) Map.clearScanCenterMarker(); } catch (e) {}
      refreshCenterLabel();
      syncScanAreaCircle();
    }

    btnPickCenter.addEventListener('click', startPickingCenter);
    btnResetCenter.addEventListener('click', resetCenter);
    refreshCenterLabel();
    // v0.1.21: se tinha centro salvo, aplica o marker no mapa agora
    if (scanCenter && Map && Map.setScanCenterMarker) {
      try { Map.setScanCenterMarker({ lat: scanCenter.lat, lng: scanCenter.lng }); } catch (e) {}
    }
    // v0.1.22: círculo inicial + follow do avatar quando scanCenter é null (poll 2s)
    syncScanAreaCircle();
    setInterval(function () {
      if (!scanCenter) syncScanAreaCircle();
    }, 2000);

    // --- v0.1.19: filtros persistidos + render incremental de scan ---
    const SAVED_FILTERS_KEY = 'fake-gps-pc:beacons-filters';
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_FILTERS_KEY) || '{}');
      if (typeof saved.normal === 'boolean') filterNormal.checked = saved.normal;
      if (typeof saved.beacon === 'boolean') filterBeacon.checked = saved.beacon;
      if (typeof saved.goldRush === 'boolean') filterGoldRush.checked = saved.goldRush;
    } catch (e) {}
    function saveFilters() {
      localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify({
        normal: filterNormal.checked,
        beacon: filterBeacon.checked,
        goldRush: filterGoldRush.checked
      }));
    }
    function filterCrate(c) {
      const kind = c.lure && c.lure.kind;
      if (kind === 'beacon') return filterBeacon.checked;
      if (kind === 'gold_rush') return filterGoldRush.checked;
      return filterNormal.checked;
    }
    function refreshMapCrates() {
      if (!Map || typeof Map.renderCrates !== 'function') return;
      const filtered = Object.values(scanCratesMap).filter(filterCrate);
      try { Map.renderCrates(filtered); } catch (e) { console.warn('[fakegps] renderCrates err:', e); }
    }
    [filterNormal, filterBeacon, filterGoldRush].forEach(function (cb) {
      cb.addEventListener('change', function () {
        saveFilters();
        refreshMapCrates();
      });
    });

    // Buffer local de lures descobertos pelo scan atual (dedupe por id)
    const scanLuresMap = {};
    let lastRenderThrottle = 0;
    function throttledRenderLures() {
      const now = Date.now();
      if (now - lastRenderThrottle < 200) return;
      lastRenderThrottle = now;
      const sorted = Object.values(scanLuresMap).sort(function (a, b) {
        return (a.distanceMeters || 0) - (b.distanceMeters || 0);
      });
      renderLures(sorted);
    }

    bridge.onScanLuresFound(function (newLures) {
      if (!Array.isArray(newLures)) return;
      newLures.forEach(function (l) { if (l && typeof l.id !== 'undefined') scanLuresMap[l.id] = l; });
      throttledRenderLures();
    });
    bridge.onScanCratesFound(function (newCrates) {
      if (!Array.isArray(newCrates)) return;
      let changed = false;
      newCrates.forEach(function (c) {
        if (c && typeof c.id !== 'undefined' && !scanCratesMap[c.id]) {
          scanCratesMap[c.id] = c;
          changed = true;
        }
      });
      if (changed) refreshMapCrates();
    });

    function setTokenState(hasToken, preview) {
      if (hasToken) {
        elStatus.textContent = '✓ Token ativo (' + (preview || '...') + ')';
        elStatus.classList.remove('beacons-token-missing');
        elStatus.classList.add('beacons-token-ok');
        btnRefresh.disabled = false;
        btnClear.style.display = '';
        elHint.style.display = 'none';
        if (headerBadge) {
          headerBadge.classList.remove('gc-token-badge-off');
          headerBadge.classList.add('gc-token-badge-ok');
          headerBadge.title = 'Token ativo (' + (preview || '...') + ')';
        }
      } else {
        elStatus.textContent = '⚠ Sem token';
        elStatus.classList.remove('beacons-token-ok');
        elStatus.classList.add('beacons-token-missing');
        btnRefresh.disabled = true;
        btnClear.style.display = 'none';
        elHint.style.display = '';
        elList.innerHTML = '';
        if (headerBadge) {
          headerBadge.classList.remove('gc-token-badge-ok');
          headerBadge.classList.add('gc-token-badge-off');
          headerBadge.title = 'Sem token - cole o Bearer no campo ao lado';
        }
      }
    }

    // v0.1.14.2: botão Salvar do widget do header
    if (headerSave && headerInput) {
      headerSave.addEventListener('click', async function () {
        const raw = (headerInput.value || '').trim();
        if (!raw) { alert('Cole o token antes'); return; }
        // Remove "Bearer " se o user colou com o prefixo
        const clean = raw.replace(/^Bearer\s+/i, '');
        headerSave.disabled = true;
        headerSave.textContent = '...';
        try {
          const result = await bridge.saveToken(clean);
          if (result && result.ok) {
            headerInput.value = '';
            // onTokenUpdated vai disparar e atualizar badge
          } else {
            alert('Falha ao salvar: ' + (result && result.error || 'erro desconhecido'));
          }
        } catch (e) {
          alert('Erro: ' + e.message);
        } finally {
          headerSave.disabled = false;
          headerSave.textContent = 'Salvar';
        }
      });
      headerInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); headerSave.click(); }
      });
    }

    function fmtDistance(m) {
      if (m < 1000) return Math.round(m) + ' m';
      return (m / 1000).toFixed(2) + ' km';
    }
    function fmtRemaining(endsAt) {
      const ms = endsAt - Date.now();
      if (ms < 0) return 'expirado';
      const min = Math.floor(ms / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      if (min > 0) return min + 'm ' + sec + 's';
      return sec + 's';
    }

    function renderLures(lures) {
      currentLures = lures;
      if (!lures || lures.length === 0) {
        elList.innerHTML = '<div class="beacons-list-empty">Nenhum lure ativo na sua área (raio ~2km)</div>';
        return;
      }
      elList.innerHTML = '';
      lures.slice(0, 10).forEach(function (l, idx) {
        const kindClass = 'beacon-kind-' + (l.kind || 'beacon').replace(/[^a-z_]/gi, '');
        const kindLabel = (l.kind || 'beacon').replace('_', ' ');
        const cardHtml = l.card
          ? '<div class="beacon-card">🪪 ' + (l.card.name || '?')
            + ' <span class="beacon-card-value">$' + (l.card.valueUsd || '?') + '</span></div>'
          : '<div class="beacon-card beacon-meta">(sem card registrado)</div>';
        const item = document.createElement('div');
        item.className = 'beacon-item';
        item.innerHTML =
          '<div class="beacon-item-head">'
          + '<span class="beacon-kind ' + kindClass + '">#' + l.id + ' ' + kindLabel + '</span>'
          + '<span class="beacon-distance">' + fmtDistance(l.distanceMeters) + '</span>'
          + '<button class="beacon-btn-remove" data-idx="' + idx + '" title="Remove da lista (pra aparecer de novo no próximo scan)">×</button>'
          + '</div>'
          + cardHtml
          + '<div class="beacon-meta">⏱ expira em ' + fmtRemaining(l.endsAt)
          + (l.foundByMe ? ' · já pego' : (l.cardFound ? ' · achado por outro' : ' · disponível')) + '</div>'
          + '<div class="beacon-actions">'
          + '<button class="beacon-btn-tp" data-idx="' + idx + '">⚡ TP direto</button>'
          + '<button class="beacon-btn-walk" data-idx="' + idx + '">🚶 Caminhar até</button>'
          + '</div>';
        elList.appendChild(item);
      });
    }

    function setScanning(on) {
      if (on) {
        btnRefresh.style.display = 'none';
        btnCancel.style.display = '';
        elProgress.style.display = 'flex';
        radiusInput.disabled = true;
      } else {
        btnRefresh.style.display = '';
        btnCancel.style.display = 'none';
        elProgress.style.display = 'none';
        radiusInput.disabled = false;
      }
    }

    bridge.onScanProgress(function (progress) {
      if (!progress) return;
      const pct = progress.total > 0 ? Math.round(100 * progress.scanned / progress.total) : 0;
      elProgressFill.style.width = pct + '%';
      elProgressText.textContent = progress.scanned + ' / ' + progress.total
        + ' · ' + (progress.lureCount || 0) + ' lures';
    });

    async function scan() {
      const Movement = global.FakeGPS && global.FakeGPS.Movement;
      if (!Movement) { alert('Movement module ausente'); return; }
      // v0.1.17: usa scanCenter se o user escolheu, senão posição do avatar
      let scanLat, scanLng;
      if (scanCenter) {
        scanLat = scanCenter.lat;
        scanLng = scanCenter.lng;
      } else {
        const snap = Movement.getRaw();
        scanLat = snap.lat;
        scanLng = snap.lon;
      }
      const radiusKm = currentRadius();
      const pacingMs = currentPacing();
      const concurrency = currentParall();

      setScanning(true);
      elProgressFill.style.width = '0%';
      elProgressText.textContent = '0 / ?';
      // v0.1.19: limpa buffer do scan anterior pra render incremental começar do zero
      Object.keys(scanLuresMap).forEach(function (k) { delete scanLuresMap[k]; });
      Object.keys(scanCratesMap).forEach(function (k) { delete scanCratesMap[k]; });
      renderLures([]);
      refreshMapCrates();

      try {
        const result = await bridge.scanRegion(scanLat, scanLng, radiusKm, pacingMs, concurrency);
        if (!result.ok) {
          if (result.error === 'unauthorized') {
            setTokenState(false);
            alert('Token do gocollect expirou. Cole um novo no campo do header ou reabra gocollect.fun pra capturar automaticamente.');
            if (result.partial && result.partial.lures) renderLures(result.partial.lures);
          } else if (result.error === 'no-token') {
            setTokenState(false);
          } else {
            alert('Erro ao scanear: ' + (result.message || result.error));
          }
        } else {
          renderLures(result.lures);
          if (result.cancelled) {
            console.log('[fakegps] scan cancelado em ' + result.scanned + '/' + result.total);
          }
          if (result.errors > 0) {
            console.warn('[fakegps] ' + result.errors + ' chamadas falharam durante o scan');
          }
        }
      } catch (e) {
        alert('Erro: ' + e.message);
      } finally {
        setScanning(false);
      }
    }

    btnRefresh.addEventListener('click', scan);
    btnCancel.addEventListener('click', function () {
      bridge.cancelScan();
      btnCancel.disabled = true;
      btnCancel.textContent = '⏸ cancelando...';
      setTimeout(function () {
        btnCancel.disabled = false;
        btnCancel.textContent = '⏹ Cancelar';
      }, 2000);
    });

    btnClear.addEventListener('click', async function () {
      if (!confirm('Remover token salvo? Vai precisar reabrir gocollect.fun pra capturar de novo.')) return;
      await bridge.clearToken();
      setTokenState(false);
    });

    elList.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const lure = currentLures[idx];
      if (!lure) return;
      // v0.1.22: botão × remove o lure da lista local pra ele poder ser achado de novo no próximo scan
      if (btn.classList.contains('beacon-btn-remove')) {
        if (typeof lure.id !== 'undefined') delete scanLuresMap[lure.id];
        const remaining = Object.values(scanLuresMap).sort(function (a, b) {
          return (a.distanceMeters || 0) - (b.distanceMeters || 0);
        });
        renderLures(remaining);
        return;
      }
      const Movement = global.FakeGPS && global.FakeGPS.Movement;
      const AutoPilot = global.FakeGPS && global.FakeGPS.AutoPilot;
      if (!Movement) return;
      if (btn.classList.contains('beacon-btn-tp')) {
        Movement.teleport(lure.lat, lure.lng);
      } else if (btn.classList.contains('beacon-btn-walk')) {
        if (AutoPilot && typeof AutoPilot.start === 'function') {
          const Routing = global.FakeGPS && global.FakeGPS.Routing;
          if (Routing && typeof Routing.fetchFootRoute === 'function') {
            const snap = Movement.getRaw();
            Routing.fetchFootRoute(snap.lat, snap.lon, lure.lat, lure.lng).then(function (route) {
              AutoPilot.start(route.waypoints);
            }).catch(function () {
              // Fallback: linha reta
              AutoPilot.start([{ lat: Movement.getRaw().lat, lon: Movement.getRaw().lon }, { lat: lure.lat, lon: lure.lng }]);
            });
          } else {
            AutoPilot.start([{ lat: Movement.getRaw().lat, lon: Movement.getRaw().lon }, { lat: lure.lat, lon: lure.lng }]);
          }
        } else {
          Movement.teleport(lure.lat, lure.lng);
        }
      }
    });

    bridge.onTokenUpdated(function (payload) {
      setTokenState(payload.hasToken, payload.tokenPreview);
    });

    // Status inicial
    bridge.getTokenStatus().then(function (st) {
      setTokenState(st.hasToken, st.tokenPreview);
    });
  })();

  console.log('%c[Fake GPS PC] v0.1.14 pronto',
    'background:#1a73e8;color:#fff;padding:2px 6px;border-radius:3px');
  console.log('Controles: joystick (mouse) ou WASD/setas | ⏸ pausar sem perder posicao');
  console.log('Posicao auto-salva a cada 5s + ao fechar');
})(window);
