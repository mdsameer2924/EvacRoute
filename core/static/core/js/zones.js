/* ==========================================================================
   EVACROUTE — zone data operations
   Create / rename / delete zones, and export / import them as GeoJSON.
   Mutations funnel through commitZones() so persistence, rendering and the
   user's safety verdict never drift out of sync.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var storage = App.storage;
  var util = App.util;

  /* -------------------------------- naming ------------------------------ */
  function uniqueZoneName(base, existing) {
    if (existing.indexOf(base) < 0) return base;
    var i = 2;
    while (existing.indexOf(base + ' ' + i) > -1) i++;
    return base + ' ' + i;
  }

  /** Next free auto-generated name for a kind ("Danger Zone 3", "Safe Zone C"). */
  function nextZoneName(kind) {
    var existing = state.zones
      .filter(function (z) {
        return z.kind === kind;
      })
      .map(function (z) {
        return z.name;
      });

    if (kind === 'danger') {
      var n = 1;
      while (existing.indexOf('Danger Zone ' + n) > -1) n++;
      return 'Danger Zone ' + n;
    }

    for (var i = 0; i < 26; i++) {
      var label = 'Safe Zone ' + String.fromCharCode(65 + i);
      if (existing.indexOf(label) < 0) return label;
    }
    var fallback = 1;
    while (existing.indexOf('Safe Zone ' + fallback) > -1) fallback++;
    return 'Safe Zone ' + fallback;
  }

  /* --------------------------------- CRUD ------------------------------- */
  function addZone(kind, name, vertices) {
    var existingNames = state.zones.map(function (z) {
      return z.name;
    });
    var zone = {
      id: util.uid(),
      kind: kind === 'safe' ? 'safe' : 'danger',
      name: name && name.trim() ? name.trim() : nextZoneName(kind),
      vertices: vertices.map(function (v) {
        return [v[0], v[1]];
      }),
      createdAt: new Date().toISOString()
    };
    zone.name = uniqueZoneName(zone.name, existingNames);
    state.zones.push(zone);
    return zone;
  }

  function findZone(id) {
    for (var i = 0; i < state.zones.length; i++) {
      if (state.zones[i].id === id) return state.zones[i];
    }
    return null;
  }

  /** Remove a zone's Leaflet layers from the map. Idempotent. */
  function removeZoneLayers(id) {
    var dangerLayer = state.layers.danger.get(id);
    if (dangerLayer && state.map) state.map.removeLayer(dangerLayer);
    var safeLayer = state.layers.safe.get(id);
    if (safeLayer && state.map) state.map.removeLayer(safeLayer);
  }

  function deleteZone(id) {
    var zone = findZone(id);
    if (!zone) return;
    state.zones = state.zones.filter(function (z) {
      return z.id !== id;
    });
    removeZoneLayers(id);
    state.layers.danger.delete(id);
    state.layers.safe.delete(id);
    commitZones('Deleted "' + zone.name + '".');
  }

  function renameZone(id) {
    var zone = findZone(id);
    if (!zone) return;
    var input = window.prompt('Zone label', zone.name);
    if (input === null) return;
    var name = input.trim();
    if (!name || name === zone.name) return;
    zone.name = name;
    commitZones('Renamed to "' + name + '".');
  }

  function clearAllZones() {
    if (!state.zones.length) {
      App.ui.toast('There are no zones to clear.', 'warn');
      return;
    }
    if (!window.confirm('Remove all ' + state.zones.length + ' zones (danger + safe)?')) return;
    state.zones = [];
    state.layers.danger.forEach(function (layer) {
      if (state.map) state.map.removeLayer(layer);
    });
    state.layers.safe.forEach(function (layer) {
      if (state.map) state.map.removeLayer(layer);
    });
    state.layers.danger.clear();
    state.layers.safe.clear();
    commitZones('All zones cleared.');
  }

  /** Persist, redraw, refresh the admin UI and re-evaluate the user's safety. */
  function commitZones(message) {
    storage.saveZones();
    App.map.renderAllZones();
    App.admin.refreshAdminUI();
    if (state.user) App.user.evaluateUser(false);
    if (message) App.ui.toast(message, 'ok');
  }

  /* --------------------------- export / import -------------------------- */
  /** Compact timestamp for exported file names: 20260915-2040. */
  function stamp() {
    var d = new Date();
    var p = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() +
      p(d.getMonth() + 1) +
      p(d.getDate()) +
      '-' +
      p(d.getHours()) +
      p(d.getMinutes())
    );
  }

  function exportZones() {
    if (!state.zones.length) {
      App.ui.toast('Nothing to export yet — draw a zone first.', 'warn');
      return;
    }
    try {
      var json = JSON.stringify(storage.zonesToFeatureCollection(), null, 2);
      var blob = new Blob([json], { type: 'application/geo+json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'evacroute-zones-' + stamp() + '.geojson';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
      App.ui.toast('Exported ' + state.zones.length + ' zone(s) as GeoJSON.', 'ok');
    } catch (e) {
      App.ui.toast('Export failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
    }
  }

  function importZonesFromText(text) {
    var data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      App.ui.toast('That file is not valid JSON.', 'err');
      return;
    }

    var parsed = storage.parseZonePayload(data);
    if (!parsed.length) {
      App.ui.toast('No usable zones found in that file.', 'err');
      return;
    }

    var existingIds = state.zones.map(function (z) {
      return z.id;
    });
    var merged = [];
    parsed.forEach(function (z) {
      if (existingIds.indexOf(z.id) > -1) z.id = util.uid();
      existingIds.push(z.id);
      merged.push(z);
    });

    state.zones = state.zones.concat(merged);
    commitZones('Imported ' + merged.length + ' zone(s).');
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importZonesFromText(String(reader.result));
    };
    reader.onerror = function () {
      App.ui.toast('Could not read that file.', 'err');
    };
    reader.readAsText(file);
  }

  App.zones = {
    uniqueZoneName: uniqueZoneName,
    nextZoneName: nextZoneName,
    addZone: addZone,
    findZone: findZone,
    deleteZone: deleteZone,
    renameZone: renameZone,
    clearAllZones: clearAllZones,
    commitZones: commitZones,
    stamp: stamp,
    exportZones: exportZones,
    importZonesFromText: importZonesFromText,
    handleImportFile: handleImportFile
  };
})(window.EvacRoute = window.EvacRoute || {});