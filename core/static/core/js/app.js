/* ==========================================================================
   EVACROUTE — wiring + boot
   DOM event wiring, the delegated [data-action] click handler, viewport
   handling and the boot/init sequence. Loaded last: it starts the app.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var $ = App.$;

  /* ------------------------------- wiring -------------------------------- */
  function handleDelegatedClick(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');
    if (!action || !id) return;
    if (action === 'delete-zone') {
      if (state.map) state.map.closePopup();
      App.zones.deleteZone(id);
    } else if (action === 'rename-zone') {
      App.zones.renameZone(id);
    } else if (action === 'zoom-zone') {
      if (state.map) state.map.closePopup();
      App.map.focusZone(id);
    }
  }

  function handleViewportChange() {
    App.map.syncControlOffset();
    setTimeout(App.map.syncControlOffset, 280);
    if (state.map) state.map.invalidateSize();
  }

  function wireUI() {
    function on(id, evt, fn) {
      var el = $(id);
      if (el) el.addEventListener(evt, fn);
    }

    on('btnLocate', 'click', function () {
      App.user.requestGps(true);
    });
    on('btnAdmin', 'click', function () {
      App.admin.setMode(state.mode === 'admin' ? 'user' : 'admin');
    });
    on('btnHideAdmin', 'click', function () {
      App.admin.setMode('user');
    });

    on('btnDrawDanger', 'click', App.admin.beginDrawDanger);
    on('btnPlaceSafe', 'click', App.admin.togglePlaceSafe);
    on('btnFinishPoly', 'click', function () {
      App.admin.finishPolygon();
    });
    on('btnUndoVertex', 'click', App.admin.undoVertex);
    on('btnCancelDraw', 'click', function () {
      App.admin.cancelDrawing(false);
    });

    on('btnExport', 'click', App.zones.exportZones);
    on('btnImport', 'click', function () {
      var f = $('importFile');
      if (f) f.click();
    });
    on('importFile', 'change', function (e) {
      var file = e.target.files && e.target.files[0];
      App.zones.handleImportFile(file);
      e.target.value = '';
    });
    on('btnClearAll', 'click', App.zones.clearAllZones);
    on('btnFitZones', 'click', function () {
      if (!App.map.fitAllZones(true)) App.toast('No zones to fit.', 'warn');
    });

    on('btnUseManual', 'click', App.user.useManualCoords);
    on('btnUseDemo', 'click', App.user.useDemoLocation);
    on('btnRetryGeo', 'click', function () {
      App.ui.hideGeoModal();
      App.user.requestGps(true);
    });
    on('manualLat', 'keydown', function (e) {
      if (e.key === 'Enter') App.user.useManualCoords();
    });
    on('manualLng', 'keydown', function (e) {
      if (e.key === 'Enter') App.user.useManualCoords();
    });

    document.addEventListener('click', handleDelegatedClick);
    document.addEventListener('keydown', App.admin.handleKeydown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.user) App.user.evaluateUser(false);
    });
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(function () {
          App.map.syncControlOffset();
        }).observe($('bottomPanel'));
      } catch (e) {}
    }
    if (state.map) state.map.on('resize', App.map.syncControlOffset);
    App.admin.updateDrawState();
    App.map.syncControlOffset();
  }

  /* -------------------------------- boot --------------------------------- */
  function boot() {
    App.storage.loadZones();
    App.map.initMap();
    wireUI();
    App.map.renderAllZones();
    App.admin.setMode(cfg.START_MODE);
    App.user.updatePanel();

    if (cfg.START_MODE === 'admin') {
      // with no zones stored yet, try a quiet fix so the admin starts near themselves
      if (!state.zones.length && 'geolocation' in navigator) {
        try {
          navigator.geolocation.getCurrentPosition(
            function (pos) {
              if (!state.user && state.map && !state.zones.length) {
                App.user.setUserLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'gps');
              }
            },
            function () {},
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          );
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      App.user.startUserFlow();
    }

    requestAnimationFrame(function () {
      App.map.syncControlOffset();
    });
    setTimeout(function () {
      App.map.syncControlOffset();
      if (state.map) state.map.invalidateSize();
    }, 500);
  }

  function init() {
    try {
      boot();
    } catch (err) {
      App.ui.hideBoot();
      var msg = err && err.message ? err.message : String(err);
      App.toast('EVACROUTE failed to start: ' + msg, 'err');
      var pre = document.createElement('pre');
      pre.id = 'boot-error';
      pre.textContent = 'BOOT ERROR: ' + (err && err.stack ? err.stack : msg);
      pre.hidden = true;
      document.body.appendChild(pre);
    }
    if (cfg.RUN_SELFTEST) App.selftest.scheduleSelfTest();
  }

  App.wireUI = wireUI;
  App.handleDelegatedClick = handleDelegatedClick;
  App.handleViewportChange = handleViewportChange;
  App.boot = boot;
  App.init = init;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.EvacRoute = window.EvacRoute || {});