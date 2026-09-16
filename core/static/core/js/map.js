/* ==========================================================================
   EVACROUTE — map setup + rendering
   Creates the Leaflet map and keeps every overlay (zones, route, user dot)
   in sync with `state`.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var geometry = App.geometry;
  var util = App.util;
  var $ = App.$;

  /* ------------------------------- markers ------------------------------ */
  function userIcon() {
    return L.divIcon({
      className: 'user-marker',
      html: '<div class="user-dot"><span class="user-pulse"></span></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function safeIcon(isNearest) {
    return L.divIcon({
      className: 'safe-marker-wrap',
      html: '<div class="safe-pin' + (isNearest ? ' nearest' : '') + '">✓</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -14]
    });
  }

  /* ------------------------------ map instance -------------------------- */
  function initMap() {
    var map = L.map('map', {
      zoomControl: false,
      minZoom: cfg.MIN_ZOOM,
      maxZoom: cfg.MAX_ZOOM,
      worldCopyJump: false,
      fadeAnimation: true,
      markerZoomAnimation: true
    });
    state.map = map;

    state.tileProviderIndex = resolveTileProviderIndex();
    pickWorkingTileProvider(state.tileProviderIndex, function (idx) {
      if (!state.map) return;
      attachTileProvider(idx === null ? resolveTileProviderIndex() : idx);
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 130 }).addTo(map);
    map.setView(cfg.FALLBACK_CENTER, cfg.FALLBACK_ZOOM);

    map.on('click', App.admin.onMapClick);
    map.on('dblclick', App.admin.onMapDblClick);
    map.on('mousemove', App.admin.onMapMouseMove);
    map.on('moveend', saveViewLater);
    return map;
  }

  /* ---------------------------- basemap ---------------------------------
     Before any tile layer is drawn, each provider is probed with one hidden
     test tile. A provider that answers HTTP 403 ("Access blocked") or times
     out is skipped silently, so the user never sees error tiles or a blank
     basemap. The first provider that loads is used, and remembered so later
     visits start there directly. `?tiles=<id>` pins one explicitly. */
  function resolveTileProviderIndex() {
    var wanted = (cfg.params.get('tiles') || '').toLowerCase();
    if (wanted) {
      for (var i = 0; i < cfg.TILE_PROVIDERS.length; i++) {
        if (cfg.TILE_PROVIDERS[i].id === wanted) return i;
      }
    }
    var remembered = App.storage.readStorage(cfg.TILE_KEY);
    if (remembered) {
      for (var j = 0; j < cfg.TILE_PROVIDERS.length; j++) {
        if (cfg.TILE_PROVIDERS[j].id === remembered) return j;
      }
    }
    return 0;
  }

  /** Build one concrete, loadable tile URL for `provider` near the map centre. */
  function probeTileUrl(provider) {
    var z = 10;
    var lat = cfg.FALLBACK_CENTER[0];
    var lng = cfg.FALLBACK_CENTER[1];
    var n = Math.pow(2, z);
    var x = Math.floor(((lng + 180) / 360) * n);
    var latRad = (lat * Math.PI) / 180;
    var y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    x = Math.max(0, Math.min(n - 1, x));
    y = Math.max(0, Math.min(n - 1, y));
    var s = (provider.subdomains || 'abc').charAt(0);
    return provider.url
      .replace('{s}', s)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
      .replace('{r}', '');
  }

  /** Resolve `true` iff a test tile from `provider` actually loads (7s budget). */
  function probeTile(provider, ok, fail) {
    var img = new Image();
    var settled = false;
    var timer = setTimeout(function () {
      settle(false);
    }, 7000);
    function settle(good) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      (good ? ok : fail)();
    }
    img.onload = function () {
      settle(true);
    };
    img.onerror = function () {
      settle(false);
    };
    img.src = probeTileUrl(provider);
  }

  /**
   * Probe providers from `start` onward and hand the first working index to
   * `done`. Wraps once to probe the providers before `start`, then resolves
   * with `null` when every provider fails (without drawing anything).
   */
  function pickWorkingTileProvider(start, done) {
    var len = cfg.TILE_PROVIDERS.length;
    var first = start === null || start < 0 || start >= len ? 0 : start;
    function attempt(idx, stop) {
      if (idx >= stop) {
        if (stop === len && first > 0) {
          attempt(0, first); // second pass: everything before `start`
          return;
        }
        done(null);
        return;
      }
      probeTile(cfg.TILE_PROVIDERS[idx], function () {
        done(idx);
      }, function () {
        attempt(idx + 1, stop);
      });
    }
    attempt(first, len);
  }

  /** Create the tile layer for `index` (or `fallbackFrom` when it just failed). */
  function attachTileProvider(index, fallbackFrom) {
    var provider = index === null ? null : cfg.TILE_PROVIDERS[index];
    if (!provider || !state.map) return false;

    if (state.tileLayer) {
      try {
        state.map.removeLayer(state.tileLayer);
      } catch (e) {
        /* layer already gone */
      }
      state.tileLayer = null;
    }

    state.tileProviderIndex = index;
    state.tileProvider = provider;
    state.tileFailures = 0;

    var options = {
      minZoom: cfg.MIN_ZOOM,
      maxZoom: provider.maxZoom || 19,
      attribution: provider.attr,
      crossOrigin: true
    };
    if (provider.subdomains) options.subdomains = provider.subdomains;

    state.tileLayer = L.tileLayer(provider.url, options).addTo(state.map);
    state.tileLayer.on('tileerror', onTileError);
    state.tileLayer.on('tileload', onTileLoad);

    if (fallbackFrom) {
      App.ui.toast(
        'Basemap switched to ' +
          provider.label +
          ' — tiles from ' +
          fallbackFrom.label +
          ' are unavailable on this network.',
        'warn'
      );
    }
    return true;
  }

  function onTileLoad() {
    if (state.tileSavedIndex === state.tileProviderIndex) return;
    state.tileSavedIndex = state.tileProviderIndex; // remember what works here
    var id = state.tileProvider ? state.tileProvider.id : null;
    if (id) App.storage.writeStorage(cfg.TILE_KEY, id);
    else App.storage.removeStorage(cfg.TILE_KEY);
  }

  function onTileError() {
    state.tileFailures += 1;
    if (state.tileFailures < cfg.TILE_FAILURE_LIMIT) return;

    var failed = state.tileProvider;
    pickWorkingTileProvider(state.tileProviderIndex + 1, function (idx) {
      if (attachTileProvider(idx, failed)) return;
      if (state.tileErrorShown) return;
      state.tileErrorShown = true;
      App.ui.toast('Map tiles could not be loaded — check your internet connection.', 'warn');
    });
  }

  /* --------------------------- view persistence ------------------------- */
  function saveViewLater() {
    clearTimeout(state.viewTimer);
    state.viewTimer = setTimeout(function () {
      try {
        var c = state.map.getCenter();
        window.localStorage.setItem(
          cfg.VIEW_KEY,
          JSON.stringify({ lat: c.lat, lng: c.lng, zoom: state.map.getZoom() })
        );
      } catch (e) {
        /* storage unavailable — view persistence is optional */
      }
    }, 700);
  }

  function restoreView() {
    var raw = App.storage.readStorage(cfg.VIEW_KEY);
    if (!raw) return false;
    try {
      var v = JSON.parse(raw);
      if (!util.isFiniteLatLng(v.lat, v.lng)) return false;
      state.map.setView(
        [v.lat, v.lng],
        util.clamp(Number(v.zoom) || cfg.FALLBACK_ZOOM, cfg.MIN_ZOOM, cfg.MAX_ZOOM)
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------- popups ------------------------------- */
  function zonePopupHtml(zone) {
    var meta;
    if (zone.kind === 'danger') {
      meta =
        zone.vertices.length +
        ' points · ' +
        (geometry.polygonAreaMeters2(zone.vertices) / 1e6).toFixed(2) +
        ' km²';
    } else {
      meta = zone.vertices[0][0].toFixed(5) + ', ' + zone.vertices[0][1].toFixed(5);
    }

    var html =
      '<b>' +
      util.escapeHtml(zone.name) +
      '</b>' +
      '<div class="pop-meta">' +
      (zone.kind === 'danger' ? 'Danger zone · ' : 'Safe zone · ') +
      meta +
      '</div>';

    if (state.mode === 'admin') {
      html +=
        '<div class="pop-actions">' +
        '<button class="btn" type="button" data-action="zoom-zone" data-id="' +
        zone.id +
        '">🎯 Zoom</button>' +
        '<button class="btn" type="button" data-action="rename-zone" data-id="' +
        zone.id +
        '">✎ Rename</button>' +
        '<button class="btn btn-ghost" type="button" data-action="delete-zone" data-id="' +
        zone.id +
        '">🗑 Delete</button>' +
        '</div>';
    }
    return html;
  }

  /* ---------------------------- zone layers ----------------------------- */
  function addZoneLayer(zone) {
    var map = state.map;
    if (!map) return;

    if (zone.kind === 'danger') {
      var layer = L.polygon(zone.vertices, cfg.DANGER_STYLE).addTo(map);
      layer.bindPopup(zonePopupHtml(zone));
      state.layers.danger.set(zone.id, layer);
    } else {
      var marker = L.marker(zone.vertices[0], {
        icon: safeIcon(false),
        riseOnHover: true,
        title: zone.name
      }).addTo(map);
      marker.bindPopup(zonePopupHtml(zone));
      marker.bindTooltip(zone.name, { direction: 'top', offset: [0, -14] });
      state.layers.safe.set(zone.id, marker);
    }
  }

  /** Redraw every zone layer from state (after any zone mutation). */
  function renderAllZones() {
    var map = state.map;
    if (!map) return;

    state.layers.danger.forEach(function (layer) {
      map.removeLayer(layer);
    });
    state.layers.safe.forEach(function (layer) {
      map.removeLayer(layer);
    });
    state.layers.danger.clear();
    state.layers.safe.clear();

    state.zones.forEach(addZoneLayer);

    // keep references fresh when a reload/import replaced the zone objects
    state.inside = state.inside
      .map(function (z) {
        return App.zones.findZone(z.id);
      })
      .filter(Boolean);

    if (state.nearest) {
      var fresh = App.zones.findZone(state.nearest.zone.id);
      if (fresh) state.nearest.zone = fresh;
      else state.nearest = null;
    }

    applyZoneStyles();
  }

/** Highlight the danger polygon(s) containing the user and the nearest exit. */
  function applyZoneStyles() {
    state.layers.danger.forEach(function (layer, id) {
      var isInside = state.inside.some(function (z) {
        return z.id === id;
      });
      layer.setStyle(
        isInside ? Object.assign({}, cfg.DANGER_STYLE, cfg.DANGER_ALERT_STYLE) : cfg.DANGER_STYLE
      );
      var el = layer.getElement && layer.getElement();
      if (el && el.classList) {
        el.classList.add('dz-poly');
        el.classList.toggle('dz-alert', isInside);
      }
    });

    state.layers.safe.forEach(function (layer, id) {
      var isNearest = !!(state.nearest && state.nearest.zone && state.nearest.zone.id === id);
      var el = layer.getElement && layer.getElement();
      if (el) {
        var pin = el.querySelector('.safe-pin');
        if (pin) pin.classList.toggle('nearest', isNearest);
      }
      if (layer.setZIndexOffset) layer.setZIndexOffset(isNearest ? 600 : 0);
    });
  }

  /* ------------------------- user marker + route ------------------------ */
  function updateUserMarker() {
    if (!state.map || !state.user) return;
    var ll = [state.user.lat, state.user.lng];
    if (!state.userMarker) {
      state.userMarker = L.marker(ll, {
        icon: userIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(state.map);
    } else {
      state.userMarker.setLatLng(ll);
    }
  }

  function drawRoute(from, to) {
    clearRoute();
    if (!state.map) return;
    state.routeLine = L.polyline([from, to], cfg.ROUTE_STYLE).addTo(state.map);
    state.routeEnd = L.circleMarker(to, {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#22c55e',
      fillOpacity: 1
    }).addTo(state.map);
  }

  function clearRoute() {
    if (state.routeLine && state.map) state.map.removeLayer(state.routeLine);
    if (state.routeEnd && state.map) state.map.removeLayer(state.routeEnd);
    state.routeLine = null;
    state.routeEnd = null;
  }
/* ------------------------------ viewport ------------------------------ */
  function fitAllZones(animate) {
    if (!state.map || !state.zones.length) return false;
    var pts = [];
    state.zones.forEach(function (z) {
      z.vertices.forEach(function (v) {
        pts.push(v);
      });
    });
    if (!pts.length) return false;
    state.map.fitBounds(L.latLngBounds(pts), {
      padding: [70, 70],
      maxZoom: 16,
      animate: animate !== false
    });
    return true;
  }

  function focusZone(id) {
    var zone = App.zones.findZone(id);
    if (!zone || !state.map) return;
    if (zone.kind === 'safe') {
      state.map.setView(zone.vertices[0], Math.max(state.map.getZoom(), 15), { animate: true });
      return;
    }
    state.map.fitBounds(L.latLngBounds(zone.vertices), {
      padding: [80, 80],
      maxZoom: 16,
      animate: true
    });
  }

  /** Keep Leaflet's bottom controls clear of the floating action panel. */
  function syncControlOffset() {
    var panel = $('bottomPanel');
    var h = panel ? panel.offsetHeight : 0;
    var offset = window.innerWidth <= 640 ? h + 18 : 0;
    document.documentElement.style.setProperty('--ctrl-offset', offset + 'px');
  }

  App.map = {
    userIcon: userIcon,
    safeIcon: safeIcon,
    initMap: initMap,
    resolveTileProviderIndex: resolveTileProviderIndex,
    attachTileProvider: attachTileProvider,
    saveViewLater: saveViewLater,
    restoreView: restoreView,
    zonePopupHtml: zonePopupHtml,
    addZoneLayer: addZoneLayer,
    renderAllZones: renderAllZones,
    applyZoneStyles: applyZoneStyles,
    updateUserMarker: updateUserMarker,
    drawRoute: drawRoute,
    clearRoute: clearRoute,
    fitAllZones: fitAllZones,
    focusZone: focusZone,
    syncControlOffset: syncControlOffset
  };
})(window.EvacRoute = window.EvacRoute || {});