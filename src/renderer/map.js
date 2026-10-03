(function (global) {
  'use strict';

  // Ponto inicial: Av. Paulista, Sao Paulo
  const START_POSITION = { lat: -23.561684, lon: -46.655981 };

  // Factory: cria instance Leaflet INDEPENDENTE em um container.
  // options: { containerId: 'map', startLat, startLon }
  function createMap(options) {
    options = options || {};
    const containerId = options.containerId || 'map';
    const startLat = typeof options.startLat === 'number' ? options.startLat : START_POSITION.lat;
    const startLon = typeof options.startLon === 'number' ? options.startLon : START_POSITION.lon;

    const map = L.map(containerId, {
      zoomControl: true,
      attributionControl: false,
      zoomSnap: 0.5
    }).setView([startLat, startLon], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3
    }).addTo(map);

    const markerIcon = L.divIcon({
      className: 'fake-gps-marker',
      html: [
        '<div class="marker-pulse"></div>',
        '<div class="marker-rotator"><div class="marker-arrow"></div></div>',
        '<div class="marker-core"></div>'
      ].join(''),
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const marker = L.marker([startLat, startLon], {
      icon: markerIcon,
      interactive: false,
      keyboard: false
    }).addTo(map);

    function setPosition(lat, lon, heading) {
      marker.setLatLng([lat, lon]);
      const el = marker.getElement();
      if (el) {
        const rot = el.querySelector('.marker-rotator');
        if (rot) rot.style.transform = 'rotate(' + heading.toFixed(1) + 'deg)';
      }
    }

    function centerOnMarker(animate) {
      map.setView(marker.getLatLng(), map.getZoom(), {
        animate: animate !== false,
        duration: 0.4
      });
    }

    function panToMarkerIfOut() {
      const bounds = map.getBounds().pad(-0.15);
      if (!bounds.contains(marker.getLatLng())) {
        map.panTo(marker.getLatLng(), { animate: true, duration: 0.3 });
      }
    }

    // --- Popup de acoes ---
    const actionHandlers = {};
    function onAction(name, cb) { actionHandlers[name] = cb; }

    let teleportLockedProvider = function () { return false; };
    function setTeleportLockProvider(fn) {
      if (typeof fn === 'function') teleportLockedProvider = fn;
    }

    function showActionPopup(latlng) {
      const lat = latlng.lat.toFixed(6);
      const lon = latlng.lng.toFixed(6);
      const locked = teleportLockedProvider();

      const parts = [
        '<div class="action-popup">',
        '  <div class="action-popup-coords">', lat, ', ', lon, '</div>',
        '  <button class="action-popup-btn action-popup-btn-primary" data-action="route">',
        '    🚶 Caminhar ate aqui',
        '  </button>',
        '  <button class="action-popup-btn action-popup-btn-secondary" data-action="add-to-route">',
        '    ➕ Adicionar a rota',
        '  </button>'
      ];
      if (!locked) {
        parts.push(
          '  <button class="action-popup-btn action-popup-btn-secondary" data-action="teleport">',
          '    🎯 Teletransportar aqui',
          '  </button>',
          '  <div class="action-popup-hint">⚠️ Teleporte pode ser detectado</div>'
        );
      } else {
        parts.push(
          '  <div class="action-popup-hint">🔒 Teleporte bloqueado (destrave na barra)</div>'
        );
      }
      parts.push('</div>');
      const html = parts.join('');

      const popup = L.popup({
        closeButton: true,
        autoClose: true,
        closeOnClick: true,
        className: 'action-popup-wrap',
        maxWidth: 260
      })
        .setLatLng(latlng)
        .setContent(html)
        .openOn(map);

      setTimeout(function () {
        const el = popup.getElement();
        if (!el) return;
        el.querySelectorAll('.action-popup-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const action = btn.dataset.action;
            const handler = actionHandlers[action];
            if (handler) handler(latlng.lat, latlng.lng);
            map.closePopup(popup);
          });
        });
      }, 0);
    }

    // v0.1.17: handler de "próximo click" sobrescreve o popup padrão uma vez.
    // Usado pra selecionar centro do scan de beacons pelo mapa.
    let onNextClickCb = null;
    function onNextClick(cb) { onNextClickCb = typeof cb === 'function' ? cb : null; }

    map.on('click', function (e) {
      if (onNextClickCb) {
        const cb = onNextClickCb;
        onNextClickCb = null;
        try { cb(e.latlng); } catch (err) { console.warn('[map] onNextClick err:', err); }
        return;
      }
      showActionPopup(e.latlng);
    });

    // v0.1.17: marker visual do centro do scan de beacons
    let scanCenterMarker = null;
    function setScanCenterMarker(latlng) {
      clearScanCenterMarker();
      scanCenterMarker = L.marker([latlng.lat, latlng.lng], {
        icon: L.divIcon({
          className: 'scan-center-marker',
          html: '<div class="scan-center-pin">🎯</div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        }),
        interactive: false,
        keyboard: false
      }).addTo(map);
    }
    function clearScanCenterMarker() {
      if (scanCenterMarker) { try { map.removeLayer(scanCenterMarker); } catch (e) {} scanCenterMarker = null; }
    }

    // --- Polyline de rota ---
    let routeLayer = null;
    let destMarker = null;

    function drawRoute(waypoints) {
      clearRoute();
      if (!Array.isArray(waypoints) || waypoints.length < 2) return;
      const latlngs = waypoints.map(function (w) { return [w.lat, w.lon]; });
      routeLayer = L.polyline(latlngs, {
        color: '#4285f4',
        weight: 4,
        opacity: 0.75,
        dashArray: '6,8',
        lineCap: 'round'
      }).addTo(map);
      const last = waypoints[waypoints.length - 1];
      destMarker = L.marker([last.lat, last.lon], {
        icon: L.divIcon({
          className: 'route-dest-marker',
          html: '<div class="route-dest-pin">🏁</div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        interactive: false
      }).addTo(map);
    }

    function clearRoute() {
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
      if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    }

    // --- Layers ---
    const cratesLayer = L.layerGroup().addTo(map);
    const plannedRouteLayer = L.layerGroup().addTo(map);
    const customPinsLayer = L.layerGroup().addTo(map);
    let onCrateActionCb = null;
    let onCrateToggleRouteCb = null;
    let isInPlannedRouteFn = function () { return false; };
    function onCrateAction(cb) { onCrateActionCb = cb; }
    function onCrateToggleRoute(cb) { onCrateToggleRouteCb = cb; }
    function setPlannedRouteChecker(fn) {
      if (typeof fn === 'function') isInPlannedRouteFn = fn;
    }

    function cratesIcon(crate, routeIndex) {
      const inRoute = routeIndex !== null;
      const classNames = ['crate-marker'];
      if (crate.openedByMe) classNames.push('crate-opened');
      if (inRoute) classNames.push('crate-in-route');
      // v0.1.18: cores por tipo de lure
      const kind = crate.lure && crate.lure.kind;
      const pinClasses = ['crate-pin'];
      if (inRoute) pinClasses.push('crate-pin-numbered');
      if (kind === 'beacon') pinClasses.push('crate-pin-beacon');
      else if (kind === 'gold_rush') pinClasses.push('crate-pin-gold_rush');
      const content = inRoute
        ? '<div class="' + pinClasses.join(' ') + '">' + (routeIndex + 1) + '</div>'
        : '<div class="' + pinClasses.join(' ') + '">📦</div>';
      return L.divIcon({
        className: classNames.join(' '),
        html: content,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
    }

    function renderCrates(list) {
      cratesLayer.clearLayers();
      if (!Array.isArray(list)) return;
      list.forEach(function (c) {
        const routeIndex = isInPlannedRouteFn(c.id);
        const inRoute = typeof routeIndex === 'number' && routeIndex >= 0;
        const marker = L.marker([c.lat, c.lon], {
          icon: cratesIcon(c, inRoute ? routeIndex : null),
          keyboard: false,
          riseOnHover: true
        });

        let actionsHtml = '';
        if (c.openedByMe) {
          actionsHtml = '<div class="crate-popup-opened">✓ Ja aberta por voce</div>';
        } else {
          actionsHtml += inRoute
            ? '<button class="action-popup-btn action-popup-btn-danger" data-action="toggle-route">✕ Remover da rota</button>'
            : '<button class="action-popup-btn action-popup-btn-primary" data-action="toggle-route">➕ Adicionar a rota</button>';
          actionsHtml += '<button class="action-popup-btn action-popup-btn-secondary" data-action="route-crate">🚶 Ir agora</button>';
        }

        const html = [
          '<div class="action-popup">',
          '  <div class="action-popup-coords">📦 Crate' + (inRoute ? ' · #' + (routeIndex + 1) + ' na rota' : '') + '</div>',
          '  <div class="crate-popup-id">', c.id.substring(0, 24), '...</div>',
          '  ', actionsHtml,
          '</div>'
        ].join('');

        marker.bindPopup(html, { className: 'action-popup-wrap', maxWidth: 260 });
        marker.on('popupopen', function (e) {
          const el = e.popup.getElement();
          if (!el) return;
          const goBtn = el.querySelector('[data-action="route-crate"]');
          if (goBtn) {
            goBtn.addEventListener('click', function () {
              if (onCrateActionCb) onCrateActionCb(c);
              map.closePopup(e.popup);
            });
          }
          const toggleBtn = el.querySelector('[data-action="toggle-route"]');
          if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
              if (onCrateToggleRouteCb) onCrateToggleRouteCb(c);
              map.closePopup(e.popup);
            });
          }
        });
        cratesLayer.addLayer(marker);
      });
    }

    function drawPlannedRoute(waypoints) {
      plannedRouteLayer.clearLayers();
      if (!Array.isArray(waypoints) || waypoints.length < 2) return;
      const latlngs = waypoints.map(function (w) { return [w.lat, w.lon]; });
      const border = L.polyline(latlngs, {
        color: '#000', weight: 9, opacity: 0.85,
        lineCap: 'round', lineJoin: 'round'
      });
      const line = L.polyline(latlngs, {
        color: '#ffd600', weight: 5, opacity: 1,
        lineCap: 'round', lineJoin: 'round'
      });
      plannedRouteLayer.addLayer(border);
      plannedRouteLayer.addLayer(line);
    }

    function clearPlannedRoute() { plannedRouteLayer.clearLayers(); }

    // --- Pins custom (pontos manuais da rota) ---
    let onCustomPinRemoveCb = null;
    function onCustomPinRemove(cb) { onCustomPinRemoveCb = cb; }

    function renderCustomPins(list) {
      customPinsLayer.clearLayers();
      if (!Array.isArray(list)) return;
      list.forEach(function (p) {
        const marker = L.marker([p.lat, p.lon], {
          icon: L.divIcon({
            className: 'custom-pin-marker',
            html: '<div class="custom-pin"><span class="custom-pin-emoji">📍</span><span class="custom-pin-idx">' + (p.routeIndex + 1) + '</span></div>',
            iconSize: [30, 36],
            iconAnchor: [15, 36]
          }),
          keyboard: false,
          riseOnHover: true
        });
        const html = [
          '<div class="action-popup">',
          '  <div class="action-popup-coords">📍 Ponto ', (p.routeIndex + 1), ' na rota</div>',
          '  <div class="crate-popup-id">', p.lat.toFixed(5), ', ', p.lon.toFixed(5), '</div>',
          '  <button class="action-popup-btn action-popup-btn-danger" data-action="remove-custom">✕ Remover da rota</button>',
          '</div>'
        ].join('');
        marker.bindPopup(html, { className: 'action-popup-wrap', maxWidth: 240 });
        marker.on('popupopen', function (e) {
          const el = e.popup.getElement();
          if (!el) return;
          const btn = el.querySelector('[data-action="remove-custom"]');
          if (btn) {
            btn.addEventListener('click', function () {
              if (onCustomPinRemoveCb) onCustomPinRemoveCb(p.id);
              map.closePopup(e.popup);
            });
          }
        });
        customPinsLayer.addLayer(marker);
      });
    }
    function clearCustomPins() { customPinsLayer.clearLayers(); }

    // Destroi: remove tudo do mapa (usado quando aba fecha no multi-abas)
    function destroy() {
      try { map.remove(); } catch (e) {}
    }

    return {
      map: map,
      marker: marker,
      setPosition: setPosition,
      centerOnMarker: centerOnMarker,
      panToMarkerIfOut: panToMarkerIfOut,
      startPosition: { lat: startLat, lon: startLon },
      onAction: onAction,
      drawRoute: drawRoute,
      clearRoute: clearRoute,
      setTeleportLockProvider: setTeleportLockProvider,
      renderCrates: renderCrates,
      onCrateAction: onCrateAction,
      onCrateToggleRoute: onCrateToggleRoute,
      setPlannedRouteChecker: setPlannedRouteChecker,
      drawPlannedRoute: drawPlannedRoute,
      clearPlannedRoute: clearPlannedRoute,
      renderCustomPins: renderCustomPins,
      clearCustomPins: clearCustomPins,
      onCustomPinRemove: onCustomPinRemove,
      onNextClick: onNextClick,
      setScanCenterMarker: setScanCenterMarker,
      clearScanCenterMarker: clearScanCenterMarker,
      destroy: destroy
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.createMap = createMap;
  // Instance default: usa container '#map' (compat com app.js atual)
  global.FakeGPS.Map = createMap({ containerId: 'map' });
  // Expoe START_POSITION pra retrocompatibilidade
  global.FakeGPS.Map.startPosition = START_POSITION;
})(window);
