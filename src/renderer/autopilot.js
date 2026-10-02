// Autopilot: segue um array de waypoints automaticamente, sem input do usuario.
// Factory function - cria instance INDEPENDENTE. API global = instance default (compat).

(function (global) {
  'use strict';

  const WAYPOINT_REACHED_METERS = 3;
  const DEFAULT_APPROACH_SLOWDOWN_METERS = 15;
  const DEFAULT_MIN_MAGNITUDE_IN_CURVE = 0.35;
  const CURVE_FULL_SLOWDOWN_DEG = 90;

  // --- Funcoes puras (compartilhadas entre instances) ---
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function computeHeading(fromLat, fromLon, toLat, toLon) {
    const latRad = fromLat * Math.PI / 180;
    const dLat = toLat - fromLat;
    const dLon = toLon - fromLon;
    const dNorth = dLat * 111320;
    const dEast = dLon * 111320 * Math.cos(latRad);
    const h = Math.atan2(dEast, dNorth) * 180 / Math.PI;
    return (h + 360) % 360;
  }

  function turnAngleDeg(from, through, to) {
    const dx1 = through.lon - from.lon;
    const dy1 = through.lat - from.lat;
    const dx2 = to.lon - through.lon;
    const dy2 = to.lat - through.lat;
    const m1 = Math.hypot(dx1, dy1);
    const m2 = Math.hypot(dx2, dy2);
    if (m1 === 0 || m2 === 0) return 0;
    const cos = (dx1 * dx2 + dy1 * dy2) / (m1 * m2);
    const clamped = Math.max(-1, Math.min(1, cos));
    return Math.acos(clamped) * 180 / Math.PI;
  }

  // Factory function: cria uma instance INDEPENDENTE de AutoPilot.
  function createAutoPilot() {
    let activeKindProvider = function () { return 'walk'; };
    function setActiveKindProvider(fn) { if (typeof fn === 'function') activeKindProvider = fn; }

    function getCarConfig() {
      return (global.FakeGPS && global.FakeGPS.CarConfig) ? global.FakeGPS.CarConfig.getConfig() : null;
    }

    function resolveApproachMeters() {
      if (activeKindProvider() === 'car') {
        const cc = getCarConfig();
        if (cc && typeof cc.approachMeters === 'number') return cc.approachMeters;
      }
      return DEFAULT_APPROACH_SLOWDOWN_METERS;
    }

    function resolveCurveSlowdownMin() {
      if (activeKindProvider() === 'car') {
        const cc = getCarConfig();
        if (cc && typeof cc.curveSlowdownMin === 'number') return cc.curveSlowdownMin;
      }
      return DEFAULT_MIN_MAGNITUDE_IN_CURVE;
    }

    function curveSlowdownFactor(angleDeg) {
      const minMag = resolveCurveSlowdownMin();
      if (angleDeg <= 10) return 1;
      if (angleDeg >= CURVE_FULL_SLOWDOWN_DEG) return minMag;
      const t = (angleDeg - 10) / (CURVE_FULL_SLOWDOWN_DEG - 10);
      return 1 - t * (1 - minMag);
    }

    const state = {
      active: false,
      waypoints: [],
      currentIdx: 0,
      onComplete: null,
      onProgress: null
    };

    function start(waypoints, opts) {
      opts = opts || {};
      if (!Array.isArray(waypoints) || waypoints.length < 2) return false;
      state.waypoints = waypoints;
      state.currentIdx = 1;
      state.active = true;
      state.onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;
      state.onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
      return true;
    }

    function stop() {
      const wasActive = state.active;
      state.active = false;
      state.waypoints = [];
      state.currentIdx = 0;
      state.onComplete = null;
      state.onProgress = null;
      return wasActive;
    }

    function isActive() {
      return state.active && state.currentIdx < state.waypoints.length;
    }

    function computeInput(currentLat, currentLon) {
      if (!isActive()) return null;

      const target = state.waypoints[state.currentIdx];
      const dist = distanceMeters(currentLat, currentLon, target.lat, target.lon);

      if (dist < WAYPOINT_REACHED_METERS) {
        state.currentIdx++;
        if (state.onProgress) {
          state.onProgress(state.currentIdx, state.waypoints.length);
        }
        if (state.currentIdx >= state.waypoints.length) {
          const cb = state.onComplete;
          stop();
          if (cb) cb();
          return null;
        }
      }

      const next = state.waypoints[state.currentIdx];
      const heading = computeHeading(currentLat, currentLon, next.lat, next.lon);
      const headingRad = heading * Math.PI / 180;

      let magnitude = 1;

      const isLast = state.currentIdx === state.waypoints.length - 1;
      const approachMeters = resolveApproachMeters();
      if (isLast && dist < approachMeters) {
        const t = dist / approachMeters;
        magnitude *= Math.max(0.25, t);
      }

      return {
        x: Math.sin(headingRad),
        y: Math.cos(headingRad),
        magnitude: magnitude,
        heading: heading
      };
    }

    function getProgress() {
      return {
        active: state.active,
        current: state.currentIdx,
        total: state.waypoints.length
      };
    }

    function getRemainingDistanceMeters(currentLat, currentLon) {
      if (!isActive()) return 0;
      const first = state.waypoints[state.currentIdx];
      if (!first) return 0;
      let total = distanceMeters(currentLat, currentLon, first.lat, first.lon);
      for (let i = state.currentIdx; i < state.waypoints.length - 1; i++) {
        const a = state.waypoints[i];
        const b = state.waypoints[i + 1];
        total += distanceMeters(a.lat, a.lon, b.lat, b.lon);
      }
      return total;
    }

    function destroy() {
      stop();
    }

    return {
      start: start,
      stop: stop,
      isActive: isActive,
      computeInput: computeInput,
      getProgress: getProgress,
      getRemainingDistanceMeters: getRemainingDistanceMeters,
      setActiveKindProvider: setActiveKindProvider,
      destroy: destroy,
      WAYPOINT_REACHED_METERS: WAYPOINT_REACHED_METERS
    };
  }

  global.FakeGPS = global.FakeGPS || {};
  global.FakeGPS.createAutoPilot = createAutoPilot;
  // Instance default pra compat
  global.FakeGPS.AutoPilot = createAutoPilot();
})(window);
