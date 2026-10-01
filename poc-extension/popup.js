// Popup da extension: botao liga/desliga + status

const STATE_STORAGE_KEY = 'fakeGPSEnabled';

const statusEl = document.getElementById('status');
const enabledStatusEl = document.getElementById('enabledStatus');
const latEl = document.getElementById('lat');
const lonEl = document.getElementById('lon');
const dotEl = document.getElementById('statusDot');
const toggleBtn = document.getElementById('toggleBtn');

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
