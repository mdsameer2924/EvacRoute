/* ==========================================================================
   EVACROUTE — UI chrome
   Toasts, the boot overlay and the "location needed" modal.
   ========================================================================== */
(function (App) {
  'use strict';

  var $ = App.$;
  var state = App.state;

  var TOAST_LIMIT = 3;
  var TOAST_LIFETIME = 3400;
  var TOAST_EXIT = 400;

  /**
   * Show a transient message at the top of the map.
   * @param {string} message
   * @param {'ok'|'warn'|'err'} [kind]
   */
  function toast(message, kind) {
    var host = $('toastHost');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    host.appendChild(el);

    while (host.children.length > TOAST_LIMIT) host.removeChild(host.firstChild);

    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, TOAST_EXIT);
    }, TOAST_LIFETIME);
  }

  /* ------------------------------ boot overlay -------------------------- */
  function showBootOverlay() {
    var boot = $('boot');
    if (boot) boot.classList.remove('hidden');
  }

  /** Hide the boot overlay and let Leaflet re-measure once it has faded. */
  function hideBoot() {
    var boot = $('boot');
    state.bootHidden = true;
    if (!boot) return;
    boot.classList.add('hidden');
    setTimeout(function () {
      if (state.map) state.map.invalidateSize();
    }, 460);
  }

  function setBootMsg(message, sub) {
    var a = $('bootMsg');
    var b = $('bootSub2');
    if (a && message) a.textContent = message;
    if (b && sub) b.textContent = sub;
  }

  /* ---------------------------- location modal -------------------------- */
  function showGeoModal(message) {
    var m = $('geoModalMsg');
    if (m && message) m.textContent = message;
    var modal = $('geoModal');
    if (modal) modal.classList.add('open');
    var lat = $('manualLat');
    // Auto-focusing on mobile pops the keyboard over the dialog, so skip it.
    if (lat && window.innerWidth > 640) {
      setTimeout(function () {
        lat.focus();
      }, 220);
    }
  }

  function hideGeoModal() {
    var modal = $('geoModal');
    if (modal) modal.classList.remove('open');
  }

  App.ui = {
    toast: toast,
    showBootOverlay: showBootOverlay,
    hideBoot: hideBoot,
    setBootMsg: setBootMsg,
    showGeoModal: showGeoModal,
    hideGeoModal: hideGeoModal
  };

  /* Alias so callers can use App.toast(...) directly. */
  App.toast = toast;
})(window.EvacRoute = window.EvacRoute || {});