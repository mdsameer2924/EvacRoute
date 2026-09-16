/* ==========================================================================
   EVACROUTE — user flow
   Location acquisition (GPS / manual / demo), the safety verdict, the
   nearest-safe-zone calculation and the status panel.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var geometry = App.geometry;
  var util = App.util;
  var icons = App.icons;
  var $ = App.$;

  /* --------------------------- nearest safe zone ------------------------ */
  /** Closest safe zone to a [lat,lng] point, with distance + bearing. */
  function findNearestSafe(point) {
    var best = null;
    state.zones.forEach(function (z) {
      if (z.kind !== 'safe' || !z.vertices.length) return;
      var target = z.vertices[0];
      var distance = geometry.haversineMeters(point, target);
      if (!best || distance < best.distance) {
        best = {
          zone: z,
          distance: distance,
          bearing: geometry.bearingDegrees(point, target)
        };
      }
    });
    return best;
  }

  /* ------------------------- verdict computation ------------------------ */
  /** Core decision logic: which zones contain the user, and where to evacuate. */
  function evaluateUser(moveMap) {
    if (!state.user) {
      updatePanel();
      return;
    }
    var p = [state.user.lat, state.user.lng];

    state.inside = state.zones.filter(function (z) {
      return z.kind === 'danger' && geometry.isPointInPolygon(p, z.vertices);
    });
    state.nearest = findNearestSafe(p);

    App.map.applyZoneStyles();
    if (state.inside.length && state.nearest) {
      App.map.drawRoute(p, state.nearest.zone.vertices[0]);
    } else {
      App.map.clearRoute();
    }

    updatePanel();
    App.admin.renderAdminList();
    focusIfNeeded(moveMap);
  }

  /** Frame the user together with the relevant zones (only when that changes). */
  function focusIfNeeded(moveMap) {
    if (!state.map) return;

    var key =
      (state.inside.length
        ? state.inside
            .map(function (z) {
              return z.id;
            })
            .sort()
            .join(',')
        : 'safe') +
      '|' +
      (state.nearest ? state.nearest.zone.id : 'none');

    if (!moveMap || key === state.lastFitKey) return;
    state.lastFitKey = key;

    var pts = [[state.user.lat, state.user.lng]];
    if (state.nearest) pts.push(state.nearest.zone.vertices[0]);
    state.inside.forEach(function (z) {
      z.vertices.forEach(function (v) {
        pts.push(v);
      });
    });

    if (pts.length > 1) {
      state.map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: [40, 160],
        paddingBottomRight: [40, 170],
        maxZoom: 16,
        animate: true
      });
    } else {
      state.map.setView(pts[0], Math.max(state.map.getZoom(), 14), { animate: true });
    }
  }

  /* ---------------------- Google Maps deep links ------------------------ */
  function mapsDirectionsUrl(from, to) {
    return (
      'https://www.google.com/maps/dir/?api=1' +
      '&origin=' +
      from[0].toFixed(6) +
      ',' +
      from[1].toFixed(6) +
      '&destination=' +
      to[0].toFixed(6) +
      ',' +
      to[1].toFixed(6) +
      '&travelmode=walking&dir_action=navigate'
    );
  }

  function mapsSearchUrl(p) {
    return (
      'https://www.google.com/maps/search/?api=1&query=' + p[0].toFixed(6) + ',' + p[1].toFixed(6)
    );
  }

  /* --------------------------- status panel ----------------------------- */
  function updatePanel() {
    var badge = $('statusBadge');
    var line = $('statusLine');
    var summary = $('routeSummary');
    var dirText = $('dirText');
    var dirDeg = $('dirDeg');
    var arrow = $('dirArrow');
    var coords = $('coordsLine');
    if (!badge || !line) return;

    var hasUser = !!state.user;
    var inDanger = state.inside.length > 0;
    var safeCount = state.zones.filter(function (z) {
      return z.kind === 'safe';
    }).length;
    var dangerCount = state.zones.filter(function (z) {
      return z.kind === 'danger';
    }).length;

    badge.className = 'badge';
    line.className = '';
    if (arrow) arrow.classList.remove('danger');

    if (!hasUser) {
      badge.classList.add('badge-neutral');
      badge.textContent = 'LOCATING';
      line.textContent = 'Detecting your location\u2026';
    } else if (inDanger) {
      badge.classList.add('badge-danger');
      badge.textContent = 'DANGER';
      line.classList.add('danger');
      line.textContent = icons.warning + ' YOU ARE IN A DANGER ZONE';
      if (arrow) arrow.classList.add('danger');
    } else {
      badge.classList.add('badge-safe');
      badge.textContent = 'SAFE';
      line.classList.add('safe');
      line.textContent = icons.ok + ' YOU ARE IN A SAFE AREA';
    }

    var text;
    if (!hasUser) text = 'Waiting for your location\u2026';
    else if (!state.zones.length)
      text = 'No zones configured yet \u2014 open the Admin panel to mark danger and safe zones.';
    else if (state.nearest)
      text =
        'Nearest safe zone: <b>' +
        util.escapeHtml(state.nearest.zone.name) +
        '</b> \u2014 ' +
        geometry.formatDistance(state.nearest.distance) +
        ' away';
    else if (inDanger)
      text =
        icons.warning +
        ' No safe zones defined \u2014 move away from the danger area and call for help.';
    else text = 'No safe zones defined yet \u2014 ask your admin to add one.';
    summary.innerHTML = text;

    if (state.nearest) {
      dirText.textContent = geometry.directionText(state.nearest.bearing);
      dirDeg.textContent = Math.round(state.nearest.bearing) + '\u00B0 true north';
      arrow.style.transform = 'rotate(' + state.nearest.bearing.toFixed(1) + 'deg)';
    } else {
      dirText.textContent = '\u2014';
      dirDeg.textContent = '';
      arrow.style.transform = 'rotate(0deg)';
    }

    var source = !state.user
      ? ''
      : state.user.source === 'gps'
        ? 'GPS'
        : state.user.source === 'manual'
          ? 'manual entry'
          : state.user.source === 'url'
            ? 'URL parameters'
            : state.user.source === 'demo'
              ? 'demo point'
              : 'position';
    coords.textContent =
      (hasUser
        ? state.user.lat.toFixed(5) +
          ', ' +
          state.user.lng.toFixed(5) +
          (state.user.accuracy ? ' \u00B7 \u00B1' + Math.round(state.user.accuracy) + ' m' : '') +
          ' \u00B7 ' +
          source
        : 'No position yet') +
      ' \u00B7 ' +
      dangerCount +
      ' danger / ' +
      safeCount +
      ' safe zones';

    var mapsBtn = $('btnMaps');
    if (mapsBtn) {
      if (inDanger && state.nearest) {
        mapsBtn.hidden = false;
        mapsBtn.textContent = icons.compass + ' Open route in Google Maps';
        mapsBtn.setAttribute(
          'href',
          mapsDirectionsUrl([state.user.lat, state.user.lng], state.nearest.zone.vertices[0])
        );
      } else if (inDanger) {
        mapsBtn.hidden = false;
        mapsBtn.textContent = icons.locate + ' Open my location in Google Maps';
        mapsBtn.setAttribute('href', mapsSearchUrl([state.user.lat, state.user.lng]));
      } else {
        mapsBtn.hidden = true;
        mapsBtn.setAttribute('href', '#');
      }
    }
    App.map.syncControlOffset();
  }

  /* ------------------------- location acquisition ----------------------- */
  function setUserLocation(lat, lng, accuracy, source) {
    state.user = { lat: lat, lng: lng, accuracy: accuracy || null, source: source || 'position' };
    App.map.updateUserMarker();
    App.ui.hideBoot();
    evaluateUser(true);
    state.lastEval = Date.now();
  }

  function startUserFlow() {
    if (cfg.HAS_PARAM_LOC) {
      setUserLocation(cfg.PARAM_LAT, cfg.PARAM_LNG, null, 'url');
      updatePanel();
      return;
    }
    if (!('geolocation' in navigator)) {
      App.ui.showGeoModal(
        'This browser does not support geolocation. Enter coordinates manually or use the demo location.'
      );
      App.ui.hideBoot();
      return;
    }
    requestGps();
  }

  function requestGps(fromButton) {
    var btn = $('btnLocate');
    if (btn) {
      btn.disabled = true;
      btn.textContent = icons.satellite + ' Locating\u2026';
    }
    App.ui.setBootMsg('Detecting your location\u2026', 'Please allow location access');
    if (!state.user) App.ui.showBootOverlay();
    state.locating = true;
    try {
      navigator.geolocation.getCurrentPosition(onGeoOk, onGeoErr, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    } catch (e) {
      onGeoErr({ code: 0, message: e && e.message ? e.message : 'geolocation threw' });
    }
    if (fromButton) App.toast('Requesting a fresh GPS fix\u2026');
  }

  function restoreLocateButton() {
    var btn = $('btnLocate');
    if (btn) {
      btn.disabled = false;
      btn.textContent = icons.locate + ' Locate me again';
    }
  }

  function onGeoOk(pos) {
    state.locating = false;
    restoreLocateButton();
    App.ui.hideGeoModal();
    var hadFix = !!state.user;
    setUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'gps');
    startWatch();
    if (hadFix) App.toast('Location updated ' + icons.check, 'ok');
  }

  function onGeoErr(err) {
    state.locating = false;
    restoreLocateButton();
    App.ui.hideBoot();
    var msg = 'Could not get your location.';
    if (window.isSecureContext === false) {
      msg =
        'Geolocation only works on https:// or localhost. This page is not a secure origin, so GPS is blocked \u2014 enter coordinates below or use the demo location.';
    } else if (err && err.code === 1) {
      msg = 'Location permission denied. Allow access in your browser settings, or enter coordinates below.';
    } else if (err && err.code === 2) {
      msg = 'Your position is unavailable right now (no GPS or network fix).';
    } else if (err && err.code === 3) {
      msg = 'The location request timed out. Move somewhere with a clearer signal and try again.';
    }
    App.ui.showGeoModal(msg);
  }

  /** Live tracking so the guidance stays current while the user moves. */
  function startWatch() {
    stopWatch();
    if (!('geolocation' in navigator)) return;
    try {
      state.watchId = navigator.geolocation.watchPosition(onWatch, function () {}, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000
      });
    } catch (e) {
      state.watchId = null;
    }
  }

  function stopWatch() {
    if (state.watchId !== null && 'geolocation' in navigator) {
      try {
        navigator.geolocation.clearWatch(state.watchId);
      } catch (e) {}
    }
    state.watchId = null;
  }

  function onWatch(pos) {
    if (!pos || !pos.coords) return;
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var moved = state.user ? geometry.haversineMeters([state.user.lat, state.user.lng], [lat, lng]) : Infinity;
    var wasInside = state.inside.length > 0;
    state.user = { lat: lat, lng: lng, accuracy: pos.coords.accuracy, source: 'gps' };
    App.map.updateUserMarker();

    var now = Date.now();
    if (moved > 20 || now - state.lastEval > 3000) {
      state.lastEval = now;
      evaluateUser(moved > 60);
      var isInside = state.inside.length > 0;
      if (isInside !== wasInside) {
        App.toast(
          isInside ? icons.warning + ' You just entered a danger zone.' : icons.ok + ' You have left the danger zone.',
          isInside ? 'err' : 'ok'
        );
        if (isInside && navigator.vibrate) {
          try {
            navigator.vibrate([120, 60, 120]);
          } catch (e) {}
        }
      }
    }
  }

  /* -------------------------- fallback modal ----------------------------- */
  function useManualCoords() {
    var latEl = $('manualLat');
    var lngEl = $('manualLng');
    var lat = Number.parseFloat(latEl && latEl.value);
    var lng = Number.parseFloat(lngEl && lngEl.value);
    if (!util.isFiniteLatLng(lat, lng)) {
      App.toast('Enter a valid latitude (-90\u202690) and longitude (-180\u2026180).', 'err');
      return;
    }
    stopWatch();
    App.ui.hideGeoModal();
    setUserLocation(lat, lng, null, 'manual');
    App.toast('Using manually entered coordinates.', 'ok');
  }

  function useDemoLocation() {
    stopWatch();
    App.ui.hideGeoModal();
    setUserLocation(cfg.DEMO_LOCATION.lat, cfg.DEMO_LOCATION.lng, null, 'demo');
    App.toast(
      state.zones.length
        ? 'Demo location loaded \u2014 you are inside a demo danger zone.'
        : 'Demo location loaded (no zones configured yet).',
      'ok'
    );
  }

  App.user = {
    updatePanel: updatePanel,
    setUserLocation: setUserLocation,
    startUserFlow: startUserFlow,
    requestGps: requestGps,
    restoreLocateButton: restoreLocateButton,
    onGeoOk: onGeoOk,
    onGeoErr: onGeoErr,
    evaluateUser: evaluateUser,
    startWatch: startWatch,
    stopWatch: stopWatch,
    useManualCoords: useManualCoords,
    useDemoLocation: useDemoLocation,
    findNearestSafe: findNearestSafe
  };
})(window.EvacRoute = window.EvacRoute || {});