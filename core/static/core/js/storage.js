/* ==========================================================================
   EVACROUTE — persistence + GeoJSON
   localStorage wrappers plus the conversion between the internal zone shape
   and spec-compliant GeoJSON (RFC 7946, coordinates are [lng, lat]).
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var geometry = App.geometry;
  var util = App.util;

  /* --------------------------- localStorage ----------------------------- */
  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      state.storageOk = false;
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      state.storageOk = false;
      App.ui.toast('Storage is unavailable in this browser — zones will not persist.', 'warn');
      return false;
    }
  }

  function removeStorage(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      state.storageOk = false;
      return false;
    }
  }

  /* ------------------------------ GeoJSON ------------------------------- */
  /** Internal zones -> spec-compliant GeoJSON (coordinates are [lng, lat]). */
  function zonesToFeatureCollection() {
    var features = state.zones.map(function (zone) {
      var props = {
        zoneId: zone.id,
        kind: zone.kind,
        name: zone.name,
        createdAt: zone.createdAt || null
      };
      if (zone.kind === 'safe') {
        return {
          type: 'Feature',
          properties: props,
          geometry: { type: 'Point', coordinates: [zone.vertices[0][1], zone.vertices[0][0]] }
        };
      }
      var ring = zone.vertices.map(function (v) {
        return [v[1], v[0]];
      });
      if (ring.length) ring.push(ring[0].slice()); // GeoJSON rings must be closed
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Polygon', coordinates: [ring] }
      };
    });

    return {
      type: 'FeatureCollection',
      properties: {
        app: 'EVACROUTE',
        version: 1,
        exportedAt: new Date().toISOString(),
        coordinateOrder: 'RFC 7946 [lng, lat]'
      },
      features: features
    };
  }
/** A single GeoJSON Feature -> internal zone (or null when unusable). */
  function featureToZone(feature) {
    if (!feature || feature.type !== 'Feature' || !feature.geometry) return null;

    var p = feature.properties || {};
    var kind = p.kind === 'safe' || p.type === 'safe' ? 'safe' : 'danger';
    var g = feature.geometry;
    var id = typeof p.zoneId === 'string' && p.zoneId ? p.zoneId : util.uid();
    var name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null;

    if (kind === 'safe') {
      var pair = null;
      if (g.type === 'Point') pair = geometry.coordPairToLatLng(g.coordinates);
      else if (g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
        pair = geometry.coordPairToLatLng(g.coordinates[0][0]);
      }
      if (!pair) return null;
      return {
        id: id,
        kind: 'safe',
        name: name || 'Safe Zone',
        vertices: [pair],
        createdAt: p.createdAt || null
      };
    }

    if (g.type !== 'Polygon' || !Array.isArray(g.coordinates) || !g.coordinates.length) return null;
    var ring = g.coordinates[0].map(geometry.coordPairToLatLng).filter(Boolean);
    if (ring.length > 2 && geometry.haversineMeters(ring[0], ring[ring.length - 1]) < 1) ring.pop();
    if (ring.length < 3) return null;
    return {
      id: id,
      kind: 'danger',
      name: name || 'Danger Zone',
      vertices: ring,
      createdAt: p.createdAt || null
    };
  }

  /** Accepts a FeatureCollection, Feature[], or an internal-format array. */
  function parseZonePayload(data) {
    var out = [];
    var feats = [];
    if (!data) return out;
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) feats = data.features;
    else if (data.type === 'Feature') feats = [data];
    else if (Array.isArray(data)) feats = data;

    feats.forEach(function (f) {
      if (f && f.type === 'Feature') {
        var zone = featureToZone(f);
        if (zone) out.push(zone);
        return;
      }
      // internal shape produced by an older version of this app
      if (f && Array.isArray(f.vertices) && f.vertices.length) {
        var kind = f.kind === 'safe' ? 'safe' : 'danger';
        var verts = f.vertices
          .filter(function (v) {
            return util.isFiniteLatLng(v[0], v[1]);
          })
          .map(function (v) {
            return [v[0], v[1]];
          });
        if (kind === 'danger' && verts.length < 3) return;
        if (kind === 'safe' && verts.length < 1) return;
        out.push({
          id: f.id || util.uid(),
          kind: kind,
          name: f.name || (kind === 'safe' ? 'Safe Zone' : 'Danger Zone'),
          vertices: verts,
          createdAt: f.createdAt || null
        });
      }
    });
    return out;
  }

  /* --------------------------- load / save ------------------------------ */
  function saveZones() {
    return writeStorage(cfg.STORAGE_KEY, JSON.stringify(zonesToFeatureCollection()));
  }

  function seedDemoZones() {
    state.zones = cfg.DEMO_ZONES.map(function (z) {
      return {
        id: util.uid(),
        kind: z.kind,
        name: z.name,
        vertices: z.vertices.map(function (v) {
          return [v[0], v[1]];
        }),
        createdAt: new Date().toISOString()
      };
    });
    state.seededDemo = true;
    writeStorage(cfg.SEED_FLAG_KEY, new Date().toISOString());
    saveZones();
  }

  function loadZones() {
    if (cfg.RESET_STORAGE) {
      removeStorage(cfg.STORAGE_KEY);
      removeStorage(cfg.SEED_FLAG_KEY);
    }

    var loaded = [];
    var raw = readStorage(cfg.STORAGE_KEY);
    if (raw) {
      try {
        loaded = parseZonePayload(JSON.parse(raw));
      } catch (e) {
        loaded = [];
        App.ui.toast('Saved zones were unreadable and have been reset.', 'warn');
      }
    }

    var alreadySeeded = !!readStorage(cfg.SEED_FLAG_KEY);
    if (!loaded.length && !cfg.START_EMPTY && !alreadySeeded) {
      seedDemoZones();
      var dangerCount = cfg.DEMO_ZONES.filter(function (z) {
        return z.kind === 'danger';
      }).length;
      var safeCount = cfg.DEMO_ZONES.filter(function (z) {
        return z.kind === 'safe';
      }).length;
      App.ui.toast(
        'Demo zones loaded (' +
          dangerCount +
          ' danger, ' +
          safeCount +
          ' safe) — use Admin Panel to clear or edit them.',
        'ok'
      );
    } else {
      state.zones = loaded;
    }

    if (!state.storageOk && !state.zones.length) {
      App.ui.toast('Storage is blocked — zones work for this session only.', 'warn');
    }
  }

  App.storage = {
    readStorage: readStorage,
    writeStorage: writeStorage,
    removeStorage: removeStorage,
    zonesToFeatureCollection: zonesToFeatureCollection,
    featureToZone: featureToZone,
    parseZonePayload: parseZonePayload,
    saveZones: saveZones,
    seedDemoZones: seedDemoZones,
    loadZones: loadZones
  };
})(window.EvacRoute = window.EvacRoute || {});