// TabsManager - gerencia a lista de abas e qual esta ativa.
// Cada aba tem id, name e estado persistido em keys namespaced:
//   fake-gps-pc:tab-{id}:state
//   fake-gps-pc:tab-{id}:route-plan
//   etc.
//
// Alpha2: UI funcional de abas (criar/nomear/remover/highlight).
// Alpha3: troca de contexto real por aba.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'fake-gps-pc:tabs-list';
  const ACTIVE_KEY = 'fake-gps-pc:active-tab';
  const LEGACY_STATE_KEY = 'fake-gps-pc:state';
  const LEGACY_ROUTE_KEY = 'fake-gps-pc:route-plan';

  function createTabsManager() {
    let tabs = [];           // [{id, name, createdAt}]
    let activeId = null;
    const listeners = { change: [], switch: [] };

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            tabs = arr.filter(function (t) {
              return t && typeof t.id === 'string' && typeof t.name === 'string';
            });
          }
        }
        activeId = localStorage.getItem(ACTIVE_KEY);
      } catch (e) { /* silencio */ }

      // Primeira execucao: migra estado legacy pra tab-1
      if (tabs.length === 0) {
        migrateLegacy();
      }

      // Garante que activeId e valido
      if (!activeId || !tabs.find(function (t) { return t.id === activeId; })) {
        activeId = tabs[0] && tabs[0].id;
      }
    }

    function migrateLegacy() {
      const tabId = 'tab-1';
      tabs = [{ id: tabId, name: 'Conta A', createdAt: Date.now() }];
      activeId = tabId;

      // Copia estado legacy pra namespaced (nao apaga o legacy pra permitir rollback)
      const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
      const legacyRoute = localStorage.getItem(LEGACY_ROUTE_KEY);
      try {
        if (legacyState) localStorage.setItem('fake-gps-pc:' + tabId + ':state', legacyState);
        if (legacyRoute) localStorage.setItem('fake-gps-pc:' + tabId + ':route-plan', legacyRoute);
      } catch (e) {}
      saveList();
    }

    function saveList() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
        if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      } catch (e) {}
    }

    function all() { return tabs.slice(); }
    function count() { return tabs.length; }
    function getActive() { return tabs.find(function (t) { return t.id === activeId; }) || null; }
    function getActiveId() { return activeId; }
    function get(id) { return tabs.find(function (t) { return t.id === id; }) || null; }

    function nextDefaultName() {
      // Pega proxima letra A-Z que nao esta usada
      const used = new Set(tabs.map(function (t) { return t.name; }));
      for (let i = 0; i < 26; i++) {
        const name = 'Conta ' + String.fromCharCode(65 + i);
        if (!used.has(name)) return name;
      }
      return 'Conta ' + (tabs.length + 1);
    }

    function create(name) {
      const id = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const tab = {
        id: id,
        name: (name && name.trim()) || nextDefaultName(),
        createdAt: Date.now()
      };
      tabs.push(tab);
      saveList();
      emit('change');
      return tab;
    }

    function remove(id) {
      if (tabs.length <= 1) return false; // nao deixa remover a ultima
      const idx = tabs.findIndex(function (t) { return t.id === id; });
      if (idx < 0) return false;
      tabs.splice(idx, 1);
      // Limpa storage namespaced dessa aba
      const prefix = 'fake-gps-pc:' + id + ':';
      try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.indexOf(prefix) === 0) toRemove.push(key);
        }
        toRemove.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
      // Se removida era a ativa, troca pra anterior ou primeira
      if (activeId === id) {
        activeId = tabs[Math.max(0, idx - 1)].id;
        saveList();
        emit('switch');
      } else {
        saveList();
      }
      emit('change');
      return true;
    }

    function rename(id, newName) {
      const tab = get(id);
      if (!tab) return false;
      const clean = (newName || '').trim().slice(0, 20);
      if (!clean) return false;
      tab.name = clean;
      saveList();
      emit('change');
      return true;
    }

    function switchTo(id) {
      if (id === activeId) return false;
      if (!get(id)) return false;
      activeId = id;
      saveList();
      emit('switch');
      emit('change');
      return true;
    }

    // Helper pra criar keys namespaced
    function storageKey(id, suffix) {
      return 'fake-gps-pc:' + id + ':' + suffix;
    }

    function on(event, cb) {
      if (listeners[event] && typeof cb === 'function') listeners[event].push(cb);
    }

    function emit(event) {
      (listeners[event] || []).forEach(function (cb) {
        try { cb(); } catch (e) {}
      });
    }

    load();

    return {
      all: all,
      count: count,
      getActive: getActive,
      getActiveId: getActiveId,
      get: get,
      create: create,
      remove: remove,
      rename: rename,
      switchTo: switchTo,
      storageKey: storageKey,
      on: on
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.TabsManager = createTabsManager();
})(window);
