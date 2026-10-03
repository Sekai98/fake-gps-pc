// Popup da extension: botao liga/desliga + status

const STATE_STORAGE_KEY = 'fakeGPSEnabled';
const TAB_ID_STORAGE_KEY = 'fakeGPSTabId';
const SERVER_IP_STORAGE_KEY = 'fakeGPSServerIp';  // IP do PC (pra celular Kiwi)

const statusEl = document.getElementById('status');
const enabledStatusEl = document.getElementById('enabledStatus');
const latEl = document.getElementById('lat');
const lonEl = document.getElementById('lon');
const dotEl = document.getElementById('statusDot');
const toggleBtn = document.getElementById('toggleBtn');
const tabIdSelect = document.getElementById('tabIdSelect');
const refreshTabsBtn = document.getElementById('refreshTabsBtn');
const serverIpInput = document.getElementById('serverIpInput');

function renderToggleButton(enabled) {
  if (enabled) {
    toggleBtn.textContent = '⏸ Desligar Fake GPS';
    toggleBtn.classList.remove('off');
    toggleBtn.classList.add('on');
    enabledStatusEl.textContent = 'LIGADO';
    enabledStatusEl.style.color = '#0f9d58';
  } else {
    toggleBtn.textContent = '▶ Ligar Fake GPS';
    toggleBtn.classList.remove('on');
    toggleBtn.classList.add('off');
    enabledStatusEl.textContent = 'DESLIGADO';
    enabledStatusEl.style.color = '#e53935';
  }
}

async function getEnabled() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([STATE_STORAGE_KEY], function (data) {
      resolve(data[STATE_STORAGE_KEY] !== false); // default true
    });
  });
}

async function setEnabled(value) {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ [STATE_STORAGE_KEY]: value }, resolve);
  });
}

toggleBtn.addEventListener('click', async function () {
  const current = await getEnabled();
  await setEnabled(!current);
  renderToggleButton(!current);
});

// v0.1.14: dropdown de abas (fetch /tabs do server)
const PORTS_TO_TRY = [3477, 3478, 3479, 3480];

async function findServerPort(host) {
  for (const p of PORTS_TO_TRY) {
    try {
      const r = await fetch('http://' + host + ':' + p + '/health', {
        cache: 'no-store', signal: AbortSignal.timeout(500)
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.service === 'fake-gps-pc') return p;
      }
    } catch (e) {}
  }
  return null;
}

async function loadTabs() {
  if (!tabIdSelect) return;
  tabIdSelect.innerHTML = '<option value="">Carregando...</option>';
  const data = await new Promise(function (resolve) {
    chrome.storage.local.get([SERVER_IP_STORAGE_KEY, TAB_ID_STORAGE_KEY], resolve);
  });
  const host = data[SERVER_IP_STORAGE_KEY] || '127.0.0.1';
  const selected = data[TAB_ID_STORAGE_KEY] || '';
  const port = await findServerPort(host);
  if (!port) {
    tabIdSelect.innerHTML = '<option value="">(Fake GPS offline)</option>';
    return;
  }
  try {
    const r = await fetch('http://' + host + ':' + port + '/tabs', {
      cache: 'no-store', signal: AbortSignal.timeout(1000)
    });
    const d = await r.json();
    const tabs = (d && d.tabs) || [];
    let html = '<option value="">(Default - aba ativa do Fake GPS)</option>';
    tabs.forEach(function (t) {
      const hasProxy = t.proxy && t.proxy.ip ? ' 🌐' : '';
      const sel = t.id === selected ? ' selected' : '';
      html += '<option value="' + t.id + '"' + sel + '>' + t.name + hasProxy + '</option>';
    });
    tabIdSelect.innerHTML = html;
  } catch (err) {
    tabIdSelect.innerHTML = '<option value="">(erro: ' + err.message + ')</option>';
  }
}

if (tabIdSelect) {
  tabIdSelect.addEventListener('change', function () {
    chrome.storage.local.set({ [TAB_ID_STORAGE_KEY]: tabIdSelect.value });
  });
  loadTabs();
}
if (refreshTabsBtn) refreshTabsBtn.addEventListener('click', loadTabs);

// Presets rapidos de IP (botoes abaixo do input)
document.querySelectorAll('.srv-preset-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const ip = btn.dataset.ip || '';
    if (serverIpInput) {
      serverIpInput.value = ip;
      chrome.storage.local.set({ [SERVER_IP_STORAGE_KEY]: ip });
    }
    setTimeout(function () { loadTabs(); checkServerStatus(); }, 100);
  });
});

// --- Status do servidor (health + versao + abas) ---
async function checkServerStatus() {
  const data = await new Promise(function (resolve) {
    chrome.storage.local.get([SERVER_IP_STORAGE_KEY], resolve);
  });
  const host = data[SERVER_IP_STORAGE_KEY] || '127.0.0.1';
  const srvDot = document.getElementById('srvDot');
  const srvEndpoint = document.getElementById('srvEndpoint');
  const srvVersion = document.getElementById('srvVersion');
  const srvTabsCount = document.getElementById('srvTabsCount');
  const srvStatus = document.getElementById('srvStatus');
  if (!srvDot) return;

  srvDot.className = 'srv-dot';
  srvEndpoint.textContent = 'buscando...';
  srvVersion.textContent = '—';
  srvTabsCount.textContent = '—';
  srvStatus.className = 'srv-status';

  const port = await findServerPort(host);
  if (!port) {
    srvDot.classList.add('off');
    srvEndpoint.textContent = 'offline';
    srvStatus.classList.add('offline');
    return;
  }
  try {
    const [h, t] = await Promise.all([
      fetch('http://' + host + ':' + port + '/health').then(function (r) { return r.json(); }),
      fetch('http://' + host + ':' + port + '/tabs').then(function (r) { return r.json(); })
    ]);
    srvDot.classList.add('on');
    srvEndpoint.textContent = host + ':' + port;
    srvVersion.textContent = (h && h.version) || '?';
    const tabs = (t && t.tabs) || [];
    srvTabsCount.textContent = tabs.length + (tabs.length === 1 ? ' aba' : ' abas');
    srvStatus.classList.add('online');
  } catch (err) {
    srvDot.classList.add('off');
    srvEndpoint.textContent = 'erro: ' + err.message;
    srvStatus.classList.add('offline');
  }
}
checkServerStatus();

// --- v0.1.14: Checklist de permissoes do site ---
async function checkSitePermissions() {
  const perms = ['geolocation', 'gyroscope', 'accelerometer', 'magnetometer'];
  // Reset UI
  perms.forEach(function (p) {
    const el = document.getElementById('perm-' + p);
    if (el) { el.textContent = '...'; el.className = 'perm-state'; }
  });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('sem aba ativa');
    // Executa no ISOLATED world (sem nossos patches do inject.js)
    // pra ver o estado REAL das permissoes, nao o fake
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'ISOLATED',
      func: async function (permissions) {
        const out = {};
        for (const name of permissions) {
          try {
            const r = await navigator.permissions.query({ name: name });
            out[name] = r.state;
          } catch (e) {
            out[name] = 'unsupported';
          }
        }
        return out;
      },
      args: [perms]
    });
    const states = (result && result.result) || {};
    perms.forEach(function (p) {
      const el = document.getElementById('perm-' + p);
      if (!el) return;
      const state = states[p] || 'unsupported';
      el.textContent = state === 'granted' ? '✓ granted'
        : state === 'denied' ? '✗ denied'
        : state === 'prompt' ? '⚠ prompt'
        : state;
      el.className = 'perm-state ' + (state === 'granted' ? 'granted'
        : state === 'denied' ? 'denied'
        : state === 'prompt' ? 'prompt'
        : '');
    });
  } catch (err) {
    perms.forEach(function (p) {
      const el = document.getElementById('perm-' + p);
      if (el) { el.textContent = 'erro'; el.className = 'perm-state'; }
    });
  }
}

const permsRefreshBtn = document.getElementById('permsRefresh');
if (permsRefreshBtn) permsRefreshBtn.addEventListener('click', checkSitePermissions);

const permsHelpToggle = document.getElementById('permsHelpToggle');
const permsHelp = document.getElementById('permsHelp');
if (permsHelpToggle && permsHelp) {
  permsHelpToggle.addEventListener('click', function () {
    permsHelp.classList.toggle('open');
  });
}

// Check inicial ao abrir popup
checkSitePermissions();

// v0.1.13: input de IP do servidor (celular via Kiwi aponta pro PC)
if (serverIpInput) {
  chrome.storage.local.get([SERVER_IP_STORAGE_KEY], function (data) {
    serverIpInput.value = data[SERVER_IP_STORAGE_KEY] || '';
  });
  let saveIpTimer = null;
  serverIpInput.addEventListener('input', function () {
    const val = serverIpInput.value.trim();
    if (saveIpTimer) clearTimeout(saveIpTimer);
    saveIpTimer = setTimeout(function () {
      chrome.storage.local.set({ [SERVER_IP_STORAGE_KEY]: val });
    }, 300);
  });
}

(async function () {
  // Estado inicial do toggle
  const enabled = await getEnabled();
  renderToggleButton(enabled);

  // Estado do inject.js na aba ativa
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('sem aba ativa');

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: function () {
        const st = window.__FAKE_GPS_POC__;
        return st ? {
          active: !!st.active,
          enabled: !!st.enabled,
          target: st.target,
          dynamic: !!st.dynamic
        } : null;
      }
    });

    const state = result && result.result;
    if (state && state.active) {
      statusEl.textContent = state.dynamic ? 'ATIVO (Electron)' : 'ATIVO (fallback)';
      statusEl.style.color = '#0f9d58';
      latEl.textContent = state.target.lat.toFixed(6);
      lonEl.textContent = state.target.lon.toFixed(6);
      dotEl.classList.add('on');
    } else {
      statusEl.textContent = 'nao injetado';
      statusEl.style.color = '#f9ab00';
      dotEl.classList.add('off');
    }
  } catch (err) {
    statusEl.textContent = 'erro: ' + err.message;
    statusEl.style.color = '#e53935';
    dotEl.classList.add('off');
  }
})();
