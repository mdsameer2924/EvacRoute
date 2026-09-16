/* ==========================================================================
   EVACROUTE — admin tools
   Drawing danger polygons, placing safe zones, the admin panel and the
   user/admin mode switch.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var util = App.util;
  var icons = App.icons;
  var $ = App.$;

  /* --------------------------- draw previews ---------------------------- */
  /** Remove every live-preview layer (guide polygon, rubber band, vertex dots). */
  function clearDrawLayers() {
    var map = state.map;
    var d = state.drawing;
    if (map) {
      if (d.guide) map.removeLayer(d.guide);
      if (d.rubber) map.removeLayer(d.rubber);
      d.vertexLayers.forEach(function (layer) {
        map.removeLayer(layer);
      });
    }
    d.guide = null;
    d.rubber = null;
    d.vertexLayers = [];
  }

  /** Redraw the preview polygon + rubber band; `cursor` is an optional L.LatLng. */
  function updateDrawPreview(cursor) {
    var map = state.map;
    var d = state.drawing;
    if (!map) return;

    if (d.points.length >= 3) {
      if (!d.guide) d.guide = L.polygon(d.points, cfg.DRAW_GUIDE_STYLE).addTo(map);
      else d.guide.setLatLngs(d.points);
    } else if (d.guide) {
      map.removeLayer(d.guide);
      d.guide = null;
    }

    if (!d.points.length) {
      if (d.rubber) {
        map.removeLayer(d.rubber);
        d.rubber = null;
      }
      return;
    }

    var last = d.points[d.points.length - 1];
    var tip = cursor
      ? [cursor.lat, cursor.lng]
      : d.points.length > 1
        ? d.points[d.points.length - 2]
        : last;
    var line = [last, tip];
    if (cursor && d.points.length >= 3) line.push(d.points[0]); // preview the closing edge
    if (!d.rubber) d.rubber = L.polyline(line, cfg.DRAW_RUBBER_STYLE).addTo(map);
    else d.rubber.setLatLngs(line);
  }

  /** Throw away the in-progress polygon and every preview layer. */
  function resetDrawing() {
    clearDrawLayers();
    state.drawing.active = false;
    state.drawing.points = [];
    if (state.map && state.map.doubleClickZoom) {
      try {
        state.map.doubleClickZoom.enable();
      } catch (e) {
        /* optional */
      }
    }
  }

  /* --------------------------- drawing danger --------------------------- */
  function beginDrawDanger() {
    if (state.mode !== 'admin') return;
    state.placingSafe = false;
    resetDrawing();
    state.drawing.active = true;
    // a double-click ends the polygon, so it must not also zoom the map
    if (state.map && state.map.doubleClickZoom) {
      try {
        state.map.doubleClickZoom.disable();
      } catch (e) {
        /* optional */
      }
    }
    updateDrawState();
    App.ui.toast('Draw mode on — tap the map for each corner, then Finish polygon.');
  }

  function addDrawVertex(latlng) {
    if (!latlng || !util.isFiniteLatLng(latlng.lat, latlng.lng)) return;
    var d = state.drawing;
    if (!d.active) return;
    var point = [latlng.lat, latlng.lng];
    d.points.push(point);
    if (state.map) d.vertexLayers.push(L.circleMarker(point, cfg.VERTEX_STYLE).addTo(state.map));
    updateDrawPreview(null);
    updateDrawState();
  }

  function undoVertex() {
    var d = state.drawing;
    if (!d.active || !d.points.length) return;
    d.points.pop();
    var layer = d.vertexLayers.pop();
    if (layer && state.map) state.map.removeLayer(layer);
    updateDrawPreview(null);
    updateDrawState();
  }

  function finishPolygon() {
    var d = state.drawing;
    if (!d.active) return;
    // a double-click fires click twice, so trailing duplicates are dropped here
    var points = App.geometry.dedupeTrailingVertices(d.points);
    if (points.length < 3) {
      App.ui.toast('A danger zone needs at least 3 corners — tap the map to add more.', 'warn');
      return;
    }
    var zone = App.zones.addZone('danger', null, points);
    resetDrawing();
    App.zones.commitZones('Danger zone "' + zone.name + '" saved.');
    updateDrawState();
  }

  function cancelDrawing(silent) {
    var wasActive = state.drawing.active;
    resetDrawing();
    updateDrawState();
    if (wasActive && !silent) App.ui.toast('Drawing cancelled.', 'warn');
  }

  /* ---------------------------- placing safe ---------------------------- */
  function togglePlaceSafe() {
    if (state.mode !== 'admin') return;
    if (state.drawing.active) cancelDrawing(true);
    state.placingSafe = !state.placingSafe;
    updateDrawState();
    if (state.placingSafe) {
      App.ui.toast('Safe-zone mode on — tap the map to drop a marker.');
    }
  }

  function placeSafeZone(latlng) {
    if (!latlng || !util.isFiniteLatLng(latlng.lat, latlng.lng)) return;
    var labelEl = $('safeLabel');
    var label = labelEl ? labelEl.value : '';
    var zone = App.zones.addZone('safe', label, [[latlng.lat, latlng.lng]]);
    if (labelEl) labelEl.value = '';
    App.zones.commitZones('Safe zone "' + zone.name + '" placed.');
  }

  /* ------------------------- tool state reflection ----------------------- */
  /** Reflect the active admin tool in the panel (hint text, buttons, highlights). */
  function updateDrawState() {
    var d = state.drawing;
    var hint = $('drawState');
    var actions = $('drawActions');
    var finish = $('btnFinishPoly');
    var undo = $('btnUndoVertex');
    var drawBtn = $('btnDrawDanger');
    var placeBtn = $('btnPlaceSafe');

    if (hint) {
      if (d.active) {
        hint.textContent = d.points.length
          ? d.points.length +
            ' corner' +
            (d.points.length === 1 ? '' : 's') +
            ' placed — ' +
            (d.points.length >= 3
              ? 'finish, undo or keep tapping.'
              : 'add at least ' + (3 - d.points.length) + ' more.')
          : 'Tap the map to add the first corner of the danger zone.';
      } else if (state.placingSafe) {
        hint.textContent = 'Tap the map to drop a safe zone (the label above is optional).';
      } else {
        hint.textContent = 'Tap the map to start drawing a danger zone.';
      }
    }

    if (actions) actions.hidden = !d.active;
    if (finish) finish.disabled = d.points.length < 3;
    if (undo) undo.disabled = d.points.length === 0;
    if (drawBtn) drawBtn.classList.toggle('active', !!d.active);
    if (placeBtn) placeBtn.classList.toggle('active', !!state.placingSafe);
  }

  /* --------------------------- map event handlers ----------------------- */
  function onMapClick(e) {
    if (state.mode !== 'admin' || !e || !e.latlng) return;
    if (state.drawing.active) addDrawVertex(e.latlng);
    else if (state.placingSafe) placeSafeZone(e.latlng);
  }

  function onMapDblClick() {
    if (state.mode !== 'admin' || !state.drawing.active) return;
    if (state.drawing.points.length >= 3) finishPolygon();
  }

  function onMapMouseMove(e) {
    if (!state.drawing.active || !e || !e.latlng) return;
    updateDrawPreview(e.latlng);
  }

  /** Keyboard shortcuts: Esc cancels/closes, Enter finishes, Backspace or Z undoes. */
  function handleKeydown(e) {
    if (!e || e.altKey || e.ctrlKey || e.metaKey) return;
    var tag = e.target && e.target.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      if (state.drawing.active) {
        cancelDrawing(false);
        return;
      }
      if (state.placingSafe) {
        state.placingSafe = false;
        updateDrawState();
        return;
      }
      var modal = $('geoModal');
      if (modal && modal.classList.contains('open')) {
        App.ui.hideGeoModal();
        return;
      }
      if (state.map) state.map.closePopup();
      return;
    }

    if (typing || !state.drawing.active) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishPolygon();
    } else if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      undoVertex();
    }
  }

  /* --------------------------- admin panel UI --------------------------- */
  function refreshAdminUI() {
    var dangers = state.zones.filter(function (z) {
      return z.kind === 'danger';
    }).length;
    var safes = state.zones.filter(function (z) {
      return z.kind === 'safe';
    }).length;

    var counts = $('zoneCounts');
    if (counts) {
      counts.textContent =
        dangers +
        ' danger zone' +
        (dangers === 1 ? '' : 's') +
        ', ' +
        safes +
        ' safe zone' +
        (safes === 1 ? '' : 's') +
        ' active';
    }
    renderAdminList();
  }

  function renderAdminList() {
    var host = $('adminList');
    if (!host) return;

    if (!state.zones.length) {
      host.innerHTML = '<div class="hint">No zones yet. Draw a danger zone or place a safe zone.</div>';
      return;
    }

    host.innerHTML = state.zones
      .map(function (z) {
        var isNearest = !!(z.kind === 'safe' && state.nearest && state.nearest.zone.id === z.id);
        var meta =
          z.kind === 'danger'
            ? z.vertices.length + ' pts'
            : isNearest
              ? 'nearest'
              : z.vertices[0][0].toFixed(4) + ', ' + z.vertices[0][1].toFixed(4);

        return (
          '<div class="admin-row">' +
          '<span class="dot ' +
          z.kind +
          '"></span>' +
          '<span class="name">' +
          util.escapeHtml(z.name) +
          '</span>' +
          '<span class="meta">' +
          util.escapeHtml(meta) +
          '</span>' +
          '<button class="icon-btn" type="button" title="Zoom to zone" data-action="zoom-zone" data-id="' +
          z.id +
          '">' +
          icons.target +
          '</button>' +
          '<button class="icon-btn" type="button" title="Rename zone" data-action="rename-zone" data-id="' +
          z.id +
          '">' +
          icons.pencil +
          '</button>' +
          '<button class="icon-btn" type="button" title="Delete zone" data-action="delete-zone" data-id="' +
          z.id +
          '">' +
          icons.trash +
          '</button>' +
          '</div>'
        );
      })
      .join('');
  }

  /* -------------------------------- mode -------------------------------- */
  function setMode(mode) {
    var next = mode === 'admin' ? 'admin' : 'user';
    if (next === 'user' && state.mode === 'admin') {
      cancelDrawing();
      state.placingSafe = false;
    }
    state.mode = next;

    var panel = $('adminPanel');
    if (panel) panel.hidden = state.mode !== 'admin';

    var adminBtn = $('btnAdmin');
    if (adminBtn) {
      adminBtn.textContent =
        state.mode === 'admin' ? icons.person + ' User view' : icons.tools + ' Admin panel';
    }

    try {
      var url = new URL(window.location.href);
      if (state.mode === 'admin') url.searchParams.set('mode', 'admin');
      else url.searchParams.delete('mode');
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      /* history API unavailable — harmless */
    }

    App.map.renderAllZones();
    refreshAdminUI();
    App.map.syncControlOffset();

    if (state.mode === 'admin') {
      App.ui.hideBoot();
      if (!App.map.fitAllZones(true) && !App.map.restoreView()) {
        if (state.user) {
          state.map.setView([state.user.lat, state.user.lng], Math.max(state.map.getZoom(), 14));
        }
      }
      updateDrawState();
    } else if (state.user) {
      App.user.evaluateUser(false);
    }
  }

  App.admin = {
    clearDrawLayers: clearDrawLayers,
    updateDrawPreview: updateDrawPreview,
    resetDrawing: resetDrawing,
    beginDrawDanger: beginDrawDanger,
    addDrawVertex: addDrawVertex,
    undoVertex: undoVertex,
    finishPolygon: finishPolygon,
    cancelDrawing: cancelDrawing,
    togglePlaceSafe: togglePlaceSafe,
    placeSafeZone: placeSafeZone,
    updateDrawState: updateDrawState,
    onMapClick: onMapClick,
    onMapDblClick: onMapDblClick,
    onMapMouseMove: onMapMouseMove,
    handleKeydown: handleKeydown,
    refreshAdminUI: refreshAdminUI,
    renderAdminList: renderAdminList,
    setMode: setMode
  };
})(window.EvacRoute = window.EvacRoute || {});